import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
// eslint-disable-next-line import/no-extraneous-dependencies -- Test-only syntax tree fixture.
import { NodeType, Tree } from '@lezer/common';
import { makeFileRecord, makeScannedFolder } from '../factories/file-record.mjs';
import { FakeElement } from '../fakes/obsidian-view.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-plugin.mjs', import.meta.url)),
    },
});
const { FileReferenceSuggest } = await jiti.import('../../src/ui/file-reference-suggest.ts');
const { FileReferenceService } = await jiti.import('../../src/core/file-reference-service.ts');
const { generateShortKey } = await jiti.import('../../src/utils/file-reference-utils.ts');

const ID_A = '550e8400-e29b-41d4-a716-446655440000';
const ID_B = '6fa459ea-ee8a-3ca4-894e-db77e160355e';

// Keep animation frames inert in tests that do not explicitly control scheduling.
globalThis.window ??= {
    requestAnimationFrame: () => 1,
    setTimeout: () => 1,
    clearTimeout() {},
};

function makeEditor(initial = '') {
    let line = initial;
    let cursor = { line: 0, ch: initial.length };
    const replacements = [];
    return {
        getLine: () => line,
        getCursor: () => cursor,
        getSelection: () => '',
        focus() { this.focused = true; },
        replaceRange(insert, start, end) {
            replacements.push({ insert, start, end });
            line = line.slice(0, start.ch) + insert + line.slice(end.ch);
            cursor = { line: 0, ch: start.ch + insert.length };
        },
        replaceSelection(insert) {
            this.replaceRange(insert, cursor, cursor);
        },
        setText(text) {
            line = text;
            cursor = { line: 0, ch: text.length };
        },
        get text() { return line; },
        replacements,
    };
}

function makeSuggest(records) {
    const references = new FileReferenceService();
    references.rebuildReferenceIndex(records);
    const suggest = new FileReferenceSuggest({}, references, () => records);
    return { suggest, references };
}

function openSearch(suggest, editor, file = null) {
    const info = suggest.onTrigger(editor.getCursor(), editor, file);
    assert.ok(info);
    suggest.context = { ...info, editor, file };
    return suggest.context;
}

test('only an incomplete triple-pipe trigger starts suggestions', () => {
    const { suggest } = makeSuggest([]);
    for (const text of ['|||', 'before |||report', '|||Design/architecture']) {
        const editor = makeEditor(text);
        const result = suggest.onTrigger(editor.getCursor(), editor, null);
        assert.ok(result, text);
        assert.equal(result.query, text.slice(text.lastIndexOf('|||') + 3));
        assert.equal(result.start.ch, text.lastIndexOf('|||'));
        assert.equal(result.end.ch, text.length);
    }
    for (const text of ['hello', '||', '||||', '|||@123456789012|||', '|||search|']) {
        const editor = makeEditor(text);
        assert.equal(suggest.onTrigger(editor.getCursor(), editor, null), null, text);
    }
});

test('search works with empty query and filters case-insensitively by path', () => {
    const records = [
        makeFileRecord(ID_A, { path: 'Docs/Report.pdf' }),
        makeFileRecord(ID_B, { path: 'Notes/Other.docx' }),
    ];
    const { suggest } = makeSuggest(records);
    assert.equal(suggest.getSuggestions({ query: '' }).length, 2);
    assert.deepEqual(
        suggest.getSuggestions({ query: 'REPORT' }).map(item => item.id),
        [ID_A],
    );
});

test('search prioritizes filename prefix and then sorts paths ascending', () => {
    const records = [
        makeFileRecord(ID_A, { path: 'z/archive-report.pdf' }),
        makeFileRecord(ID_B, { path: 'a/report.pdf' }),
        makeFileRecord('third', { path: 'b/report-draft.pdf' }),
    ];
    const { suggest } = makeSuggest(records);
    assert.deepEqual(
        suggest.getSuggestions({ query: 'report' }).map(item => item.path),
        ['a/report.pdf', 'b/report-draft.pdf', 'z/archive-report.pdf'],
    );
    assert.deepEqual(records.map(item => item.path), [
        'z/archive-report.pdf', 'a/report.pdf', 'b/report-draft.pdf',
    ]);
});

test('at most fifteen suggestions are returned', () => {
    const records = Array.from({ length: 21 }, (_, i) =>
        makeFileRecord(String(i), { path: 'documents/file-' + String(i).padStart(2, '0') + '.pdf' }),
    );
    const { suggest } = makeSuggest(records);
    assert.equal(suggest.getSuggestions({ query: '' }).length, 15);
    assert.equal(suggest.limit, 15);
});

test('suggestion rendering distinguishes folders and missing files', () => {
    const records = [
        makeFileRecord(ID_A, { path: 'docs/report.pdf', status: 'missing' }),
        { ...makeScannedFolder('docs/Assets'), id: ID_B, status: 'available', shadowNotePath: 'ShadowNotes/assets.md' },
    ];
    const { suggest } = makeSuggest(records);
    const fileRoot = new FakeElement();
    suggest.renderSuggestion(records[0], fileRoot);
    assert.equal(fileRoot.children[0].text, 'report.pdf');
    assert.ok(fileRoot.children[0].classes.has('file-pilot-suggestion-name'));
    assert.ok(fileRoot.children[2].classes.has('file-pilot-suggestion-status'));
    const folderRoot = new FakeElement();
    suggest.renderSuggestion(records[1], folderRoot);
    assert.ok(folderRoot.children[0].classes.has('file-pilot-folder-name'));
    assert.equal(folderRoot.children[0].text, 'Assets');
    assert.equal(folderRoot.children[1].text, 'docs/Assets');
});

test('selection replaces only trigger text with a stable short reference', () => {
    const record = makeFileRecord(ID_A);
    const { suggest } = makeSuggest([record]);
    const editor = makeEditor('before |||report');
    openSearch(suggest, editor);
    suggest.selectSuggestion(record, {});
    assert.equal(editor.text, 'before |||@' + generateShortKey(ID_A) + '|||');
    assert.equal(editor.replacements.length, 1);
    assert.equal(editor.replacements[0].start.ch, 7);
    assert.equal(editor.replacements[0].end.ch, 16);
    assert.equal(suggest.context, null);
});

test('selection falls back to full UUID when the short key is ambiguous', () => {
    const first = makeFileRecord(ID_A, { path: 'first.pdf' });
    const duplicate = makeFileRecord(ID_A.toUpperCase(), { path: 'second.pdf' });
    const { suggest } = makeSuggest([first, duplicate]);
    const editor = makeEditor('|||second');
    openSearch(suggest, editor);
    suggest.selectSuggestion(duplicate, {});
    assert.equal(editor.text, '|||!' + duplicate.id + '|||');
});

test('selection does not insert a record removed from the reference index', () => {
    const record = makeFileRecord(ID_A);
    const { suggest, references } = makeSuggest([record]);
    const editor = makeEditor('|||report');
    openSearch(suggest, editor);
    references.rebuildReferenceIndex([]);
    suggest.selectSuggestion(record, {});
    assert.equal(editor.text, '|||report');
    assert.equal(editor.replacements.length, 0);
});

test('command-opened menu closes when triple-pipe trigger is deleted', () => {
    const { suggest } = makeSuggest([makeFileRecord(ID_A)]);
    const editor = makeEditor('|||');
    suggest.openFromCommand(editor, null);
    assert.equal(suggest.isOpen, true);
    assert.equal(suggest.triggerCalls[0].explicit, true);
    editor.setText('||');
    assert.equal(suggest.onTrigger(editor.getCursor(), editor, null), null);
    assert.equal(suggest.isOpen, false);
});

test('command-opened menu remains usable while editing its search query', () => {
    const { suggest } = makeSuggest([makeFileRecord(ID_A)]);
    const editor = makeEditor('|||');
    suggest.openFromCommand(editor, null);
    editor.setText('|||report');
    assert.equal(suggest.onTrigger(editor.getCursor(), editor, null).query, 'report');
    assert.equal(suggest.isOpen, true);
});


test('code context blocks manual file suggestions but ordinary text still works', () => {
    const root = NodeType.define({ id: 0, name: 'Document', top: true });
    const code = NodeType.define({ id: 1, name: 'FencedCode' });
    const { suggest } = makeSuggest([]);
    const editor = makeEditor('|||');
    editor.posToOffset = (cursor) => cursor.ch;
    const codeTree = new Tree(root, [new Tree(code, [], [], 3)], [0], 3);
    editor.cm = { state: { field: () => ({ tree: codeTree }) } };

    assert.equal(suggest.onTrigger(editor.getCursor(), editor, null), null);

    // A text context with a syntax tree must continue to accept the trigger.
    editor.cm.state.field = () => ({ tree: new Tree(root, [], [], 3) });
    assert.equal(suggest.onTrigger(editor.getCursor(), editor, null).query, '');
});

test('a command-opened suggestion closes when syntax context becomes code', () => {
    const root = NodeType.define({ id: 0, name: 'Document', top: true });
    const code = NodeType.define({ id: 1, name: 'InlineCode' });
    const { suggest } = makeSuggest([]);
    const editor = makeEditor('|||');
    editor.posToOffset = (cursor) => cursor.ch;
    editor.cm = { state: { field: () => ({ tree: new Tree(root, [], [], 3) }) } };

    suggest.openFromCommand(editor, null);
    assert.equal(suggest.isOpen, true);

    editor.cm.state.field = () => ({
        tree: new Tree(root, [new Tree(code, [], [], 3)], [0], 3),
    });
    assert.equal(suggest.onTrigger(editor.getCursor(), editor, null), null);
    assert.equal(suggest.isOpen, false);
});


function withControlledFrames(callback) {
    const previousWindow = globalThis.window;
    const frames = [];
    globalThis.window = {
        ...previousWindow,
        requestAnimationFrame(fn) {
            frames.push(fn);
            return frames.length;
        },
    };
    try {
        callback({
            count: () => frames.length,
            next: () => {
                const fn = frames.shift();
                assert.ok(fn, 'Expected a queued animation frame');
                fn();
            },
        });
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
}

function createTableCommandHarness() {
    const { suggest } = makeSuggest([makeFileRecord(ID_A)]);
    const originalTrigger = suggest.trigger.bind(suggest);
    const calls = [];
    suggest.trigger = (editor, file, explicit) => {
        calls.push({ editor, file, explicit });
        if (editor.text === '|     |     |') {
            assert.equal(suggest.onTrigger(editor.getCursor(), editor, file), null);
            suggest.close();
        } else {
            originalTrigger(editor, file, explicit);
        }
    };
    return { suggest, calls };
}

test('table command retries after the trigger becomes available in the editor', () => {
    withControlledFrames(({ count, next }) => {
        const { suggest, calls } = createTableCommandHarness();
        const table = makeEditor('|     |     |');
        const realEditor = makeEditor('|||');

        suggest.openFromCommand(table, null);
        assert.equal(suggest.isOpen, false);
        assert.ok(suggest.onTrigger(realEditor.getCursor(), realEditor, null));
        assert.equal(count(), 1);
        next();

        assert.equal(calls.length, 2);
        assert.equal(calls[1].editor, realEditor);
        assert.equal(calls[1].explicit, true);
        assert.equal(suggest.isOpen, true);
    });
});

test('closing a command before its queued retry prevents reopening', () => {
    withControlledFrames(({ next }) => {
        const { suggest, calls } = createTableCommandHarness();
        const table = makeEditor('|     |     |');
        const realEditor = makeEditor('|||');

        suggest.openFromCommand(table, null);
        assert.ok(suggest.onTrigger(realEditor.getCursor(), realEditor, null));
        suggest.close();
        next();

        assert.equal(calls.length, 1, 'Canceled command must not trigger again');
        assert.equal(suggest.isOpen, false);
    });
});

test('an older queued retry must not override a newer pending command', () => {
    withControlledFrames(({ count, next }) => {
        const { suggest, calls } = createTableCommandHarness();
        const oldTable = makeEditor('|     |     |');
        const oldEditor = makeEditor('|||old');
        const newTable = makeEditor('|     |     |');
        const newEditor = makeEditor('|||new');

        suggest.openFromCommand(oldTable, null);
        assert.ok(suggest.onTrigger(oldEditor.getCursor(), oldEditor, null));
        assert.equal(count(), 1);

        suggest.openFromCommand(newTable, null);
        assert.ok(suggest.onTrigger(newEditor.getCursor(), newEditor, null));
        next();

        assert.equal(
            calls.some(call => call.editor === oldEditor),
            false,
            'A stale frame must not trigger on an editor from the previous command',
        );
    });
});


function withControlledTimeouts(run) {
    const previousWindow = globalThis.window;
    const tasks = new Map();
    let nextId = 0;
    globalThis.window = {
        ...previousWindow,
        setTimeout(callback, delay) {
            const id = ++nextId;
            tasks.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) {
            tasks.delete(id);
        },
    };
    try {
        run({
            pending: () => [...tasks.values()],
            expire: () => {
                const [id, task] = tasks.entries().next().value ?? [];
                assert.ok(task, 'Expected an active command timeout');
                tasks.delete(id);
                task.callback();
            },
        });
    } finally {
        globalThis.window = previousWindow;
    }
}

test('unfinished table command expires after two seconds without a valid trigger', () => {
    withControlledTimeouts(({ pending, expire }) => {
        withControlledFrames(({ count, next }) => {
            const { suggest, calls } = createTableCommandHarness();
            const table = makeEditor('|     |     |');
            const laterEditor = makeEditor('|||');

            suggest.openFromCommand(table, null);
            assert.equal(pending().length, 1);
            assert.equal(pending()[0].delay, 2000);
            expire();

            assert.ok(suggest.onTrigger(laterEditor.getCursor(), laterEditor, null));
            assert.equal(count(), 0, 'An expired command must not queue a retry');
            assert.equal(calls.length, 1);
            assert.equal(suggest.isOpen, false);
        });
    });
});

test('successful table retry cancels the pending-command timeout', () => {
    withControlledTimeouts(({ pending }) => {
        withControlledFrames(({ next }) => {
            const { suggest } = createTableCommandHarness();
            const table = makeEditor('|     |     |');
            const realEditor = makeEditor('|||');

            suggest.openFromCommand(table, null);
            assert.equal(pending().length, 1);
            assert.ok(suggest.onTrigger(realEditor.getCursor(), realEditor, null));
            next();
            assert.equal(suggest.isOpen, true);
            assert.equal(pending().length, 0);
        });
    });
});

test('closing or replacing an unfinished command cancels its timeout', () => {
    withControlledTimeouts(({ pending }) => {
        const { suggest } = createTableCommandHarness();
        const table = makeEditor('|     |     |');

        suggest.openFromCommand(table, null);
        assert.equal(pending().length, 1);
        suggest.openFromCommand(table, null);
        assert.equal(pending().length, 1, 'Starting a new command must cancel the older timeout');

        suggest.close();
        assert.equal(pending().length, 0, 'Closing a command must cancel the timeout');
    });
});
