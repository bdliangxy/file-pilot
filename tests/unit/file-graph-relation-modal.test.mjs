import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Notice, TFile, TFolder } from '../fakes/obsidian-plugin.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-plugin.mjs', import.meta.url)),
    },
});
const { registerGraphRelationMenu } = await jiti.import('../../src/ui/obsidian-ui.ts');
const { FileGraphRelationModal } = await jiti.import('../../src/ui/file-graph-relation-modal.ts');
const { en } = await jiti.import('../../src/i18n/locales/en.ts');

function emitter() {
    const events = new Map();
    return {
        on(event, callback) {
            const listeners = events.get(event) ?? new Set();
            events.set(event, listeners);
            listeners.add(callback);
            return { off: () => listeners.delete(callback) };
        },
        offref(ref) { ref.off(); },
        emit(event, ...args) {
            for (const callback of events.get(event) ?? []) callback(...args);
        },
        count(event) { return events.get(event)?.size ?? 0; },
    };
}

function makeMenu() {
    const items = [];
    return {
        items,
        addItem(configure) {
            const item = {
                setTitle(title) { this.title = title; return this; },
                setIcon(icon) { this.icon = icon; return this; },
                onClick(handler) { this.handler = handler; return this; },
            };
            configure(item);
            items.push(item);
        },
    };
}

function connection(note, filePilotLink, otherLink = !filePilotLink) {
    return { note, filePilotLink, otherLink };
}

function setup(t) {
    const current = new TFile('ShadowNotes/Current.md');
    const managed = new TFile('ShadowNotes/Report.pdf.md');
    const ordinary = new TFile('Notes/Ordinary.md');
    const mixed = new TFile('Notes/Mixed.md');
    const portal = new TFile('PORTAL NOTE.md');
    const attachment = new TFile('assets/image.png');
    const files = new Map([current, managed, ordinary, mixed, portal, attachment]
        .map(file => [file.path, file]));
    const connections = {
        incoming: [connection(managed, true), connection(ordinary, false)],
        outgoing: [connection(mixed, true, true), connection(attachment, false)],
    };
    const calls = [];
    const service = {
        getNodeConnections: () => connections,
        async setNodeConnection(source, target, connected) {
            calls.push({ source, target, connected });
            const direction = source === current ? 'outgoing' : 'incoming';
            const note = source === current ? target : source;
            const list = connections[direction];
            const index = list.findIndex(item => item.note === note);
            if (connected) {
                if (index < 0) list.push(connection(note, true));
                else list[index].filePilotLink = true;
            } else if (index >= 0) {
                if (list[index].otherLink) list[index].filePilotLink = false;
                else list.splice(index, 1);
            }
            return true;
        },
    };
    const app = {
        openModals: new Set(),
        workspace: emitter(),
        metadataCache: emitter(),
        vault: {
            getFileByPath: path => files.get(path) ?? null,
            getMarkdownFiles: () => [...files.values()].filter(file => file.extension === 'md'),
        },
    };
    const cleanup = registerGraphRelationMenu(app, service);
    t.after(() => {
        cleanup();
        Notice.messages.length = 0;
    });
    function menuFor(file) {
        const menu = makeMenu();
        app.workspace.emit('file-menu', menu, file);
        return menu;
    }
    function open(file = current) {
        const menu = menuFor(file);
        assert.equal(menu.items.length, 1);
        menu.items[0].handler();
        return [...app.openModals].at(-1);
    }
    return {
        app, service, connections, calls, files, cleanup, menuFor, open,
        current, managed, ordinary, mixed, portal, attachment,
    };
}

function findAll(element, cls) {
    return [
        ...(element.classes.has(cls) ? [element] : []),
        ...element.children.flatMap(child => findAll(child, cls)),
    ];
}

function rows(modal) {
    return findAll(modal.contentEl, 'file-pilot-graph-connection');
}

function name(row) {
    return findAll(row, 'setting-item-name')[0].text;
}

function rowFor(modal, text) {
    const row = rows(modal).find(item => name(item) === text);
    assert.ok(row, 'Expected connection row: ' + text);
    return row;
}

function removeButton(row) {
    return findAll(row, 'extra-setting-button')[0];
}

function addButton(modal, direction) {
    const headings = findAll(modal.contentEl, 'setting-item-heading');
    const heading = headings[direction === 'incoming' ? 0 : 1];
    return findAll(heading, 'setting-item-control')[0].children[0];
}

function suggest(fixture, modal, direction) {
    addButton(modal, direction).click();
    return [...fixture.app.openModals].find(item => item !== modal);
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('relation menu is available for all Markdown notes but not attachments or folders', t => {
    const f = setup(t);
    for (const note of [f.current, f.ordinary, f.portal]) {
        const menu = f.menuFor(note);
        assert.equal(menu.items.length, 1);
        assert.equal(menu.items[0].title, en.graphEditRelations);
        assert.equal(menu.items[0].icon, 'git-branch');
    }
    for (const entry of [f.attachment, new TFolder('Notes')]) {
        assert.equal(f.menuFor(entry).items.length, 0);
    }
});

test('opening renders both directions, display names and editable versus read-only rows', t => {
    const f = setup(t);
    const modal = f.open();
    assert.equal(modal.title, en.graphEditRelations);
    assert.equal(f.app.metadataCache.count('resolved'), 1);
    const headings = findAll(modal.contentEl, 'setting-item-heading').map(name);
    assert.deepEqual(headings, [en.graphIncomingLinks + ' (2)', en.graphOutgoingLinks + ' (2)']);
    assert.deepEqual(rows(modal).map(name), ['Report.pdf', 'Ordinary.md', 'Mixed.md', 'image.png']);
    const descriptions = findAll(modal.contentEl, 'setting-item-description');
    assert.equal(descriptions[0].text, 'ShadowNotes/Current');
    const managed = rowFor(modal, 'Report.pdf');
    assert.equal(findAll(managed, 'file-pilot-file-path')[0].text, 'ShadowNotes/Report.pdf');
    assert.equal(findAll(managed, 'file-pilot-file-name').length, 1);
    for (const label of ['Report.pdf', 'Mixed.md']) {
        const row = rowFor(modal, label);
        assert.ok(row.classes.has('file-pilot-graph-connection-editable'));
        assert.equal(row.tooltip, undefined);
        assert.equal(removeButton(row).icon, 'trash-2');
        assert.equal(removeButton(row).tooltip.text, en.graphRemoveConnection);
    }
    for (const label of ['Ordinary.md', 'image.png']) {
        const row = rowFor(modal, label);
        assert.ok(!row.classes.has('file-pilot-graph-connection-editable'));
        assert.equal(removeButton(row), undefined);
        assert.equal(row.tooltip.text, en.graphOrdinaryLinkTooltip);
        assert.equal(row.tooltip.options.placement, 'top');
        assert.ok(row.tooltip.options.delay > 0);
    }
});

test('search excludes self and managed links only in the selected direction', t => {
    const f = setup(t);
    const modal = f.open();
    const incoming = suggest(f, modal, 'incoming');
    assert.equal(incoming.placeholder, en.graphSelectNote);
    assert.deepEqual(incoming.getItems(), [f.ordinary, f.mixed, f.portal]);
    incoming.close();
    const outgoing = suggest(f, modal, 'outgoing');
    assert.deepEqual(outgoing.getItems(), [f.managed, f.ordinary, f.portal]);
    assert.equal(outgoing.getItemText(f.managed), 'ShadowNotes/Report.pdf');
    assert.equal(outgoing.getItemText(f.ordinary), 'Notes/Ordinary.md');
});

test('selection adds incoming and outgoing connections with the correct endpoints', async t => {
    const f = setup(t);
    const modal = f.open();
    suggest(f, modal, 'incoming').chooseItem(f.ordinary);
    await settle();
    suggest(f, modal, 'outgoing').chooseItem(f.portal);
    await settle();
    assert.deepEqual(f.calls, [
        { source: f.ordinary, target: f.current, connected: true },
        { source: f.current, target: f.portal, connected: true },
    ]);
    assert.ok(removeButton(rowFor(modal, 'Ordinary.md')));
    assert.ok(removeButton(rowFor(modal, 'PORTAL NOTE.md')));
    assert.equal(f.app.openModals.size, 1);
});

test('deleting managed and mixed connections preserves the remaining ordinary link', async t => {
    const f = setup(t);
    const modal = f.open();
    removeButton(rowFor(modal, 'Report.pdf')).click();
    await settle();
    removeButton(rowFor(modal, 'Mixed.md')).click();
    await settle();
    assert.deepEqual(f.calls, [
        { source: f.managed, target: f.current, connected: false },
        { source: f.current, target: f.mixed, connected: false },
    ]);
    assert.ok(!rows(modal).some(row => name(row) === 'Report.pdf'));
    const mixed = rowFor(modal, 'Mixed.md');
    assert.equal(removeButton(mixed), undefined);
    assert.equal(mixed.tooltip.text, en.graphOrdinaryLinkTooltip);
});

test('a pending operation disables controls and rejects duplicate actions', async t => {
    const f = setup(t);
    const modal = f.open();
    let finish;
    f.service.setNodeConnection = (...args) => {
        f.calls.push(args);
        return new Promise(resolve => { finish = resolve; });
    };
    const button = removeButton(rowFor(modal, 'Report.pdf'));
    button.click();
    button.click();
    assert.equal(f.calls.length, 1);
    assert.equal(addButton(modal, 'incoming').disabled, true);
    assert.equal(addButton(modal, 'outgoing').disabled, true);
    assert.ok(findAll(modal.contentEl, 'extra-setting-button').every(el => el.disabled));
    addButton(modal, 'incoming').click();
    assert.equal(f.app.openModals.size, 1);
    finish(true);
    await settle();
    assert.equal(addButton(modal, 'incoming').disabled, false);
});

test('failed edit reports an error and restores enabled controls', async t => {
    const f = setup(t);
    const log = t.mock.method(console, 'error', () => {});
    f.service.setNodeConnection = async () => { throw new Error('write failed'); };
    const modal = f.open();
    removeButton(rowFor(modal, 'Report.pdf')).click();
    await settle();
    assert.equal(log.mock.callCount(), 1);
    assert.equal(Notice.messages.at(-1), en.fileGraphUpdateFailed);
    assert.equal(removeButton(rowFor(modal, 'Report.pdf')).disabled, false);
});

test('resolved events refresh relations and a deleted current note displays an error', t => {
    const f = setup(t);
    const modal = f.open();
    f.connections.incoming.length = 0;
    f.app.metadataCache.emit('resolved');
    assert.equal(findAll(modal.contentEl, 'setting-item-heading').map(name)[0], en.graphIncomingLinks + ' (0)');
    assert.ok(findAll(modal.contentEl, 'setting-item-description').some(el => el.text === en.graphNoConnections));
    f.files.delete(f.current.path);
    f.app.metadataCache.emit('resolved');
    assert.equal(modal.contentEl.children[0].text, en.fileGraphNoteNotFound);
    assert.equal(rows(modal).length, 0);
});

test('closing a search permits reopening, and closing its parent removes all subscriptions', t => {
    const f = setup(t);
    const modal = f.open();
    const first = suggest(f, modal, 'incoming');
    addButton(modal, 'outgoing').click();
    assert.equal(f.app.openModals.size, 2);
    first.close();
    const second = suggest(f, modal, 'outgoing');
    assert.notEqual(first, second);
    modal.close();
    assert.equal(second.isOpen, false);
    assert.equal(f.app.openModals.size, 0);
    assert.equal(f.app.metadataCache.count('resolved'), 0);
    f.app.metadataCache.emit('resolved');
    assert.equal(modal.contentEl.children.length, 0);
});

test('menu cleanup closes all remaining parent and child modals and unregisters the menu', t => {
    const f = setup(t);
    const closed = f.open();
    closed.close();
    const first = f.open();
    const child = suggest(f, first, 'incoming');
    const second = f.open(f.portal);
    assert.equal(f.app.metadataCache.count('resolved'), 2);
    f.cleanup();
    assert.equal(first.isOpen, false);
    assert.equal(second.isOpen, false);
    assert.equal(child.isOpen, false);
    assert.equal(f.app.openModals.size, 0);
    assert.equal(f.app.metadataCache.count('resolved'), 0);
    assert.equal(f.app.workspace.count('file-menu'), 0);
    assert.equal(f.menuFor(f.current).items.length, 0);
});

test('normal close invokes the ownership callback exactly once', t => {
    const f = setup(t);
    let closed = 0;
    const modal = new FileGraphRelationModal(f.app, f.current, f.service, () => { closed++; });
    modal.open();
    modal.close();
    modal.close();
    assert.equal(closed, 1);
    assert.equal(f.app.metadataCache.count('resolved'), 0);
});
