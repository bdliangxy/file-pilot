import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestJiti } from '../helpers/test-jiti.mjs';
import { makeFileRecord } from '../factories/file-record.mjs';
import { makePluginData } from '../factories/plugin-data.mjs';

const jiti = createTestJiti(import.meta.url);
const { PluginStateService } = await jiti.import('../../src/data/plugin-state-service.ts');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Hold the first persistence call to exercise queue ordering deterministically.
function blockedFirstSave(initial = makePluginData(), { failFirst = false } = {}) {
    const started = deferred();
    const release = deferred();
    const saved = [];
    let writeCount = 0;
    let activeWrites = 0;
    let maxActiveWrites = 0;

    const service = new PluginStateService({
        async loadData() {
            return structuredClone(initial);
        },
        async saveData(data) {
            const index = ++writeCount;
            activeWrites++;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
            try {
                if (index === 1) {
                    started.resolve();
                    await release.promise;
                    if (failFirst) throw new Error('Simulated save failure');
                }
                saved.push(structuredClone(data));
            } finally {
                activeWrites--;
            }
        },
    });

    return {
        service, started, release, saved,
        get writeCount() { return writeCount; },
        get maxActiveWrites() { return maxActiveWrites; },
    };
}

test('concurrent record additions use the latest state and never overlap writes', async (t) => {
    const ctx = blockedFirstSave();
    t.after(() => ctx.release.resolve());
    await ctx.service.load();

    const firstRecord = makeFileRecord('first', { path: 'docs/first.pdf' });
    const secondRecord = makeFileRecord('second', { path: 'docs/second.pdf' });
    const first = ctx.service.addFileRecords([firstRecord]);
    await ctx.started.promise;

    const second = ctx.service.addFileRecords([secondRecord]);
    await Promise.resolve();
    assert.equal(ctx.writeCount, 1);
    assert.equal(ctx.service.getFileRecordCount(), 0);

    ctx.release.resolve();
    await Promise.all([first, second]);

    assert.equal(ctx.maxActiveWrites, 1);
    assert.deepEqual(ctx.service.getFileRecords(), [firstRecord, secondRecord]);
    assert.deepEqual(ctx.saved[1].pluginData.fileRecords, [firstRecord, secondRecord]);
});

test('settings update queued behind record addition retains the new record', async (t) => {
    const ctx = blockedFirstSave();
    t.after(() => ctx.release.resolve());
    await ctx.service.load();

    const record = makeFileRecord('first', { path: 'docs/first.pdf' });
    const addition = ctx.service.addFileRecords([record]);
    await ctx.started.promise;

    const settings = ctx.service.updateSettings({ ignorePatterns: ['*.log'] });
    assert.equal(ctx.writeCount, 1);
    ctx.release.resolve();

    const [, result] = await Promise.all([addition, settings]);
    assert.deepEqual(result.updated, ['ignorePatterns']);
    assert.deepEqual(ctx.service.getFileRecords(), [record]);
    assert.deepEqual(ctx.service.getIgnorePatterns(), ['*.log']);
    assert.deepEqual(ctx.saved[1].pluginData.fileRecords, [record]);
});

test('settings update queued behind record deletion cannot resurrect a deleted record', async (t) => {
    const removed = makeFileRecord('remove', { path: 'docs/remove.pdf' });
    const kept = makeFileRecord('keep', { path: 'docs/keep.pdf' });
    const ctx = blockedFirstSave(makePluginData({ fileRecords: [removed, kept] }));
    t.after(() => ctx.release.resolve());
    await ctx.service.load();

    const deletion = ctx.service.removeFileRecord(removed.id);
    await ctx.started.promise;
    const settings = ctx.service.updateSettings({ hideShadowNotesFlag: false });

    ctx.release.resolve();
    await Promise.all([deletion, settings]);

    assert.deepEqual(ctx.service.getFileRecords(), [kept]);
    assert.equal(ctx.service.getHideShadowNotesFlag(), false);
    assert.deepEqual(ctx.saved[1].pluginData.fileRecords, [kept]);
    assert.equal(ctx.maxActiveWrites, 1);
});

test('a failed mutation rejects its caller but does not poison the queue', async (t) => {
    const ctx = blockedFirstSave(makePluginData(), { failFirst: true });
    t.after(() => ctx.release.resolve());
    await ctx.service.load();

    const failed = ctx.service.addFileRecords([
        makeFileRecord('failed', { path: 'docs/failed.pdf' }),
    ]);
    await ctx.started.promise;
    const next = ctx.service.updateSettings({ ignorePatterns: ['*.tmp'] });

    ctx.release.resolve();
    const results = await Promise.allSettled([failed, next]);

    assert.equal(results[0].status, 'rejected');
    assert.match(results[0].reason.message, /Simulated save failure/);
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(ctx.service.getFileRecordCount(), 0);
    assert.deepEqual(ctx.service.getIgnorePatterns(), ['*.tmp']);
    assert.equal(ctx.maxActiveWrites, 1);
    assert.equal(ctx.saved.length, 1);
});

test('clearing blocks new regular writes, drains accepted work, and permits reset', async (t) => {
    const ctx = blockedFirstSave();
    t.after(() => ctx.release.resolve());
    await ctx.service.load();

    const record = makeFileRecord('accepted', { path: 'docs/accepted.pdf' });
    const accepted = ctx.service.addFileRecords([record]);
    await ctx.started.promise;

    ctx.service.beginClearing();
    assert.equal(ctx.service.isClearingData, true);
    assert.throws(
        () => ctx.service.beginClearing(),
        { code: 'CLEAR_IN_PROGRESS' },
    );

    const isClearError = { code: 'CLEAR_IN_PROGRESS' };
    await assert.rejects(
        ctx.service.addFileRecords([makeFileRecord('blocked', { path: 'blocked.pdf' })]),
        isClearError,
    );
    await assert.rejects(ctx.service.removeFileRecord(record.id), isClearError);
    await assert.rejects(
        ctx.service.updateSettings({ ignorePatterns: ['blocked/'] }),
        isClearError,
    );

    let drained = false;
    const waiting = ctx.service.waitForPendingMutations().then(() => {
        drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);

    try {
        ctx.release.resolve();
        await accepted;
        await waiting;
        assert.equal(drained, true);
        assert.deepEqual(ctx.service.getFileRecords(), [record]);

        await ctx.service.resetAllData();
        assert.equal(ctx.service.getFileRecordCount(), 0);
        assert.equal(ctx.service.getRootPath(), '');
        assert.equal(ctx.saved.length, 2);
        assert.deepEqual(ctx.saved[0].pluginData.fileRecords, [record]);
        assert.deepEqual(ctx.saved[1].pluginData.fileRecords, []);
    } finally {
        ctx.service.endClearing();
    }

    assert.equal(ctx.service.isClearingData, false);
    await ctx.service.addFileRecords([record]);
    assert.equal(ctx.service.getFileRecordCount(), 1);
});

test('reset is denied outside a clear operation and works after a failed write', async () => {
    let failNextWrite = true;
    const service = new PluginStateService({
        async loadData() { return makePluginData(); },
        async saveData() {
            if (failNextWrite) {
                failNextWrite = false;
                throw new Error('Transient failure');
            }
        },
    });
    await service.load();

    await assert.rejects(service.resetAllData(), /active clearing operation/);
    await assert.rejects(
        service.updateSettings({ ignorePatterns: ['*.log'] }),
        /Transient failure/,
    );

    service.beginClearing();
    try {
        await service.waitForPendingMutations();
        await service.resetAllData();
        assert.equal(service.getFileRecordCount(), 0);
    } finally {
        service.endClearing();
    }
    assert.equal(service.isClearingData, false);
});
