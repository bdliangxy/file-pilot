import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { makeFileRecord } from '../factories/file-record.mjs';
import { Notice } from '../fakes/obsidian-settings.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-plugin.mjs', import.meta.url)),
    },
});
const { FileReferenceReadingRenderer } = await jiti.import('../../src/ui/file-reference-reading-renderer.ts');
const { FileReferenceService } = await jiti.import('../../src/core/file-reference-service.ts');
const { generateShortKey } = await jiti.import('../../src/utils/file-reference-utils.ts');

const ID_A = '550e8400-e29b-41d4-a716-446655440000';
const ID_B = '6fa459ea-ee8a-3ca4-894e-db77e160355e';
const shortRef = id => '|||@' + generateShortKey(id) + '|||';
const fullRef = id => '|||!' + id + '|||';

function setup(t, records = [makeFileRecord(ID_A)]) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const previous = {
        document: globalThis.document,
        NodeFilter: globalThis.NodeFilter,
        createSpan: globalThis.createSpan,
        createFragment: globalThis.createFragment,
    };
    globalThis.document = dom.window.document;
    globalThis.NodeFilter = dom.window.NodeFilter;
    globalThis.createSpan = ({ cls }) => {
        const element = dom.window.document.createElement('span');
        element.className = cls;
        return element;
    };
    globalThis.createFragment = () => dom.window.document.createDocumentFragment();
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
        dom.window.close();
    });
    const service = new FileReferenceService();
    service.rebuildReferenceIndex(records);
    const actions = [];
    let executeAction = async (action, record) => {
        actions.push({ action, record });
    };
    const renderer = new FileReferenceReadingRenderer(
        service, (action, record) => executeAction(action, record),
    );
    return {
        renderer, service, actions, document: dom.window.document, window: dom.window,
        setExecuteAction(callback) { executeAction = callback; },
    };
}

function paragraph(ctx, content) {
    const p = ctx.document.createElement('p');
    p.textContent = content;
    ctx.document.body.append(p);
    return p;
}

function references(ctx) {
    return [...ctx.document.querySelectorAll('.file-pilot-reference')];
}

function mouse(ctx, element, type, options = {}) {
    const event = new ctx.window.MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0,
        detail: type === 'dblclick' ? 2 : 1, ...options,
    });
    element.dispatchEvent(event);
    return event;
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

test('renders short and full references with current file names', (t) => {
    const first = makeFileRecord(ID_A, { path: 'docs/report.pdf' });
    const second = makeFileRecord(ID_B, { path: 'assets/logo.png' });
    const ctx = setup(t, [first, second]);
    const p = paragraph(ctx, 'Read ' + shortRef(ID_A) + ' and ' + fullRef(ID_B) + ' today.');
    ctx.renderer.render(ctx.document.body);
    assert.equal(p.textContent, 'Read report.pdf and logo.png today.');
    assert.deepEqual(references(ctx).map(el => el.textContent), ['report.pdf', 'logo.png']);
});

test('preserves malformed candidates and ignores inline code, code blocks and links', (t) => {
    const ctx = setup(t);
    const raw = shortRef(ID_A);
    const p = paragraph(ctx, 'before |||@bad||| after ' + raw);
    for (const tag of ['code', 'pre', 'a']) {
        const el = ctx.document.createElement(tag);
        el.textContent = raw;
        p.append(el);
    }
    ctx.renderer.render(ctx.document.body);
    assert.equal(references(ctx).length, 1);
    assert.ok(p.textContent.includes('|||@bad|||'));
    for (const tag of ['code', 'pre', 'a']) {
        assert.equal(p.querySelector(tag).textContent, raw);
    }
});

test('does not duplicate existing reference elements when reprocessing', (t) => {
    const ctx = setup(t);
    const p = paragraph(ctx, 'Open ' + shortRef(ID_A) + '.');
    ctx.renderer.render(ctx.document.body);
    const element = references(ctx)[0];
    ctx.renderer.render(ctx.document.body);
    assert.deepEqual(references(ctx), [element]);
    assert.equal(p.textContent, 'Open report.pdf.');
});

test('shows missing and ambiguous references without attaching actions', (t) => {
    const first = makeFileRecord(ID_A);
    const duplicate = makeFileRecord(ID_A, { path: 'docs/duplicate.pdf' });
    const ctx = setup(t, [first, duplicate]);
    paragraph(ctx, shortRef(ID_A) + ' and ' + fullRef(ID_B));
    ctx.renderer.render(ctx.document.body);
    const elements = references(ctx);
    assert.deepEqual(elements.map(el => el.textContent), [
        'Ambiguous file reference', 'File reference not found',
    ]);
    assert.ok(elements.every(el => el.classList.contains('file-pilot-reference-unresolved')));
    for (const el of elements) mouse(ctx, el, 'dblclick');
    assert.deepEqual(ctx.actions, []);
});

test('reuses double-click, Ctrl-click and Alt-click without intercepting plain click', async (t) => {
    const ctx = setup(t);
    paragraph(ctx, shortRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const el = references(ctx)[0];
    assert.equal(mouse(ctx, el, 'dblclick').defaultPrevented, true);
    assert.equal(mouse(ctx, el, 'click', { ctrlKey: true }).defaultPrevented, true);
    assert.equal(mouse(ctx, el, 'click', { altKey: true }).defaultPrevented, true);
    assert.equal(mouse(ctx, el, 'click').defaultPrevented, false);
    await flush();
    assert.deepEqual(ctx.actions.map(a => a.action), [
        'openSource', 'openContainingFolder', 'openShadowNote',
    ]);
});

test('does not open a reference when Enter is pressed', (t) => {
    const ctx = setup(t);
    paragraph(ctx, shortRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    references(ctx)[0].dispatchEvent(new ctx.window.KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
    }));
    assert.deepEqual(ctx.actions, []);
});

test('re-resolves the record when clicked and refuses removed records', async (t) => {
    const ctx = setup(t, [makeFileRecord(ID_A, { path: 'docs/old.pdf' })]);
    paragraph(ctx, shortRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const el = references(ctx)[0];
    ctx.service.rebuildReferenceIndex([makeFileRecord(ID_A, { path: 'docs/new.pdf' })]);
    mouse(ctx, el, 'dblclick');
    await flush();
    assert.equal(ctx.actions[0].record.path, 'docs/new.pdf');
    ctx.service.rebuildReferenceIndex([]);
    mouse(ctx, el, 'dblclick');
    await flush();
    assert.equal(ctx.actions.length, 1);
});

test('reports asynchronous file-action failures through the shared notifier', async (t) => {
    const ctx = setup(t);
    paragraph(ctx, shortRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const previous = console.error;
    const errors = [];
    const noticeCount = Notice.messages.length;
    console.error = (...args) => errors.push(args);
    ctx.setExecuteAction(async () => { throw new Error('simulated open failure'); });
    try {
        mouse(ctx, references(ctx)[0], 'dblclick');
        await flush();
        assert.equal(errors.length, 1);
        assert.equal(Notice.messages.length, noticeCount + 1);
    } finally {
        console.error = previous;
    }
});
