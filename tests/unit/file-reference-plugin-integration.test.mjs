import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { makeFileRecord } from '../factories/file-record.mjs';
import { makePluginData } from '../factories/plugin-data.mjs';
import { TFile } from '../fakes/obsidian-watcher.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-plugin.mjs', import.meta.url)),
        electron: fileURLToPath(new URL('../fakes/electron-plugin.mjs', import.meta.url)),
    },
});
const { default: FilePilotPlugin } = await jiti.import('../../src/main.ts');
const { generateShortKey } = await jiti.import('../../src/utils/file-reference-utils.ts');

const ID_A = '550e8400-e29b-41d4-a716-446655440000';
const ID_B = '6fa459ea-ee8a-3ca4-894e-db77e160355e';

function makeEmitter() {
    const listeners = new Map();
    return {
        on(event, callback) {
            const callbacks = listeners.get(event) ?? new Set();
            callbacks.add(callback);
            listeners.set(event, callbacks);
            return { off: () => callbacks.delete(callback) };
        },
        emit(event, value) {
            for (const callback of listeners.get(event) ?? []) {
                callback(value);
            }
        },
    };
}

function makeApp() {
    const notes = new Map();
    const vault = makeEmitter();
    let folder = null;

    Object.assign(vault, {
        getAbstractFileByPath: (notePath) => notes.get(notePath)
            ?? (folder?.path === notePath ? folder : null),
        getFileByPath: (notePath) => notes.get(notePath) ?? null,
        getFolderByPath: (notePath) => folder?.path === notePath ? folder : null,
        getMarkdownFiles: () => [...notes.values()],
        async createFolder(folderPath) {
            folder = { path: folderPath, children: [] };
        },
        async create(notePath) {
            const note = new TFile(notePath);
            notes.set(notePath, note);
            folder?.children.push(note);
            return note;
        },
    });

    const app = {
        vault,
        metadataCache: makeEmitter(),
        workspace: { getLeavesOfType: () => [] },
        fileManager: {
            async trashFile(file) {
                if (file === folder) {
                    folder = null;
                    return;
                }
                notes.delete(file.path);
                if (folder) {
                    folder.children = folder.children.filter(note => note !== file);
                }
                vault.emit('delete', file);
            },
        },
    };
    return { app, notes };
}

async function setup(t, { records = [], scannedFileNames = [] } = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'file-pilot-reference-integration-'));
    const originalDocument = globalThis.document;
    globalThis.document = {
        body: { classList: { toggle() {} } },
    };

    t.after(async () => {
        globalThis.document = originalDocument;
        await rm(root, { recursive: true, force: true });
    });

    for (const name of scannedFileNames) {
        await writeFile(path.join(root, name), 'test');
    }

    const { app, notes } = makeApp();
    const plugin = new FilePilotPlugin(app);
    plugin.testStoredData = makePluginData({
        rootPath: root,
        hideShadowNotesFlag: false,
        fileRecords: records,
    });

    if (records.length > 0) {
        await app.vault.createFolder('ShadowNotes');
        for (const record of records) {
            await app.vault.create(record.shadowNotePath);
        }
    }

    await plugin.onload();
    t.after(() => plugin.shadowNoteWatcher.unload());

    return { plugin, app, notes, root };
}

function lookup(plugin, id) {
    return plugin.fileReferenceService.resolveFileReference(
        `|||@${generateShortKey(id)}|||`,
    );
}

test('onload indexes persisted FileRecords before any scan', async (t) => {
    const first = makeFileRecord(ID_A);
    const second = makeFileRecord(ID_B, {
        path: 'docs/other.pdf',
        status: 'missing',
        shadowNotePath: 'ShadowNotes/other.md',
    });
    const { plugin } = await setup(t, { records: [first, second] });

    assert.equal(lookup(plugin, ID_A).kind, 'found');
    assert.equal(lookup(plugin, ID_A).record.path, first.path);
    assert.equal(lookup(plugin, ID_B).record.status, 'missing');
    assert.equal(
        plugin.fileReferenceService.resolveFileId(ID_A)?.id,
        ID_A,
    );
});

test('successful scan makes imported records searchable and no-op scans skip rebuilding', async (t) => {
    const { plugin } = await setup(t, { scannedFileNames: ['report.pdf'] });
    const rebuildCalls = [];
    const referenceService = plugin.fileReferenceService;
    const originalRebuild = referenceService.rebuildReferenceIndex.bind(referenceService);
    referenceService.rebuildReferenceIndex = (records) => {
        rebuildCalls.push(records.length);
        return originalRebuild(records);
    };

    const first = await plugin.syncFiles();
    const records = plugin.stateService.getFileRecords();

    assert.equal(first.importedCount, 1);
    assert.equal(records.length, 1);
    assert.equal(lookup(plugin, records[0].id).kind, 'found');
    assert.equal(referenceService.resolveFileId(records[0].id)?.path, 'report.pdf');
    assert.deepEqual(rebuildCalls, [1]);

    const second = await plugin.syncFiles();
    assert.equal(second.importedCount, 0);
    assert.deepEqual(rebuildCalls, [1]);
});

test('failed scan persistence does not publish an uncommitted reference', async (t) => {
    const { plugin } = await setup(t, { scannedFileNames: ['failure.pdf'] });
    plugin.saveData = async () => {
        throw new Error('simulated persistence failure');
    };

    await assert.rejects(plugin.syncFiles(), /simulated persistence failure/);
    assert.deepEqual(plugin.stateService.getFileRecords(), []);
    assert.equal(plugin.fileReferenceService.resolveFileId(ID_A), undefined);
});

test('deleting a managed Shadow Note removes its reference from the index', async (t) => {
    const first = makeFileRecord(ID_A, {
        shadowNotePath: 'ShadowNotes/report.md',
    });
    const second = makeFileRecord(ID_B, {
        path: 'docs/other.pdf',
        shadowNotePath: 'ShadowNotes/other.md',
    });
    const { plugin, app, notes } = await setup(t, {
        records: [first, second],
    });

    app.vault.emit('delete', notes.get(first.shadowNotePath));
    await plugin.shadowNoteWatcher.waitForPendingDeletions();

    assert.deepEqual(lookup(plugin, ID_A), { kind: 'missing' });
    assert.equal(plugin.fileReferenceService.resolveFileId(ID_A), undefined);
    assert.equal(lookup(plugin, ID_B).kind, 'found');
    assert.equal(plugin.stateService.getFileRecords().length, 1);
});

test('unrelated note deletions leave the reference index unchanged', async (t) => {
    const record = makeFileRecord(ID_A);
    const { plugin, app } = await setup(t, { records: [record] });
    const referenceService = plugin.fileReferenceService;
    let rebuildCount = 0;
    const originalRebuild = referenceService.rebuildReferenceIndex.bind(referenceService);
    referenceService.rebuildReferenceIndex = (records) => {
        rebuildCount++;
        return originalRebuild(records);
    };

    app.vault.emit('delete', new TFile('Notes/unrelated.md'));
    await plugin.shadowNoteWatcher.waitForPendingDeletions();

    assert.equal(rebuildCount, 0);
    assert.equal(lookup(plugin, ID_A).kind, 'found');
});

test('clearUserData resets both reference indexes after persisted reset', async (t) => {
    const record = makeFileRecord(ID_A);
    const { plugin } = await setup(t, { records: [record] });
    assert.equal(lookup(plugin, ID_A).kind, 'found');

    await plugin.clearUserData();

    assert.deepEqual(plugin.stateService.getFileRecords(), []);
    assert.deepEqual(lookup(plugin, ID_A), { kind: 'missing' });
    assert.equal(plugin.fileReferenceService.resolveFileId(ID_A), undefined);
    assert.equal(plugin.stateService.isClearingData, false);
});

test('failed data reset leaves previously indexed records available', async (t) => {
    const record = makeFileRecord(ID_A);
    const { plugin } = await setup(t, { records: [record] });
    plugin.saveData = async () => {
        throw new Error('simulated reset failure');
    };

    await assert.rejects(plugin.clearUserData(), /simulated reset failure/);

    assert.equal(lookup(plugin, ID_A).kind, 'found');
    assert.equal(plugin.stateService.isClearingData, false);
});
