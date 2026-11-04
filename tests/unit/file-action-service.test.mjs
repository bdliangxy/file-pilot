import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { FileActionService } = await jiti.import(
    '../../src/core/file-action-service.ts',
);
const { resolveFileItemAction } = await jiti.import(
    '../../src/utils/file-item-gestures.ts',
);

function makeRecord(relativePath, kind = 'file') {
    const common = {
        id: 'record-1',
        kind,
        path: relativePath,
        status: 'available',
        shadowNotePath: 'ShadowNotes/report.md',
        baseName: path.posix.basename(relativePath),
        mtimeMs: 0,
    };

    return kind === 'file'
        ? { ...common, extension: 'pdf', size: 4 }
        : common;
}

function mouseEvent(type, modifiers = {}) {
    return {
        type,
        button: 0,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...modifiers,
    };
}

async function createFixture(t) {
    const root = await mkdtemp(path.join(tmpdir(), 'file-pilot-actions-'));
    const docs = path.join(root, 'docs');
    const report = path.join(docs, 'report.pdf');

    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(docs);
    await writeFile(report, 'test');

    const calls = {
        nativePaths: [],
        noteLookups: [],
        leafTypes: [],
        openedNotes: [],
    };
    const note = { path: 'ShadowNotes/report.md' };

    function createService({
        getRootPath = () => root,
        openNativePath = async () => '',
        findNote = () => note,
        openNote = async () => {},
    } = {}) {
        const app = {
            vault: {
                getFileByPath(notePath) {
                    calls.noteLookups.push(notePath);
                    return findNote(notePath);
                },
            },
            workspace: {
                getLeaf(type) {
                    calls.leafTypes.push(type);
                    return {
                        async openFile(file) {
                            calls.openedNotes.push(file);
                            await openNote(file);
                        },
                    };
                },
            },
        };

        return new FileActionService(
            app,
            getRootPath,
            async (targetPath) => {
                calls.nativePaths.push(targetPath);
                return openNativePath(targetPath);
            },
        );
    }

    return { root, docs, report, calls, note, createService };
}

function expectFilePilotError(code, pathFragment) {
    return (error) => {
        assert.equal(error?.name, 'FilePilotError');
        assert.equal(error.code, code);
        if (pathFragment) {
            assert.ok(
                error.message.includes(pathFragment),
                'Expected error message to include ' + pathFragment,
            );
        }
        return true;
    };
}

test('openSource passes an existing file path to the native opener', async (t) => {
    const { report, calls, createService } = await createFixture(t);
    await createService().execute('openSource', makeRecord('docs/report.pdf'));

    assert.deepEqual(calls.nativePaths, [report]);
    assert.deepEqual(calls.noteLookups, []);
});

test('openSource can open a directory without requiring a file type', async (t) => {
    const { docs, calls, createService } = await createFixture(t);
    await createService().execute('openSource', makeRecord('docs', 'folder'));

    assert.deepEqual(calls.nativePaths, [docs]);
});

test('openContainingFolder opens the parent of a file', async (t) => {
    const { docs, calls, createService } = await createFixture(t);
    await createService().execute(
        'openContainingFolder',
        makeRecord('docs/report.pdf'),
    );

    assert.deepEqual(calls.nativePaths, [docs]);
});

test('openContainingFolder opens the parent of a folder', async (t) => {
    const { root, calls, createService } = await createFixture(t);
    await createService().execute(
        'openContainingFolder',
        makeRecord('docs', 'folder'),
    );

    assert.deepEqual(calls.nativePaths, [root]);
});

test('missing source can still open its existing parent folder', async (t) => {
    const { docs, calls, createService } = await createFixture(t);
    await createService().execute(
        'openContainingFolder',
        makeRecord('docs/deleted.pdf'),
    );

    assert.deepEqual(calls.nativePaths, [docs]);
});

test('the root path is read again for each native opening action', async (t) => {
    const { root, report, calls, createService } = await createFixture(t);
    const otherRoot = await mkdtemp(path.join(tmpdir(), 'file-pilot-other-root-'));
    t.after(() => rm(otherRoot, { recursive: true, force: true }));
    await mkdir(path.join(otherRoot, 'docs'));
    const otherReport = path.join(otherRoot, 'docs', 'report.pdf');
    await writeFile(otherReport, 'test');

    let currentRoot = root;
    const service = createService({ getRootPath: () => currentRoot });
    const record = makeRecord('docs/report.pdf');

    await service.execute('openSource', record);
    currentRoot = otherRoot;
    await service.execute('openSource', record);

    assert.deepEqual(calls.nativePaths, [report, otherReport]);
});

test('the current filesystem state takes precedence over a stale missing status', async (t) => {
    const { report, calls, createService } = await createFixture(t);
    const record = { ...makeRecord('docs/report.pdf'), status: 'missing' };

    await createService().execute('openSource', record);

    assert.deepEqual(calls.nativePaths, [report]);
});

test('openShadowNote retrieves the vault-relative note and opens a new tab', async (t) => {
    const { calls, note, createService } = await createFixture(t);
    await createService().execute(
        'openShadowNote',
        makeRecord('docs/report.pdf'),
    );

    assert.deepEqual(calls.noteLookups, ['ShadowNotes/report.md']);
    assert.deepEqual(calls.leafTypes, ['tab']);
    assert.deepEqual(calls.openedNotes, [note]);
    assert.deepEqual(calls.nativePaths, []);
});

test('missing Shadow Note produces SHADOW_NOTE_NOT_FOUND with its path', async (t) => {
    const { calls, createService } = await createFixture(t);
    const service = createService({ findNote: () => null });

    await assert.rejects(
        service.execute('openShadowNote', makeRecord('docs/report.pdf')),
        expectFilePilotError('SHADOW_NOTE_NOT_FOUND', 'ShadowNotes/report.md'),
    );
    assert.deepEqual(calls.leafTypes, []);
    assert.deepEqual(calls.nativePaths, []);
});

test('Obsidian openFile rejection becomes FILE_OPEN_FAILED with note path and cause', async (t) => {
    const { createService } = await createFixture(t);
    const log = t.mock.method(console, 'error', () => {});
    const service = createService({
        openNote: async () => { throw new Error('Cannot display markdown'); },
    });

    await assert.rejects(
        service.execute('openShadowNote', makeRecord('docs/report.pdf')),
        (error) => {
            expectFilePilotError('FILE_OPEN_FAILED', 'ShadowNotes/report.md')(error);
            assert.match(error.message, /Cannot display markdown/);
            return true;
        },
    );
    assert.equal(log.mock.callCount(), 1);
});

test('missing source produces SOURCE_FILE_NOT_FOUND without invoking the opener', async (t) => {
    const { root, calls, createService } = await createFixture(t);
    const missing = path.join(root, 'docs', 'deleted.pdf');

    await assert.rejects(
        createService().execute('openSource', makeRecord('docs/deleted.pdf')),
        expectFilePilotError('SOURCE_FILE_NOT_FOUND', missing),
    );
    assert.deepEqual(calls.nativePaths, []);
});

test('ENOTDIR from an invalid parent component is classified as missing', async (t) => {
    const { report, calls, createService } = await createFixture(t);
    const record = makeRecord('docs/report.pdf/child.txt');

    await assert.rejects(
        createService().execute('openSource', record),
        expectFilePilotError('SOURCE_FILE_NOT_FOUND', path.join(report, 'child.txt')),
    );
    assert.deepEqual(calls.nativePaths, []);
});

test('a nonempty native error message produces FILE_OPEN_FAILED with target path', async (t) => {
    const { report, calls, createService } = await createFixture(t);
    const service = createService({
        openNativePath: async () => 'No associated application',
    });

    await assert.rejects(
        service.execute('openSource', makeRecord('docs/report.pdf')),
        (error) => {
            expectFilePilotError('FILE_OPEN_FAILED', report)(error);
            assert.match(error.message, /No associated application/);
            return true;
        },
    );
    assert.deepEqual(calls.nativePaths, [report]);
});

test('a rejected native opener produces FILE_OPEN_FAILED and logs its cause', async (t) => {
    const { report, createService } = await createFixture(t);
    const log = t.mock.method(console, 'error', () => {});
    const service = createService({
        openNativePath: async () => { throw new Error('System open failed'); },
    });

    await assert.rejects(
        service.execute('openSource', makeRecord('docs/report.pdf')),
        (error) => {
            expectFilePilotError('FILE_OPEN_FAILED', report)(error);
            assert.match(error.message, /System open failed/);
            return true;
        },
    );
    assert.equal(log.mock.callCount(), 1);
});

test('Windows-style shortcut files are handed to the native opener unchanged', async (t) => {
    const { docs, calls, createService } = await createFixture(t);
    const shortcut = path.join(docs, 'report.lnk');
    await writeFile(shortcut, 'shortcut placeholder');

    await createService().execute('openSource', makeRecord('docs/report.lnk'));

    assert.deepEqual(calls.nativePaths, [shortcut]);
});

test('valid symbolic links outside the root can be opened via their link path', async (t) => {
    const { docs, calls, createService } = await createFixture(t);
    const outside = await mkdtemp(path.join(tmpdir(), 'file-pilot-linked-target-'));
    t.after(() => rm(outside, { recursive: true, force: true }));
    const outsideFile = path.join(outside, 'outside.pdf');
    const link = path.join(docs, 'external-link.pdf');
    await writeFile(outsideFile, 'target');

    try {
        await symlink(outsideFile, link, 'file');
    } catch (error) {
        if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
            t.skip('Creating symbolic links is not permitted on this system');
            return;
        }
        throw error;
    }

    await createService().execute('openSource', makeRecord('docs/external-link.pdf'));

    assert.deepEqual(calls.nativePaths, [link]);
});

test('a dangling symbolic link is reported as a missing source', async (t) => {
    const { docs, calls, createService } = await createFixture(t);
    const link = path.join(docs, 'broken-link.pdf');
    const nonexistentTarget = path.join(docs, 'nonexistent-target.pdf');

    try {
        await symlink(nonexistentTarget, link, 'file');
    } catch (error) {
        if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
            t.skip('Creating symbolic links is not permitted on this system');
            return;
        }
        throw error;
    }

    await assert.rejects(
        createService().execute('openSource', makeRecord('docs/broken-link.pdf')),
        expectFilePilotError('SOURCE_FILE_NOT_FOUND', link),
    );
    assert.deepEqual(calls.nativePaths, []);
});

test('default gesture actions dispatch to FileActionService without executing editSummary', async (t) => {
    const { report, docs, calls, createService } = await createFixture(t);
    const service = createService();
    const record = makeRecord('docs/report.pdf');
    const cases = [
        [mouseEvent('dblclick'), 'item', 'openSource'],
        [mouseEvent('click', { ctrlKey: true }), 'secondary', 'openContainingFolder'],
        [mouseEvent('click', { altKey: true }), 'item', 'openShadowNote'],
        [mouseEvent('dblclick'), 'secondary', 'editSummary'],
    ];

    for (const [event, region, expectedAction] of cases) {
        const action = resolveFileItemAction(event, region);
        assert.equal(action, expectedAction);
        if (action !== 'editSummary' && action !== null) {
            await service.execute(action, record);
        }
    }

    assert.deepEqual(calls.nativePaths, [report, docs]);
    assert.deepEqual(calls.noteLookups, ['ShadowNotes/report.md']);
    assert.equal(calls.openedNotes.length, 1);
});
