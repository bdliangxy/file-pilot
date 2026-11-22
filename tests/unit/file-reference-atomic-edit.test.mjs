import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { EditorState } from '@codemirror/state';
import { editorLivePreviewField, setLivePreviewMode } from '../fakes/obsidian-plugin.mjs';
import { setSyntaxExclusions } from '../fakes/codemirror-language.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-plugin.mjs', import.meta.url)),
        '@codemirror/view': fileURLToPath(new URL('../fakes/codemirror-view.mjs', import.meta.url)),
        '@codemirror/language': fileURLToPath(new URL('../fakes/codemirror-language.mjs', import.meta.url)),
    },
});
const { createFileReferenceEditorExtension } = await jiti.import(
    '../../src/ui/file-reference-editor-extension.ts',
);
const { FileReferenceService } = await jiti.import(
    '../../src/core/file-reference-service.ts',
);

const ID_A = 'Ab7Xc9Km2LdQ';
const ID_B = 'Zk3Mr6Tn8PwV';
const REF_A = `|||@${ID_A}|||`;
const REF_B = `|||@${ID_B}|||`;

// Use the real CodeMirror state and transaction engine, with a lightweight view.
function editor(text, { live = true, exclusions = [] } = {}) {
    const extension = createFileReferenceEditorExtension(new FileReferenceService());
    const filter = extension.provided.find(item => item !== undefined && item !== null
        && item !== extension.provided[0]);
    const state = EditorState.create({
        doc: text,
        extensions: [editorLivePreviewField, filter],
    });
    if (!live) {
        return { state: state.update({ effects: setLivePreviewMode.of(false) }).state, extension };
    }
    setSyntaxExclusions(state, exclusions);
    return { state, extension };
}

function apply(text, changes, options = {}) {
    const { state } = editor(text, options);
    return state.update({ changes });
}

test('extension exposes an atomic-range provider beside its transaction filter', () => {
    const { extension } = editor(REF_A);
    assert.equal(extension.provided.length, 2);
    assert.equal(extension.provided[0].kind, 'atomicRanges');
    assert.equal(typeof extension.provided[0].readRanges, 'function');
});

test('ordinary text deletion and insertion remain unchanged', () => {
    const text = `abc ${REF_A} xyz`;
    assert.equal(apply(text, { from: 0, to: 3 }).newDoc.toString(), ` ${REF_A} xyz`);
    assert.equal(apply(text, { from: 1, insert: 'Q' }).newDoc.toString(), `aQbc ${REF_A} xyz`);
});

test('complete reference deletion is allowed without changing surrounding text', () => {
    const text = `before ${REF_A} after`;
    const from = text.indexOf(REF_A);
    assert.equal(
        apply(text, { from, to: from + REF_A.length }).newDoc.toString(),
        'before  after',
    );
});

test('partial deletion inside a reference deletes the entire reference', () => {
    const text = `left ${REF_A} right`;
    const start = text.indexOf(REF_A);
    for (const [from, to] of [
        [start + 1, start + 4],
        [start + 4, start + 9],
        [start + REF_A.length - 3, start + REF_A.length],
    ]) {
        assert.equal(apply(text, { from, to }).newDoc.toString(), 'left  right');
    }
});

test('partial replacement preserves inserted text but removes the full reference', () => {
    const text = `left ${REF_A} right`;
    const start = text.indexOf(REF_A);
    assert.equal(
        apply(text, { from: start + 4, to: start + 8, insert: 'X' }).newDoc.toString(),
        'left X right',
    );
});

test('partial overlap at either edge expands to the full reference', () => {
    const text = `abc ${REF_A} xyz`;
    const start = text.indexOf(REF_A);
    const end = start + REF_A.length;
    assert.equal(
        apply(text, { from: 2, to: start + 6 }).newDoc.toString(),
        'ab xyz',
    );
    assert.equal(
        apply(text, { from: end - 4, to: text.length }).newDoc.toString(),
        'abc ',
    );
});

test('pure insertion inside a reference is rejected', () => {
    const text = `a${REF_A}b`;
    const position = text.indexOf(REF_A) + 5;
    assert.equal(apply(text, { from: position, insert: 'Q' }).newDoc.toString(), text);
});

test('insertions immediately before and after a reference remain allowed', () => {
    const text = `a${REF_A}b`;
    const from = text.indexOf(REF_A);
    const to = from + REF_A.length;
    assert.equal(
        apply(text, { from, insert: 'Q' }).newDoc.toString(),
        `aQ${REF_A}b`,
    );
    assert.equal(
        apply(text, { from: to, insert: 'Q' }).newDoc.toString(),
        `a${REF_A}Qb`,
    );
});

test('wide deletion removes intervening references without special treatment', () => {
    const text = `AA${REF_A} BB ${REF_B}ZZ`;
    const from = text.indexOf(REF_A) - 1;
    const to = text.indexOf(REF_B) + REF_B.length + 1;
    assert.equal(apply(text, { from, to }).newDoc.toString(), 'AZ');
});

test('source mode does not intercept editing inside reference syntax', () => {
    const text = REF_A;
    const { state } = editor(text, { live: false });
    assert.equal(
        state.update({ changes: { from: 5, to: 7, insert: 'Q' } }).newDoc.toString(),
        text.slice(0, 5) + 'Q' + text.slice(7),
    );
});

test('code contexts do not receive atomic edit protection', () => {
    const text = REF_A;
    const { state } = editor(text, {
        exclusions: [{ from: 0, to: text.length, name: 'FencedCode' }],
    });
    const transaction = state.update({ changes: { from: 4, to: 6 } });
    assert.equal(transaction.newDoc.toString(), text.slice(0, 4) + text.slice(6));
});

test('unknown but syntactically valid references are still protected', () => {
    const text = `x ${REF_A} y`;
    assert.equal(
        apply(text, { from: 5, to: 8 }).newDoc.toString(),
        'x  y',
    );
});

test('multiple independent changes preserve their surrounding text', () => {
    const text = `x ${REF_A} middle ${REF_B} y`;
    const first = text.indexOf(REF_A);
    const second = text.indexOf(REF_B);
    assert.equal(
        apply(text, [
            { from: first + 3, to: first + 6, insert: 'A' },
            { from: second + 3, to: second + 6, insert: 'B' },
        ]).newDoc.toString(),
        'x A middle B y',
    );
});

test('a conflict between two edits of the same reference rejects the transaction', () => {
    const text = `x ${REF_A} y`;
    const from = text.indexOf(REF_A);
    assert.equal(
        apply(text, [
            { from: from + 3, to: from + 5 },
            { from: from + 7, to: from + 9 },
        ]).newDoc.toString(),
        text,
    );
});

test('selection-only transactions leave the source document intact', () => {
    const text = `before ${REF_A} after`;
    const { state } = editor(text);
    const result = state.update({ selection: { anchor: 0, head: 3 } });
    assert.equal(result.newDoc.toString(), text);
    assert.equal(result.newSelection.main.from, 0);
    assert.equal(result.newSelection.main.to, 3);
});


test('tree fence references remain atomic in Live Preview', () => {
    const text = ['```file-pilot-tree', '├── ' + REF_A + ' # Summary', '```'].join('\n');
    const start = text.indexOf(REF_A);
    const exclusions = [{
        from: start, to: start + REF_A.length, name: 'FencedCode',
    }];

    assert.equal(
        apply(text, { from: start + 4, to: start + 7 }, { exclusions })
            .newDoc.toString(),
        text.slice(0, start) + text.slice(start + REF_A.length),
    );
    assert.equal(
        apply(text, { from: start + 4, insert: 'X' }, { exclusions })
            .newDoc.toString(),
        text,
    );
});

test('tree lines and summary annotations remain freely editable', () => {
    const text = ['```file-pilot-tree', '├── ' + REF_A + ' # Summary', '```'].join('\n');
    const start = text.indexOf(REF_A);
    const exclusions = [{
        from: start, to: start + REF_A.length, name: 'FencedCode',
    }];
    const comment = text.indexOf('Summary');
    const result = apply(
        text, { from: comment, to: comment + 'Summary'.length, insert: 'Edited' },
        { exclusions },
    );

    assert.equal(result.newDoc.toString(), text.replace('Summary', 'Edited'));
});

test('normal code fences and Source Mode do not atomically protect tree-looking references', () => {
    const normal = ['```text', REF_A, '```'].join('\n');
    const normalStart = normal.indexOf(REF_A);
    const exclusions = [{
        from: normalStart, to: normalStart + REF_A.length, name: 'FencedCode',
    }];
    const normalResult = apply(
        normal, { from: normalStart + 4, to: normalStart + 7 }, { exclusions },
    );
    assert.equal(
        normalResult.newDoc.toString(),
        normal.slice(0, normalStart + 4) + normal.slice(normalStart + 7),
    );

    const tree = ['```file-pilot-tree', REF_A, '```'].join('\n');
    const treeStart = tree.indexOf(REF_A);
    const { state } = editor(tree, { live: false });
    const sourceResult = state.update({
        changes: { from: treeStart + 4, to: treeStart + 7 },
    });
    assert.equal(
        sourceResult.newDoc.toString(),
        tree.slice(0, treeStart + 4) + tree.slice(treeStart + 7),
    );
});
