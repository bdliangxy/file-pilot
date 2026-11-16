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

function makeState(text, { live = true, excluded = [], selections = [] } = {}) {
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
        selection: {
            ranges: selections.map(({ from, to }) => ({
                from,
                to,
                empty: from === to,
            })),
        },
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
    selections = [],
    sharedService = null,
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
    const service = sharedService ?? new FileReferenceService();
    if (!sharedService) service.rebuildReferenceIndex(records);
    const actions = [];
    const previewEvents = [];
    const existingNotes = new Set(records.map(record => record.shadowNotePath));
    let executeAction = async (action, record) => {
        actions.push({ action, record });
    };
    const app = {
        vault: {
            getFileByPath: path => existingNotes.has(path) ? { path } : null,
        },
        workspace: {
            trigger: (name, payload) => previewEvents.push({ name, payload }),
        },
    };
    const extension = createFileReferenceEditorExtension(
        service, app, (action, record) => executeAction(action, record),
    );
    const state = makeState(text, { live, excluded, selections });
    const dispatched = [];
    const view = {
        state,
        visibleRanges,
        dispatch(spec) {
            dispatched.push(spec);
            const effects = Array.isArray(spec.effects)
                ? spec.effects
                : [spec.effects];
            plugin.update({
                view,
                startState: view.state,
                state: view.state,
                docChanged: false,
                viewportChanged: false,
                selectionSet: false,
                transactions: [{ effects }],
            });
        },
    };
    const plugin = extension.create(view);
    t.after(() => plugin.destroy());
    return {
        plugin, extension, state, view, service, actions, previewEvents,
        existingNotes, app, window: dom.window, dispatched,
        setExecuteAction(callback) { executeAction = callback; },
    };
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

test('selected full reference uses the selected widget class', t => {
    const ref = shortRef(ID_A);
    const text = `before ${ref} after`;
    const from = text.indexOf(ref);
    const ctx = setup(t, text, {
        selections: [{ from, to: from + ref.length }],
    });
    const widget = rendered(ctx)[0].dom;

    assert.equal(widget.classList.contains('file-pilot-reference-selected'), true);
    assert.equal(widget.contentEditable, 'false');
});

test('partial selection does not mark a reference fully selected', t => {
    const ref = shortRef(ID_A);
    const text = `before ${ref} after`;
    const from = text.indexOf(ref);
    const ctx = setup(t, text, {
        selections: [{ from: from + 2, to: from + ref.length }],
    });

    assert.equal(
        rendered(ctx)[0].dom.classList.contains('file-pilot-reference-selected'),
        false,
    );
});

test('selection change refreshes the selected widget without editing source text', t => {
    const ref = shortRef(ID_A);
    const text = `before ${ref} after`;
    const from = text.indexOf(ref);
    const ctx = setup(t, text);
    const original = ctx.view.state;
    const initialWidget = decorations(ctx)[0].widget;

    assert.equal(rendered(ctx)[0].dom.classList.contains('file-pilot-reference-selected'), false);

    ctx.view.state = makeState(text, {
        selections: [{ from, to: from + ref.length }],
    });
    ctx.plugin.update({
        view: ctx.view,
        startState: original,
        state: ctx.view.state,
        docChanged: false,
        viewportChanged: false,
        selectionSet: true,
    });

    assert.equal(rendered(ctx)[0].dom.classList.contains('file-pilot-reference-selected'), true);
    assert.equal(initialWidget.eq(decorations(ctx)[0].widget), false);

    const selectedState = ctx.view.state;
    ctx.view.state = makeState(text);
    ctx.plugin.update({
        view: ctx.view,
        startState: selectedState,
        state: ctx.view.state,
        docChanged: false,
        viewportChanged: false,
        selectionSet: true,
    });
    assert.equal(rendered(ctx)[0].dom.classList.contains('file-pilot-reference-selected'), false);
    assert.equal(ctx.view.state.doc.length, text.length);
});

test('atomic range provider reuses decorations and returns none when plugin is absent', t => {
    const ref = shortRef(ID_A);
    const ctx = setup(t, ref);
    const atomic = ctx.extension.provided[0];

    assert.equal(atomic.kind, 'atomicRanges');
    assert.equal(atomic.readRanges({ plugin: extension => extension === ctx.extension ? ctx.plugin : null }), decorations(ctx));
    assert.deepEqual(atomic.readRanges({ plugin: () => null }), []);
});

test('Source Mode has no selected widgets or atomic ranges', t => {
    const ref = shortRef(ID_A);
    const ctx = setup(t, ref, {
        live: false,
        selections: [{ from: 0, to: ref.length }],
    });
    const atomic = ctx.extension.provided[0];
    assert.equal(rendered(ctx).length, 0);
    assert.deepEqual(atomic.readRanges({ plugin: () => ctx.plugin }), []);
});

function widgetMouse(ctx, element, type, options = {}) {
    const event = new ctx.window.MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0,
        detail: type === 'dblclick' ? 2 : 1, ...options,
    });
    element.dispatchEvent(event);
    return event;
}

async function flushWidgetActions() {
    await new Promise(resolve => setImmediate(resolve));
}

test('Live Preview widget shares file gestures without intercepting ordinary clicks', async t => {
    const ctx = setup(t, shortRef(ID_A));
    const element = rendered(ctx)[0].dom;

    assert.equal(widgetMouse(ctx, element, 'click').defaultPrevented, false);
    assert.equal(widgetMouse(ctx, element, 'dblclick').defaultPrevented, true);
    assert.equal(widgetMouse(ctx, element, 'click', { ctrlKey: true }).defaultPrevented, true);
    assert.equal(widgetMouse(ctx, element, 'click', { altKey: true }).defaultPrevented, true);
    await flushWidgetActions();

    assert.deepEqual(ctx.actions.map(item => item.action), [
        'openSource', 'openShadowNote', 'openContainingFolder',
    ]);
    assert.ok(ctx.actions.every(item => item.record.id === ID_A));
});

test('Live Preview hover previews the current Shadow Note with a stable hover parent', t => {
    const record = makeFileRecord(ID_A, {
        shadowNotePath: 'ShadowNotes/report.md',
    });
    const ctx = setup(t, shortRef(ID_A), { records: [record] });
    const element = rendered(ctx)[0].dom;

    widgetMouse(ctx, element, 'mouseover');
    assert.equal(ctx.previewEvents.length, 1);
    assert.equal(ctx.previewEvents[0].name, 'hover-link');
    assert.equal(ctx.previewEvents[0].payload.source, 'file-pilot');
    assert.equal(ctx.previewEvents[0].payload.targetEl, element);
    assert.equal(ctx.previewEvents[0].payload.linktext, record.shadowNotePath);
    const hoverParent = ctx.previewEvents[0].payload.hoverParent;
    assert.equal(hoverParent.hoverPopover, null);

    const updated = makeFileRecord(ID_A, {
        shadowNotePath: 'ShadowNotes/renamed.md',
    });
    ctx.existingNotes.add(updated.shadowNotePath);
    ctx.service.rebuildReferenceIndex([updated]);
    widgetMouse(ctx, element, 'mouseover');
    assert.equal(ctx.previewEvents[1].payload.linktext, updated.shadowNotePath);
    assert.equal(ctx.previewEvents[1].payload.hoverParent, hoverParent);
});

test('Live Preview widget re-resolves records for actions and ignores deleted records', async t => {
    const ctx = setup(t, shortRef(ID_A), {
        records: [makeFileRecord(ID_A, { path: 'docs/old.pdf' })],
    });
    const element = rendered(ctx)[0].dom;
    ctx.service.rebuildReferenceIndex([
        makeFileRecord(ID_A, { path: 'docs/renamed.pdf' }),
    ]);
    widgetMouse(ctx, element, 'dblclick');
    await flushWidgetActions();
    assert.equal(ctx.actions[0].record.path, 'docs/renamed.pdf');

    ctx.service.rebuildReferenceIndex([]);
    widgetMouse(ctx, element, 'dblclick');
    widgetMouse(ctx, element, 'mouseover');
    await flushWidgetActions();
    assert.equal(ctx.actions.length, 1);
    assert.equal(ctx.previewEvents.length, 0);
});

test('Live Preview missing source supports only Shadow Note action and hover', async t => {
    const record = makeFileRecord(ID_A, { status: 'missing' });
    const ctx = setup(t, shortRef(ID_A), { records: [record] });
    const element = rendered(ctx)[0].dom;

    assert.equal(element.textContent, 'report.pdf (Missing)');
    widgetMouse(ctx, element, 'dblclick');
    widgetMouse(ctx, element, 'click', { altKey: true });
    widgetMouse(ctx, element, 'click', { ctrlKey: true });
    widgetMouse(ctx, element, 'mouseover');
    await flushWidgetActions();

    assert.deepEqual(ctx.actions.map(item => item.action), ['openShadowNote']);
    assert.equal(ctx.previewEvents[0].payload.linktext, record.shadowNotePath);
});

test('Live Preview unresolved references never open files or preview Shadow Notes', async t => {
    const ctx = setup(t, fullRef(ID_B), { records: [] });
    const element = rendered(ctx)[0].dom;

    assert.equal(element.classList.contains('file-pilot-reference-unresolved'), true);
    widgetMouse(ctx, element, 'dblclick');
    widgetMouse(ctx, element, 'click', { ctrlKey: true });
    widgetMouse(ctx, element, 'mouseover');
    await flushWidgetActions();

    assert.deepEqual(ctx.actions, []);
    assert.deepEqual(ctx.previewEvents, []);
});

test('Live Preview widget reports rejected file actions through the shared notifier', async t => {
    const ctx = setup(t, shortRef(ID_A));
    const previousError = console.error;
    const messages = [];
    const { Notice } = await import('../fakes/obsidian-settings.mjs');
    const before = Notice.messages.length;
    console.error = (...args) => messages.push(args);
    ctx.setExecuteAction(async () => { throw new Error('simulated failure'); });
    try {
        widgetMouse(ctx, rendered(ctx)[0].dom, 'dblclick');
        await flushWidgetActions();
        assert.equal(messages.length, 1);
        assert.equal(Notice.messages.length, before + 1);
    } finally {
        console.error = previousError;
    }
});

async function flushReferenceRefresh() {
    await new Promise(resolve => setImmediate(resolve));
}

test('index rebuild refreshes an existing widget without changing editor document', async t => {
    const record = makeFileRecord(ID_A, { path: 'docs/original.pdf' });
    const ctx = setup(t, shortRef(ID_A), { records: [record] });
    const beforeDoc = ctx.view.state.doc;
    const beforeWidget = decorations(ctx)[0].widget;

    ctx.service.rebuildReferenceIndex([
        makeFileRecord(ID_A, { path: 'docs/renamed.pdf' }),
    ]);

    assert.equal(ctx.dispatched.length, 0, 'refresh is deferred');
    await flushReferenceRefresh();

    assert.equal(ctx.dispatched.length, 1);
    assert.equal(rendered(ctx)[0].dom.textContent, 'renamed.pdf');
    assert.equal(ctx.view.state.doc, beforeDoc);
    assert.equal(beforeWidget.eq(decorations(ctx)[0].widget), false);
});

test('multiple index rebuilds in the same turn coalesce into one refresh', async t => {
    const ctx = setup(t, shortRef(ID_A));
    ctx.service.rebuildReferenceIndex([
        makeFileRecord(ID_A, { path: 'docs/intermediate.pdf' }),
    ]);
    ctx.service.rebuildReferenceIndex([
        makeFileRecord(ID_A, { path: 'docs/final.pdf' }),
    ]);
    await flushReferenceRefresh();

    assert.equal(ctx.dispatched.length, 1);
    assert.equal(rendered(ctx)[0].dom.textContent, 'final.pdf');
});

test('index removal and reappearance update unresolved widget state', async t => {
    const ctx = setup(t, shortRef(ID_A));

    ctx.service.rebuildReferenceIndex([]);
    await flushReferenceRefresh();
    assert.equal(rendered(ctx)[0].dom.textContent, 'This file is not recorded');
    assert.equal(rendered(ctx)[0].dom.classList.contains('file-pilot-reference-unresolved'), true);

    ctx.service.rebuildReferenceIndex([
        makeFileRecord(ID_A, { path: 'docs/restored.pdf' }),
    ]);
    await flushReferenceRefresh();
    assert.equal(rendered(ctx)[0].dom.textContent, 'restored.pdf');
    assert.equal(rendered(ctx)[0].dom.classList.contains('file-pilot-reference-unresolved'), false);
    assert.equal(ctx.dispatched.length, 2);
});

test('separate editor instances respond independently to a shared index', async t => {
    const first = setup(t, shortRef(ID_A));
    const second = setup(t, shortRef(ID_A), {
        sharedService: first.service,
    });

    first.service.rebuildReferenceIndex([
        makeFileRecord(ID_A, { path: 'docs/shared.pdf' }),
    ]);
    await flushReferenceRefresh();

    assert.equal(first.dispatched.length, 1);
    assert.equal(second.dispatched.length, 1);
    assert.equal(rendered(first)[0].dom.textContent, 'shared.pdf');
    assert.equal(rendered(second)[0].dom.textContent, 'shared.pdf');
    assert.equal(first.view.state.doc, first.state.doc);
    assert.equal(second.view.state.doc, second.state.doc);
});

test('destroy before queued refresh prevents dispatch and unsubscribes', async t => {
    const ctx = setup(t, shortRef(ID_A));
    ctx.service.rebuildReferenceIndex([]);
    ctx.plugin.destroy();

    await flushReferenceRefresh();
    assert.equal(ctx.dispatched.length, 0);

    ctx.service.rebuildReferenceIndex([makeFileRecord(ID_A)]);
    await flushReferenceRefresh();
    assert.equal(ctx.dispatched.length, 0);
});

test('Source Mode receives refresh signals but keeps raw references undecorated', async t => {
    const ctx = setup(t, shortRef(ID_A), { live: false });
    ctx.service.rebuildReferenceIndex([]);
    await flushReferenceRefresh();

    assert.equal(ctx.dispatched.length, 1);
    assert.equal(decorations(ctx).length, 0);
});


test('Live Preview renders only references in a dedicated tree fence and normal prose', t => {
    const ref = shortRef(ID_A);
    const text = [
        '```typescript',
        ref,
        '```',
        '```file-pilot-tree',
        'Project/',
        '├── ' + ref + ' # Summary',
        '└── Empty/',
        '```',
        'Outside ' + ref,
    ].join('\n');
    const first = text.indexOf(ref);
    const second = text.indexOf(ref, first + ref.length);
    const third = text.indexOf(ref, second + ref.length);
    const ctx = setup(t, text, {
        excluded: [
            { from: first, to: first + ref.length, name: 'FencedCode' },
            { from: second, to: second + ref.length, name: 'FencedCode' },
        ],
    });

    assert.deepEqual(rendered(ctx).map(item => item.from), [second, third]);
    assert.deepEqual(
        rendered(ctx).map(item => item.dom.textContent),
        ['report.pdf', 'report.pdf'],
    );
});

test('tree body detection respects fence length, marker type, and closing fence', t => {
    const ref = shortRef(ID_A);
    const text = [
        '````file-pilot-tree',
        ref,
        '```',
        ref,
        '````',
        '```typescript',
        ref,
        '```',
        '~~~file-pilot-tree',
        ref,
        '~~~',
    ].join('\n');
    const offsets = [...text.matchAll(/\|\|\|@[^|]+\|\|\|/g)]
        .map(match => match.index);
    const ctx = setup(t, text, {
        excluded: offsets.map(from => ({
            from, to: from + ref.length, name: 'FencedCode',
        })),
    });

    assert.deepEqual(decorations(ctx).map(item => item.from), [
        offsets[0], offsets[1], offsets[3],
    ]);
});

test('tree fence markers are not treated as tree body text', t => {
    const ref = shortRef(ID_A);
    const text = [
        '```file-pilot-tree ' + ref,
        '├── ' + ref,
        '```',
        '~~~file-pilot-tree',
        '└── ' + ref,
        '~~~',
    ].join('\n');
    const offsets = [...text.matchAll(/\|\|\|@[^|]+\|\|\|/g)]
        .map(match => match.index);
    const ctx = setup(t, text, {
        excluded: offsets.map(from => ({
            from, to: from + ref.length, name: 'FencedCode',
        })),
    });

    assert.deepEqual(decorations(ctx).map(item => item.from), [
        offsets[1], offsets[2],
    ]);
});

test('tree references remain raw in Source Mode', t => {
    const ref = shortRef(ID_A);
    const text = ['```file-pilot-tree', '├── ' + ref, '```'].join('\n');
    const ctx = setup(t, text, { live: false });

    assert.deepEqual(decorations(ctx), []);
    assert.equal(ctx.state.doc.length, text.length);
});

test('rebuilding decorations after an edited tree fence updates the rendered references', t => {
    const ref = shortRef(ID_A);
    const before = ['```file-pilot-tree', ref, '```'].join('\n');
    const after = ['```text', ref, '```'].join('\n');
    const ctx = setup(t, before, {
        excluded: [{
            from: before.indexOf(ref),
            to: before.indexOf(ref) + ref.length,
            name: 'FencedCode',
        }],
    });
    assert.equal(decorations(ctx).length, 1);

    const previous = ctx.view.state;
    ctx.view.state = makeState(after, {
        excluded: [{
            from: after.indexOf(ref),
            to: after.indexOf(ref) + ref.length,
            name: 'FencedCode',
        }],
    });
    ctx.view.visibleRanges = [{ from: 0, to: after.length }];
    ctx.plugin.update({
        view: ctx.view,
        startState: previous,
        state: ctx.view.state,
        docChanged: true,
        viewportChanged: false,
        selectionSet: false,
        transactions: [],
    });

    assert.equal(decorations(ctx).length, 0);
});
