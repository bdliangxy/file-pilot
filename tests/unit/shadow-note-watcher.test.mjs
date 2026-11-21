import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { TFile, TFolder } from '../fakes/obsidian-watcher.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-watcher.mjs', import.meta.url)),
    },
});
const { ShadowNoteWatcher } = await jiti.import('../../src/core/shadow-note-watcher.ts');

function makeEmitter() {
    const listeners = new Map();
    return {
        on(event, callback) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(callback);
            return { off: () => listeners.get(event).delete(callback) };
        },
        emit(event, file) {
            for (const callback of [...(listeners.get(event) ?? [])]) callback(file);
        },
        count(event) {
            return listeners.get(event)?.size ?? 0;
        },
    };
}

function setup(
    records = [],
    {
        beforeRemove = async () => {},
        readSummary = async () => null,
    } = {},
) {
    const vault = makeEmitter();
    const metadataCache = makeEmitter();
    let stored = [...records];
    let clearing = false;
    const removed = [];
    let refreshed = 0;
    const stateService = {
        get isClearingData() { return clearing; },
        getFileRecords: () => [...stored],
        async removeFileRecord(id) {
            await beforeRemove(id);
            removed.push(id);
            stored = stored.filter(record => record.id !== id);
        },
    };
    const watcher = new ShadowNoteWatcher(
        vault,
        metadataCache,
        stateService,
        () => { refreshed++; },
        readSummary,
    );
    watcher.onload();
    return {
        watcher, vault, metadataCache, removed,
        setClearing(value) { clearing = value; },
        get records() { return stored; },
        get refreshed() { return refreshed; },
    };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

test('registers one changed listener on load, before any deletion', () => {
    const ctx = setup();
    assert.equal(ctx.metadataCache.count('changed'), 1);
    assert.equal(ctx.vault.count('delete'), 1);
    ctx.watcher.unload();
});

test('notifies multiple subscribers and supports independent unsubscription', () => {
    const ctx = setup();
    const first = [];
    const second = [];
    const unsubscribeFirst = ctx.watcher.onNoteChanged(path => first.push(path));
    const unsubscribeSecond = ctx.watcher.onNoteChanged(path => second.push(path));

    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    assert.deepEqual(first, ['ShadowNotes/a.md']);
    assert.deepEqual(second, ['ShadowNotes/a.md']);

    unsubscribeFirst();
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/b.md'));
    assert.deepEqual(first, ['ShadowNotes/a.md']);
    assert.deepEqual(second, ['ShadowNotes/a.md', 'ShadowNotes/b.md']);

    unsubscribeSecond();
    ctx.watcher.unload();
});

test('a failing subscriber does not prevent other subscribers from receiving changes', () => {
    const ctx = setup();
    const received = [];
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        ctx.watcher.onNoteChanged(() => { throw new Error('subscriber failed'); });
        ctx.watcher.onNoteChanged(path => received.push(path));
        ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
        assert.deepEqual(received, ['ShadowNotes/a.md']);
        assert.equal(errors.length, 1);
    } finally {
        console.error = originalError;
        ctx.watcher.unload();
    }
});

test('unload removes both native event listeners', () => {
    const ctx = setup();
    const received = [];
    ctx.watcher.onNoteChanged(path => received.push(path));
    ctx.watcher.unload();

    assert.equal(ctx.metadataCache.count('changed'), 0);
    assert.equal(ctx.vault.count('delete'), 0);
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    assert.deepEqual(received, []);
});

test('deletes only matching managed records and refreshes the view', async () => {
    const ctx = setup([
        { id: 'one', shadowNotePath: 'ShadowNotes/a.md' },
        { id: 'two', shadowNotePath: 'ShadowNotes/b.md' },
    ]);
    ctx.vault.emit('delete', new TFile('Unrelated/note.md'));
    ctx.vault.emit('delete', new TFolder('ShadowNotes'));
    ctx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
    await flush();

    assert.deepEqual(ctx.removed, ['one']);
    assert.deepEqual(ctx.records, [{ id: 'two', shadowNotePath: 'ShadowNotes/b.md' }]);
    assert.equal(ctx.refreshed, 1);
    ctx.watcher.unload();
});

test('sequential deletions preserve every unrelated record', async () => {
    const ctx = setup([
        { id: 'one', shadowNotePath: 'ShadowNotes/a.md' },
        { id: 'two', shadowNotePath: 'ShadowNotes/b.md' },
        { id: 'three', shadowNotePath: 'ShadowNotes/c.md' },
    ]);
    ctx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
    ctx.vault.emit('delete', new TFile('ShadowNotes/b.md'));
    await flush();

    assert.deepEqual(ctx.removed, ['one', 'two']);
    assert.deepEqual(ctx.records, [{ id: 'three', shadowNotePath: 'ShadowNotes/c.md' }]);
    assert.equal(ctx.refreshed, 2);
    ctx.watcher.unload();
});

test('ignores delete events emitted while clearing', async () => {
    const ctx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }]);
    ctx.setClearing(true);
    ctx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
    await ctx.watcher.waitForPendingDeletions();
    assert.deepEqual(ctx.removed, []);
    assert.equal(ctx.refreshed, 0);
    assert.equal(ctx.records.length, 1);
    ctx.watcher.unload();
});

test('a queued deletion is skipped when clearing begins before execution', async () => {
    const ctx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }]);
    ctx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
    ctx.setClearing(true);
    await ctx.watcher.waitForPendingDeletions();
    assert.deepEqual(ctx.removed, []);
    assert.equal(ctx.records.length, 1);
    ctx.watcher.unload();
});

test('deletion loop stops after an in-flight removal when clearing begins', async () => {
    let releaseRemoval;
    let signalStarted;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const gate = new Promise(resolve => { releaseRemoval = resolve; });
    const ctx = setup([
        { id: 'one', shadowNotePath: 'ShadowNotes/a.md' },
        { id: 'two', shadowNotePath: 'ShadowNotes/a.md' },
    ], {
        beforeRemove: async (id) => {
            if (id === 'one') {
                signalStarted();
                await gate;
            }
        },
    });
    try {
        ctx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
        await started;
        ctx.setClearing(true);
        releaseRemoval();
        await ctx.watcher.waitForPendingDeletions();
        assert.deepEqual(ctx.removed, ['one']);
        assert.deepEqual(ctx.records.map(record => record.id), ['two']);
        assert.equal(ctx.refreshed, 1);
    } finally {
        releaseRemoval();
        ctx.watcher.unload();
    }
});

test('reads Summary only for watched managed notes and supports files and folders', async () => {
    const records = [
        { id: 'file-1', kind: 'file', shadowNotePath: 'ShadowNotes/file.md' },
        { id: 'folder-1', kind: 'folder', shadowNotePath: 'ShadowNotes/folder.md' },
    ];
    const summaries = new Map([
        ['file-1', 'Initial file summary'],
        ['folder-1', 'Folder summary'],
    ]);
    const reads = [];
    const ctx = setup(records, {
        readSummary: async (record) => {
            reads.push(record.id);
            return summaries.get(record.id) ?? null;
        },
    });

    // Existing note-path notifications remain independent of Summary subscribers.
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/file.md'));
    await flush();
    assert.deepEqual(reads, []);

    const first = [];
    const second = [];
    const unsubscribeFirst = ctx.watcher.onFileSummaryChanged(change => first.push(change));
    const unsubscribeSecond = ctx.watcher.onFileSummaryChanged(change => second.push(change));

    ctx.metadataCache.emit('changed', new TFile('Other/ordinary.md'));
    await flush();
    assert.deepEqual(reads, []);

    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/file.md'));
    await flush();
    assert.deepEqual(reads, ['file-1']);
    assert.deepEqual(first, [{ fileId: 'file-1', summary: 'Initial file summary' }]);
    assert.deepEqual(second, first);

    // Unrelated edits to the same Shadow Note must not publish duplicate Summaries.
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/file.md'));
    await flush();
    assert.equal(first.length, 1);

    summaries.set('file-1', 'Revised file summary');
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/file.md'));
    await flush();
    assert.deepEqual(first[1], { fileId: 'file-1', summary: 'Revised file summary' });
    assert.deepEqual(second, first);

    unsubscribeFirst();
    summaries.delete('file-1');
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/file.md'));
    await flush();
    assert.equal(first.length, 2);
    assert.deepEqual(second[2], { fileId: 'file-1', summary: null });

    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/folder.md'));
    await flush();
    assert.deepEqual(second[3], { fileId: 'folder-1', summary: 'Folder summary' });

    unsubscribeSecond();
    summaries.set('file-1', 'Later summary');
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/file.md'));
    await flush();
    assert.equal(second.length, 4);
    assert.equal(reads.length, 5);
    ctx.watcher.unload();
});

test('first observation of an empty Summary publishes null only once', async () => {
    const ctx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }]);
    const received = [];
    ctx.watcher.onFileSummaryChanged(change => received.push(change));

    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    await flush();

    assert.deepEqual(received, [{ fileId: 'one', summary: null }]);
    ctx.watcher.unload();
});

test('ignores an older async Summary read that resolves after a newer one', async () => {
    let resolveFirst;
    const firstRead = new Promise(resolve => { resolveFirst = resolve; });
    let calls = 0;
    const ctx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }], {
        readSummary: async () => ++calls === 1 ? firstRead : 'Newest',
    });
    const received = [];
    ctx.watcher.onFileSummaryChanged(change => received.push(change));

    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    await flush();

    assert.equal(calls, 2);
    assert.deepEqual(received, [{ fileId: 'one', summary: 'Newest' }]);

    resolveFirst('Outdated');
    await flush();
    assert.deepEqual(received, [{ fileId: 'one', summary: 'Newest' }]);
    ctx.watcher.unload();
});

test('a failing Summary subscriber does not prevent another subscriber', async () => {
    const ctx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }], {
        readSummary: async () => 'Summary',
    });
    const received = [];
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        ctx.watcher.onFileSummaryChanged(() => { throw new Error('subscriber failed'); });
        ctx.watcher.onFileSummaryChanged(change => received.push(change));
        ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
        await flush();

        assert.deepEqual(received, [{ fileId: 'one', summary: 'Summary' }]);
        assert.equal(errors.length, 1);
        assert.match(errors[0][0], /File Summary subscriber failed/);
    } finally {
        console.error = originalError;
        ctx.watcher.unload();
    }
});

test('a failed Summary read does not publish and a later read can recover', async () => {
    let attempts = 0;
    const ctx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }], {
        readSummary: async () => {
            if (++attempts === 1) throw new Error('Read failed');
            return 'Recovered';
        },
    });
    const originalError = console.error;
    const errors = [];
    const received = [];
    console.error = (...args) => errors.push(args);
    try {
        ctx.watcher.onFileSummaryChanged(change => received.push(change));
        ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
        await flush();
        assert.deepEqual(received, []);
        assert.equal(errors.length, 1);

        ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
        await flush();
        assert.deepEqual(received, [{ fileId: 'one', summary: 'Recovered' }]);
    } finally {
        console.error = originalError;
        ctx.watcher.unload();
    }
});

test('does not publish an in-flight Summary when clearing or deletion intervenes', async () => {
    let resolveClearing;
    const clearingRead = new Promise(resolve => { resolveClearing = resolve; });
    const clearingCtx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }], {
        readSummary: async () => clearingRead,
    });
    const clearingEvents = [];
    clearingCtx.watcher.onFileSummaryChanged(change => clearingEvents.push(change));
    clearingCtx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    clearingCtx.setClearing(true);
    resolveClearing('Ignored while clearing');
    await flush();
    assert.deepEqual(clearingEvents, []);
    clearingCtx.watcher.unload();

    let resolveDeleted;
    const deletionRead = new Promise(resolve => { resolveDeleted = resolve; });
    let reads = 0;
    const deletionCtx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }], {
        readSummary: async () => { reads++; return deletionRead; },
    });
    const deletionEvents = [];
    deletionCtx.watcher.onFileSummaryChanged(change => deletionEvents.push(change));

    deletionCtx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    deletionCtx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
    await deletionCtx.watcher.waitForPendingDeletions();
    resolveDeleted('Deleted record');
    await flush();

    assert.deepEqual(deletionEvents, []);
    assert.deepEqual(deletionCtx.records, []);
    deletionCtx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    await flush();
    assert.equal(reads, 1);
    deletionCtx.watcher.unload();
});

test('unloading the watcher prevents pending Summary reads from notifying listeners', async () => {
    let finishRead;
    const read = new Promise(resolve => { finishRead = resolve; });
    const ctx = setup([{ id: 'one', shadowNotePath: 'ShadowNotes/a.md' }], {
        readSummary: async () => read,
    });
    const received = [];
    ctx.watcher.onFileSummaryChanged(change => received.push(change));
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));

    ctx.watcher.unload();
    finishRead('Too late');
    await flush();
    assert.deepEqual(received, []);
    assert.equal(ctx.metadataCache.count('changed'), 0);
});
