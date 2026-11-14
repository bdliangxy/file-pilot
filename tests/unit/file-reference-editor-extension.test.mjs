import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { JSDOM } from 'jsdom';
import { makeFileRecord } from '../factories/file-record.mjs';
import { editorLivePreviewField } from '../fakes/obsidian-plugin.mjs';

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
const { generateShortKey } = await jiti.import(
    '../../src/utils/file-reference-utils.ts',
);
const { setLanguage, getLanguage } = await import('../fakes/obsidian.mjs');

const ID_A = '550e8400-e29b-41d4-a716-446655440000';
const ID_B = '6fa459ea-ee8a-3ca4-894e-db77e160355e';
const shortRef = id => `|||@${generateShortKey(id)}|||`;
const fullRef = id => `|||!${id}|||`;

function makeDocument(text) {
    const lines = text.split('\n');
    const positions = [];
    let position = 0;
    for (const [index, line] of lines.entries()) {
        positions.push({
            number: index + 1,
            from: position,
            to: position + line.length,
            text: line,
        });
        position += line.length + 1;
    }
    return {
        length: text.length,
        lineAt(offset) {
            assert.ok(offset >= 0 && offset <= text.length, 'valid document offset');
            return positions.find(line => offset <= line.to) ?? positions.at(-1);
        },
        line(number) {
            return positions[number - 1];
        },
    };
}

function makeState(text, { live = true, excluded = [] } = {}) {
    const doc = makeDocument(text);
    const syntaxTree = {
        resolveInner(position) {
            const exclusion = excluded.find(range =>
                position >= range.from && position < range.to);
            return exclusion
                ? { name: exclusion.name, parent: null }
                : { name: 'Text', parent: null };
        },
    };
    return {
        doc,
        syntaxTree,
        field(field, fallback) {
            assert.equal(field, editorLivePreviewField);
            return live ?? fallback;
        },
    };
}

function setup(t, text, {
    records = [makeFileRecord(ID_A)],
    live = true,
    visibleRanges = [{ from: 0, to: text.length }],
    excluded = [],
} = {}) {
    const previousCreateSpan = globalThis.createSpan;
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.createSpan = ({ cls }) => {
        const element = dom.window.document.createElement('span');
        element.className = cls;
        return element;
    };
    t.after(() => {
        if (previousCreateSpan === undefined) delete globalThis.createSpan;
        else globalThis.createSpan = previousCreateSpan;
        dom.window.close();
    });
    const service = new FileReferenceService();
    service.rebuildReferenceIndex(records);
    const extension = createFileReferenceEditorExtension(service);
    const state = makeState(text, { live, excluded });
    const view = { state, visibleRanges };
    const plugin = extension.create(view);
    return { plugin, extension, state, view, service };
}

function decorations(ctx) {
    return ctx.extension.decorations(ctx.plugin);
}

function rendered(ctx) {
    return decorations(ctx).map(range => ({
        from: range.from,
        to: range.to,
        dom: range.widget.toDOM(),
    }));
}

test('Live Preview replaces short and full references at document offsets', t => {
    const text = `before ${shortRef(ID_A)} then ${fullRef(ID_B)} after`;
    const ctx = setup(t, text, {
        records: [
            makeFileRecord(ID_A, { path: 'docs/report.pdf' }),
            makeFileRecord(ID_B, { path: 'images/logo.png' }),
        ],
    });
    const result = rendered(ctx);
    assert.deepEqual(result.map(item => item.dom.textContent), ['report.pdf', 'logo.png']);
    assert.deepEqual(
        result.map(item => [item.from, item.to]),
        [
            [text.indexOf(shortRef(ID_A)), text.indexOf(shortRef(ID_A)) + shortRef(ID_A).length],
            [text.indexOf(fullRef(ID_B)), text.indexOf(fullRef(ID_B)) + fullRef(ID_B).length],
        ],
    );
    assert.ok(result.every(item => item.dom.classList.contains('file-pilot-reference')));
    assert.ok(result.every(item => item.dom.contentEditable === 'false'));
});

test('Source Mode provides no replacement decorations', t => {
    const text = shortRef(ID_A);
    const ctx = setup(t, text, { live: false });
    assert.equal(decorations(ctx).length, 0);
});

test('valid but unknown, ambiguous, and missing-status records display their states', t => {
    const text = [shortRef(ID_A), fullRef(ID_B), fullRef(ID_A)].join(' ');
    const record = makeFileRecord(ID_A, { status: 'missing' });
    const ctx = setup(t, text, { records: [makeFileRecord(ID_A), record] });
    const items = rendered(ctx);
    assert.equal(items.length, 3);
    assert.equal(items[0].dom.textContent, 'Ambiguous file reference');
    assert.equal(items[1].dom.textContent, 'This file is not recorded');
    assert.equal(items[2].dom.textContent, 'report.pdf (Missing)');
    assert.ok(items[0].dom.classList.contains('file-pilot-reference-unresolved'));
    assert.ok(items[1].dom.classList.contains('file-pilot-reference-unresolved'));
    assert.ok(!items[2].dom.classList.contains('file-pilot-reference-unresolved'));
    assert.match(items[0].dom.title, /Multiple managed files/);
    assert.match(items[1].dom.title, /No managed file/);
});

test('malformed reference candidates are left untouched', t => {
    const text = `|||@invalid||| and ${shortRef(ID_A)}`;
    const ctx = setup(t, text);
    assert.equal(rendered(ctx).length, 1);
    assert.equal(decorations(ctx)[0].from, text.indexOf(shortRef(ID_A)));
});

test('complete-line scanning finds a reference split by the visible range boundary', t => {
    const text = `prefix ${shortRef(ID_A)} suffix`;
    const refStart = text.indexOf(shortRef(ID_A));
    const ctx = setup(t, text, {
        visibleRanges: [{ from: refStart + 5, to: refStart + 9 }],
    });
    assert.deepEqual(
        decorations(ctx).map(item => [item.from, item.to]),
        [[refStart, refStart + shortRef(ID_A).length]],
    );
});

test('multiple visible ranges on one line do not duplicate decorations', t => {
    const text = `prefix ${shortRef(ID_A)} suffix`;
    const refStart = text.indexOf(shortRef(ID_A));
    const ctx = setup(t, text, {
        visibleRanges: [
            { from: refStart + 2, to: refStart + 4 },
            { from: refStart + 8, to: refStart + 11 },
        ],
    });
    assert.equal(decorations(ctx).length, 1);
});

test('only references intersecting visible ranges receive decorations', t => {
    const text = `${shortRef(ID_A)} ------- ${fullRef(ID_B)}`;
    const ctx = setup(t, text, {
        visibleRanges: [{ from: 0, to: 4 }],
    });
    assert.equal(decorations(ctx).length, 1);
    assert.equal(decorations(ctx)[0].from, 0);
});

test('multiple Markdown lines retain correct absolute offsets and sorted ranges', t => {
    const text = `First line\n${shortRef(ID_A)}\nOther text\n${fullRef(ID_B)}`;
    const ctx = setup(t, text, {
        visibleRanges: [{ from: 9, to: text.length }],
    });
    assert.deepEqual(
        decorations(ctx).map(item => item.from),
        [text.indexOf(shortRef(ID_A)), text.indexOf(fullRef(ID_B))],
    );
});

test('references in excluded Markdown syntax are not decorated', t => {
    const ref = shortRef(ID_A);
    const kinds = ['CodeText', 'FencedCode', 'Link', 'Frontmatter', 'YAML', 'Math', 'HTML'];
    for (const name of kinds) {
        const ctx = setup(t, ref, { excluded: [{ from: 0, to: ref.length, name }] });
        assert.equal(decorations(ctx).length, 0, name);
    }
});

test('rebuilding after a mode change removes and restores decorations', t => {
    const text = shortRef(ID_A);
    const ctx = setup(t, text);
    assert.equal(decorations(ctx).length, 1);
    const previous = ctx.view.state;
    ctx.view.state = makeState(text, { live: false });
    ctx.plugin.update({
        view: ctx.view,
        startState: previous,
        state: ctx.view.state,
        docChanged: false,
        viewportChanged: false,
    });
    assert.equal(decorations(ctx).length, 0);
    const sourceState = ctx.view.state;
    ctx.view.state = makeState(text, { live: true });
    ctx.plugin.update({
        view: ctx.view,
        startState: sourceState,
        state: ctx.view.state,
        docChanged: false,
        viewportChanged: false,
    });
    assert.equal(decorations(ctx).length, 1);
});

test('document and viewport changes rebuild decorations', t => {
    const text = shortRef(ID_A);
    const ctx = setup(t, text);
    assert.equal(decorations(ctx).length, 1);
    const firstState = ctx.view.state;
    ctx.view.state = makeState('nothing here');
    ctx.view.visibleRanges = [{ from: 0, to: ctx.view.state.doc.length }];
    ctx.plugin.update({
        view: ctx.view,
        startState: firstState,
        state: ctx.view.state,
        docChanged: true,
        viewportChanged: false,
    });
    assert.equal(decorations(ctx).length, 0);
    const secondState = ctx.view.state;
    ctx.view.state = makeState(text);
    ctx.view.visibleRanges = [{ from: 0, to: text.length }];
    ctx.plugin.update({
        view: ctx.view,
        startState: secondState,
        state: ctx.view.state,
        docChanged: false,
        viewportChanged: true,
    });
    assert.equal(decorations(ctx).length, 1);
});

test('Widget equality reflects displayed text, status, and hint', t => {
    const text = shortRef(ID_A);
    const ctx = setup(t, text);
    const widget = decorations(ctx)[0].widget;
    const same = decorations(ctx)[0].widget;
    assert.equal(widget.eq(same), true);
    const replacement = makeFileRecord(ID_A, { path: 'docs/renamed.pdf' });
    ctx.service.rebuildReferenceIndex([replacement]);
    const newCtx = setup(t, text, { records: [replacement] });
    assert.equal(widget.eq(decorations(newCtx)[0].widget), false);
});

test('Widget uses localized unresolved text and hint', t => {
    const original = getLanguage();
    setLanguage('zh');
    t.after(() => setLanguage(original));
    const text = fullRef(ID_B);
    const ctx = setup(t, text, { records: [] });
    const element = rendered(ctx)[0].dom;
    assert.equal(element.textContent, '该文件未被记录');
    assert.equal(element.title, '没有与此引用匹配的受管理文件。');
});
