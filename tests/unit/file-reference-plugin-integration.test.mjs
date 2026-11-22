import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
// eslint-disable-next-line import/no-extraneous-dependencies -- Test-only syntax tree fixture.
import { NodeType, Tree } from '@lezer/common';
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

const ID_A = 'Ab7Xc9Km2LdQ';
const ID_B = 'Zk3Mr6Tn8PwV';

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
    const contents = new Map();
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
        async cachedRead(note) {
            return contents.get(note.path) ?? '';
        },
        async process(note, updater) {
            const updated = updater(contents.get(note.path) ?? '');
            contents.set(note.path, updated);
            return updated;
        },
        async create(notePath, content = '') {
            const note = new TFile(notePath);
            notes.set(notePath, note);
            contents.set(notePath, content);
            if (notePath.startsWith('ShadowNotes/')) folder?.children.push(note);
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
                contents.delete(file.path);
                if (folder) {
                    folder.children = folder.children.filter(note => note !== file);
                }
                vault.emit('delete', file);
            },
        },
    };
    return { app, notes, contents };
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

    const { app, notes, contents } = makeApp();
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

    return { plugin, app, notes, root, contents };
}

function lookup(plugin, id) {
    return plugin.fileReferenceService.resolveFileReference(
        `|||@${id}|||`,
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

    assert.equal(typeof plugin.markdownPostProcessor, 'function');
    assert.ok(plugin.editorExtension, 'Live Preview extension is registered');
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

test('clearUserData resets the reference index after persisted reset', async (t) => {
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



const CODE_ROOT = NodeType.define({ id: 0, name: 'Document', top: true });
const CODE_NODE = NodeType.define({ id: 1, name: 'FencedCode' });

function makeCommandEditor(initial = '', { insideCode = false } = {}) {
    let value = initial;
    let focused = false;
    const editor = {
        getCursor() { return { line: 0, ch: value.length }; },
        getLine() { return value; },
        posToOffset(cursor) { return cursor.ch; },
        replaceSelection(insert) { value += insert; },
        focus() { focused = true; },
        get text() { return value; },
        get focused() { return focused; },
        setText(text) { value = text; },
    };
    if (insideCode) {
        const tree = new Tree(CODE_ROOT, [
            new Tree(CODE_NODE, [], [], value.length),
        ], [0], value.length);
        editor.cm = { state: { field: () => ({ tree }) } };
    }
    return editor;
}

function installAnimationFrame(t) {
    const frames = [];
    const originalWindow = globalThis.window;
    globalThis.window = {
        requestAnimationFrame(callback) {
            frames.push(callback);
            return frames.length;
        },
        // Keep the command timeout inert in integration tests.
        setTimeout: () => 1,
        clearTimeout() {},
    };
    t.after(() => {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    });
    return frames;
}

test('registers FileReferenceSuggest and a conditional editor command', async (t) => {
    const { plugin } = await setup(t);
    assert.ok(plugin.editorSuggest);
    const command = plugin.registeredCommands?.find(item => item.id === 'insert-file-reference');
    assert.ok(command);
    assert.equal(typeof command.editorCheckCallback, 'function');
    assert.equal(command.editorCallback, undefined);
    assert.equal(command.name, 'File reference');
});

test('command availability checks do not modify text or open suggestions', async (t) => {
    const { plugin } = await setup(t);
    const command = plugin.registeredCommands.find(item => item.id === 'insert-file-reference');
    const frames = installAnimationFrame(t);
    const editor = makeCommandEditor('Before ');
    const ctx = { file: new TFile('Notes/test.md') };

    assert.equal(command.editorCheckCallback(true, editor, ctx), true);
    assert.equal(editor.text, 'Before ');
    assert.equal(frames.length, 0);
    assert.equal(plugin.editorSuggest.triggerCalls.length, 0);
});

test('command is unavailable inside code and does not insert on execution', async (t) => {
    const { plugin } = await setup(t);
    const command = plugin.registeredCommands.find(item => item.id === 'insert-file-reference');
    const frames = installAnimationFrame(t);
    const editor = makeCommandEditor('code', { insideCode: true });
    const ctx = { file: new TFile('Notes/test.md') };

    assert.equal(command.editorCheckCallback(true, editor, ctx), false);
    assert.equal(command.editorCheckCallback(false, editor, ctx), false);
    assert.equal(editor.text, 'code');
    assert.equal(frames.length, 0);
    assert.equal(plugin.editorSuggest.triggerCalls.length, 0);
});

test('command inserts triple pipes and explicitly opens suggestions', async (t) => {
    const record = makeFileRecord(ID_A);
    const { plugin } = await setup(t, { records: [record] });
    const command = plugin.registeredCommands.find(item => item.id === 'insert-file-reference');
    const frames = installAnimationFrame(t);
    const editor = makeCommandEditor('Before ');
    const ctx = { file: new TFile('Notes/test.md') };

    assert.equal(command.editorCheckCallback(false, editor, ctx), true);
    assert.equal(editor.text, 'Before |||');
    assert.equal(frames.length, 1);
    assert.equal(plugin.editorSuggest.isOpen, false);
    frames[0]();
    assert.equal(editor.focused, true);
    assert.equal(plugin.editorSuggest.isOpen, true);
    assert.equal(plugin.editorSuggest.triggerCalls[0].explicit, true);
    assert.deepEqual(plugin.editorSuggest.lastSuggestions.map(item => item.id), [ID_A]);
});

test('invalid trigger at the next frame cannot open search results', async (t) => {
    const { plugin } = await setup(t);
    const command = plugin.registeredCommands.find(item => item.id === 'insert-file-reference');
    const frames = installAnimationFrame(t);
    const editor = makeCommandEditor('');
    const ctx = { file: new TFile('Notes/test.md') };

    assert.equal(command.editorCheckCallback(false, editor, ctx), true);
    assert.equal(frames.length, 1);

    // Simulate another editor update between command execution and its frame.
    editor.setText('||');
    frames[0]();
    assert.equal(editor.focused, true);
    assert.equal(plugin.editorSuggest.triggerCalls.length, 1);
    assert.equal(plugin.editorSuggest.isOpen, false);
});

function makeMultilineCommandEditor(initial) {
    let value = initial;
    let line = value.split('\n').length - 1;
    let ch = value.split('\n').at(-1).length;
    let focused = false;

    return {
        getCursor: () => ({ line, ch }),
        getLine: (index) => value.split('\n')[index],
        lineCount: () => value.split('\n').length,
        replaceSelection(insert) {
            const lines = value.split('\n');
            const prefix = lines.slice(0, line).join('\n');
            const offset = (line === 0 ? 0 : prefix.length + 1) + ch;
            const afterInsertion = value.slice(0, offset) + insert;
            value = afterInsertion + value.slice(offset);
            line = afterInsertion.split('\n').length - 1;
            ch = afterInsertion.split('\n').at(-1).length;
        },
        focus() { focused = true; },
        get text() { return value; },
        get focused() { return focused; },
    };
}

test('command inserts a separating blank line directly below a Markdown table', async (t) => {
    const record = makeFileRecord(ID_A);
    const { plugin } = await setup(t, { records: [record] });
    const command = plugin.registeredCommands.find(item => item.id === 'insert-file-reference');
    const frames = installAnimationFrame(t);
    const editor = makeMultilineCommandEditor('| A | B |\n|---|---|\n| X | Y |\n');
    const ctx = { file: new TFile('Notes/test.md') };

    assert.equal(command.editorCheckCallback(false, editor, ctx), true);
    assert.equal(editor.text, '| A | B |\n|---|---|\n| X | Y |\n\n|||');
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(plugin.editorSuggest.isOpen, true);
    assert.deepEqual(plugin.editorSuggest.lastSuggestions.map(item => item.id), [ID_A]);
});

test('command does not add another blank line when already separated from a table', async (t) => {
    const { plugin } = await setup(t);
    const command = plugin.registeredCommands.find(item => item.id === 'insert-file-reference');
    installAnimationFrame(t);
    const editor = makeMultilineCommandEditor('| A | B |\n|---|---|\n| X | Y |\n\n');

    assert.equal(command.editorCheckCallback(false, editor, { file: null }), true);
    assert.equal(editor.text, '| A | B |\n|---|---|\n| X | Y |\n\n|||');
});

test('command inside a table cell does not insert a separating blank line', async (t) => {
    const { plugin } = await setup(t);
    const command = plugin.registeredCommands.find(item => item.id === 'insert-file-reference');
    installAnimationFrame(t);
    const editor = makeMultilineCommandEditor('| A | B |\n|---|---|\n| X | Y |');

    assert.equal(command.editorCheckCallback(false, editor, { file: null }), true);
    assert.equal(editor.text, '| A | B |\n|---|---|\n| X | Y ||||');
});


function attachCodeContext(editor) {
    editor.posToOffset = position =>
        editor.text.split('\n').slice(0, position.line)
            .reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
    editor.cm = {
        state: {
            field: () => {
                const length = editor.text.length;
                return {
                    tree: new Tree(CODE_ROOT, [
                        new Tree(CODE_NODE, [], [], length),
                    ], [0], length),
                };
            },
        },
    };
    return editor;
}

test('file reference command opens suggestions inside a File Pilot tree fence', async t => {
    const record = makeFileRecord(ID_A, { path: 'docs/report.pdf' });
    const { plugin } = await setup(t, { records: [record] });
    const command = plugin.registeredCommands.find(
        item => item.id === 'insert-file-reference',
    );
    const frames = installAnimationFrame(t);
    const editor = attachCodeContext(makeMultilineCommandEditor([
        '```file-pilot-tree',
        '├── ',
    ].join('\n')));
    const ctx = { file: new TFile('Notes/test.md') };

    assert.equal(command.editorCheckCallback(true, editor, ctx), true);
    assert.equal(editor.text, '```file-pilot-tree\n├── ');
    assert.equal(command.editorCheckCallback(false, editor, ctx), true);
    assert.equal(editor.text, '```file-pilot-tree\n├── |||');
    assert.equal(frames.length, 1);

    frames[0]();
    assert.equal(plugin.editorSuggest.isOpen, true);
    assert.deepEqual(plugin.editorSuggest.lastSuggestions.map(item => item.id), [ID_A]);
});

test('file reference command remains disabled inside ordinary code fences', async t => {
    const { plugin } = await setup(t);
    const command = plugin.registeredCommands.find(
        item => item.id === 'insert-file-reference',
    );
    const frames = installAnimationFrame(t);
    const editor = attachCodeContext(makeMultilineCommandEditor([
        '```typescript',
        '├── ',
    ].join('\n')));
    const ctx = { file: new TFile('Notes/test.md') };

    assert.equal(command.editorCheckCallback(true, editor, ctx), false);
    assert.equal(command.editorCheckCallback(false, editor, ctx), false);
    assert.equal(editor.text, '```typescript\n├── ');
    assert.equal(frames.length, 0);
    assert.equal(plugin.editorSuggest.triggerCalls.length, 0);
});


test('updates Portal Tree annotations from Shadow Note metadata events', async t => {
    const first = makeFileRecord(ID_A, { shadowNotePath: 'ShadowNotes/first.md' });
    const second = makeFileRecord(ID_B, { path: 'other.pdf', shadowNotePath: 'ShadowNotes/second.md' });
    const { plugin, app, notes, contents } = await setup(t, { records: [first, second] });
    const notePath = (plugin.stateService.getProjectName() || 'PORTAL NOTE') + '.md';
    contents.set(first.shadowNotePath, '## File Summary\n\nInitial');
    contents.set(second.shadowNotePath, '## File Summary\n\nKeep this');
    assert.equal(await plugin.portalNoteService.createPortalNote(), true);
    const original = contents.get(notePath);
    assert.ok(original.includes('|||@' + ID_A + '|||  # Initial'));
    assert.ok(original.includes('|||@' + ID_B + '|||  # Keep this'));
    let updates = 0;
    const originalUpdate = plugin.portalNoteService.updateFileSummaryAnnotation.bind(plugin.portalNoteService);
    plugin.portalNoteService.updateFileSummaryAnnotation = (...args) => {
        updates++;
        return originalUpdate(...args);
    };
    contents.set(first.shadowNotePath, '## File Summary\n\nRevised');
    app.metadataCache.emit('changed', notes.get(first.shadowNotePath));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(contents.get(notePath), original.replace('  # Initial', '  # Revised'));
    assert.equal(updates, 1);
    app.metadataCache.emit('changed', notes.get(first.shadowNotePath));
    app.metadataCache.emit('changed', notes.get(notePath));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updates, 1);
    contents.set(first.shadowNotePath, '## File Summary\n');
    app.metadataCache.emit('changed', notes.get(first.shadowNotePath));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(contents.get(notePath), original.replace('  # Initial', ''));
    assert.equal(updates, 2);
});
