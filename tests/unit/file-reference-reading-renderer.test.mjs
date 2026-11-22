import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { makeFileRecord } from '../factories/file-record.mjs';
import { Notice } from '../fakes/obsidian-settings.mjs';
import { getLanguage, setLanguage } from '../fakes/obsidian.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-plugin.mjs', import.meta.url)),
    },
});
const { FileReferenceReadingRenderer } = await jiti.import('../../src/ui/file-reference-reading-renderer.ts');
const { FileReferenceService } = await jiti.import('../../src/core/file-reference-service.ts');

const ID_A = 'Ab7Xc9Km2LdQ';
const ID_B = 'Zk3Mr6Tn8PwV';
const fileRef = id => '|||@' + id + '|||';

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
    const previewEvents = [];
    const existingNotes = new Set(records.map(record => record.shadowNotePath));
    const app = {
        vault: {
            getFileByPath: path => existingNotes.has(path) ? { path } : null,
        },
        workspace: {
            trigger: (name, payload) => previewEvents.push({ name, payload }),
        },
    };
    const renderer = new FileReferenceReadingRenderer(
        app, service, (action, record) => executeAction(action, record),
    );
    return {
        renderer, service, actions, previewEvents, existingNotes,
        document: dom.window.document, window: dom.window,
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

test('renders file references with current file names', (t) => {
    const first = makeFileRecord(ID_A, { path: 'docs/report.pdf' });
    const second = makeFileRecord(ID_B, { path: 'assets/logo.png' });
    const ctx = setup(t, [first, second]);
    const p = paragraph(ctx, 'Read ' + fileRef(ID_A) + ' and ' + fileRef(ID_B) + ' today.');
    ctx.renderer.render(ctx.document.body);
    assert.equal(p.textContent, 'Read report.pdf and logo.png today.');
    assert.deepEqual(references(ctx).map(el => el.textContent), ['report.pdf', 'logo.png']);
});

test('previews the Shadow Note while displaying the real file name', (t) => {
    const record = makeFileRecord(ID_A, {
        path: 'docs/architecture.pdf',
        shadowNotePath: 'ShadowNotes/architecture.md',
    });
    const ctx = setup(t, [record]);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const element = references(ctx)[0];

    mouse(ctx, element, 'mouseover');

    assert.equal(element.textContent, 'architecture.pdf');
    assert.equal(ctx.previewEvents.length, 1);
    const { name, payload } = ctx.previewEvents[0];
    assert.equal(name, 'hover-link');
    assert.equal(payload.source, 'file-pilot');
    assert.equal(payload.targetEl, element);
    assert.equal(payload.linktext, record.shadowNotePath);
    assert.equal(payload.sourcePath, '');
    assert.equal(payload.hoverParent.hoverPopover, null);
});

test('reuses the hover parent and resolves the latest Shadow Note path', (t) => {
    const original = makeFileRecord(ID_A);
    const ctx = setup(t, [original]);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const element = references(ctx)[0];

    mouse(ctx, element, 'mouseover');
    const firstParent = ctx.previewEvents[0].payload.hoverParent;

    const updated = makeFileRecord(ID_A, {
        shadowNotePath: 'ShadowNotes/renamed.md',
    });
    ctx.existingNotes.add(updated.shadowNotePath);
    ctx.service.rebuildReferenceIndex([updated]);
    mouse(ctx, element, 'mouseover');

    assert.equal(ctx.previewEvents.length, 2);
    assert.equal(ctx.previewEvents[1].payload.linktext, updated.shadowNotePath);
    assert.equal(ctx.previewEvents[1].payload.hoverParent, firstParent);
});

test('does not preview when the Shadow Note is absent or the reference is removed', (t) => {
    const record = makeFileRecord(ID_A);
    const ctx = setup(t, [record]);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const element = references(ctx)[0];

    ctx.existingNotes.delete(record.shadowNotePath);
    mouse(ctx, element, 'mouseover');
    assert.equal(ctx.previewEvents.length, 0);

    ctx.existingNotes.add(record.shadowNotePath);
    ctx.service.rebuildReferenceIndex([]);
    mouse(ctx, element, 'mouseover');
    assert.equal(ctx.previewEvents.length, 0);
});

test('previews a Shadow Note even when its source file is missing', (t) => {
    const record = makeFileRecord(ID_A, { status: 'missing' });
    const ctx = setup(t, [record]);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const element = references(ctx)[0];

    mouse(ctx, element, 'mouseover');

    assert.equal(element.textContent, 'report.pdf (Missing)');
    assert.equal(ctx.previewEvents[0].payload.linktext, record.shadowNotePath);
});

test('preserves malformed candidates and ignores inline code, code blocks and links', (t) => {
    const ctx = setup(t);
    const raw = fileRef(ID_A);
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
    const p = paragraph(ctx, 'Open ' + fileRef(ID_A) + '.');
    ctx.renderer.render(ctx.document.body);
    const element = references(ctx)[0];
    ctx.renderer.render(ctx.document.body);
    assert.deepEqual(references(ctx), [element]);
    assert.equal(p.textContent, 'Open report.pdf.');
});

test('shows missing references without attaching actions', (t) => {
    const ctx = setup(t, []);
    paragraph(ctx, fileRef(ID_A) + ' and ' + fileRef(ID_B));
    ctx.renderer.render(ctx.document.body);
    const elements = references(ctx);
    assert.deepEqual(elements.map(el => el.textContent), [
        'This file is not recorded', 'This file is not recorded',
    ]);
    assert.ok(elements.every(el => el.classList.contains('file-pilot-reference-unresolved')));
    for (const el of elements) mouse(ctx, el, 'dblclick');
    assert.deepEqual(ctx.actions, []);
});

test('localizes missing references in Chinese', (t) => {
    const previousLanguage = getLanguage();
    setLanguage('zh');
    t.after(() => setLanguage(previousLanguage));

    const ctx = setup(t, []);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);

    const elements = references(ctx);
    assert.equal(elements.length, 1);
    assert.equal(elements[0].textContent, '该文件未被记录');
    assert.equal(elements[0].title, '没有与此引用匹配的受管理文件。');
    assert.ok(elements[0].classList.contains('file-pilot-reference-unresolved'));
    mouse(ctx, elements[0], 'dblclick');
    assert.deepEqual(ctx.actions, []);
});

test('localizes missing reference tooltips in English', (t) => {
    const previousLanguage = getLanguage();
    setLanguage('en');
    t.after(() => setLanguage(previousLanguage));

    const ctx = setup(t, []);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);

    const elements = references(ctx);
    assert.equal(elements.length, 1);
    assert.equal(elements[0].textContent, 'This file is not recorded');
    assert.equal(elements[0].title, 'No managed file matches this reference.');
});

test('falls back to English for unresolved references in unsupported locales', (t) => {
    const previousLanguage = getLanguage();
    setLanguage('fr');
    t.after(() => setLanguage(previousLanguage));

    const ctx = setup(t, []);
    paragraph(ctx, fileRef(ID_A));

    ctx.renderer.render(ctx.document.body);

    assert.equal(references(ctx)[0].textContent, 'This file is not recorded');
    assert.equal(references(ctx)[0].title, 'No managed file matches this reference.');
});

test('reuses double-click, Ctrl-click and Alt-click without intercepting plain click', async (t) => {
    const ctx = setup(t);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    const el = references(ctx)[0];
    assert.equal(mouse(ctx, el, 'dblclick').defaultPrevented, true);
    assert.equal(mouse(ctx, el, 'click', { ctrlKey: true }).defaultPrevented, true);
    assert.equal(mouse(ctx, el, 'click', { altKey: true }).defaultPrevented, true);
    assert.equal(mouse(ctx, el, 'click').defaultPrevented, false);
    await flush();
    assert.deepEqual(ctx.actions.map(a => a.action), [
        'openSource', 'openShadowNote', 'openContainingFolder',
    ]);
});

test('does not open a reference when Enter is pressed', (t) => {
    const ctx = setup(t);
    paragraph(ctx, fileRef(ID_A));
    ctx.renderer.render(ctx.document.body);
    references(ctx)[0].dispatchEvent(new ctx.window.KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
    }));
    assert.deepEqual(ctx.actions, []);
});

test('re-resolves the record when clicked and refuses removed records', async (t) => {
    const ctx = setup(t, [makeFileRecord(ID_A, { path: 'docs/old.pdf' })]);
    paragraph(ctx, fileRef(ID_A));
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
    paragraph(ctx, fileRef(ID_A));
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


test('renders File Pilot tree references while retaining tree text and summaries', t => {
    const record = makeFileRecord(ID_A, { path: 'docs/report.pdf' });
    const ctx = setup(t, [record]);
    const code = ctx.document.createElement('code');
    code.className = 'language-file-pilot-tree';
    code.textContent = 'Project/\n├── ' + fileRef(ID_A) + ' # Annual report\n└── EmptyFolder/';
    const pre = ctx.document.createElement('pre');
    pre.append(code);
    ctx.document.body.append(pre);

    ctx.renderer.render(ctx.document.body);

    assert.equal(code.textContent, 'Project/\n├── report.pdf # Annual report\n└── EmptyFolder/');
    assert.equal(code.querySelectorAll('.file-pilot-reference').length, 1);
    assert.equal(code.querySelector('.file-pilot-reference').contentEditable, 'false');

    ctx.renderer.render(ctx.document.body);
    assert.equal(code.querySelectorAll('.file-pilot-reference').length, 1);
});

test('accepts a tree language class on the pre element', t => {
    const ctx = setup(t);
    const pre = ctx.document.createElement('pre');
    pre.className = 'language-file-pilot-tree';
    const code = ctx.document.createElement('code');
    code.textContent = '└── ' + fileRef(ID_A);
    pre.append(code);
    ctx.document.body.append(pre);

    ctx.renderer.render(ctx.document.body);

    assert.equal(code.textContent, '└── report.pdf');
    assert.equal(references(ctx).length, 1);
});

test('keeps ordinary fenced and inline code raw beside a tree fence', t => {
    const ctx = setup(t);
    const ref = fileRef(ID_A);

    const tree = ctx.document.createElement('pre');
    const treeCode = ctx.document.createElement('code');
    treeCode.className = 'language-file-pilot-tree';
    treeCode.textContent = '├── ' + ref;
    tree.append(treeCode);

    const normal = ctx.document.createElement('pre');
    const normalCode = ctx.document.createElement('code');
    normalCode.className = 'language-typescript';
    normalCode.textContent = ref;
    normal.append(normalCode);

    const inline = ctx.document.createElement('code');
    inline.textContent = ref;
    ctx.document.body.append(tree, normal, inline);

    ctx.renderer.render(ctx.document.body);

    assert.equal(treeCode.textContent, '├── report.pdf');
    assert.equal(normalCode.textContent, ref);
    assert.equal(inline.textContent, ref);
    assert.equal(references(ctx).length, 1);
});

test('tree references reuse the existing file actions and link exclusions', async t => {
    const ctx = setup(t);
    const code = ctx.document.createElement('code');
    code.className = 'language-file-pilot-tree';
    code.textContent = '├── ' + fileRef(ID_A);
    const link = ctx.document.createElement('a');
    link.textContent = fileRef(ID_A);
    code.append(link);
    const pre = ctx.document.createElement('pre');
    pre.append(code);
    ctx.document.body.append(pre);

    ctx.renderer.render(ctx.document.body);

    assert.equal(link.textContent, fileRef(ID_A));
    const reference = code.querySelector('.file-pilot-reference');
    assert.ok(reference);
    mouse(ctx, reference, 'dblclick');
    await flush();
    assert.deepEqual(ctx.actions.map(action => action.action), ['openSource']);
});
