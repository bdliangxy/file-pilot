import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
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

