import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { makeFileRecord, makeScannedFolder } from '../factories/file-record.mjs';
import { Notice, TFile, TFolder } from '../fakes/obsidian-plugin.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(
            new URL('../fakes/obsidian-plugin.mjs', import.meta.url),
        ),
    },
});
const { registerFileGraphMenu } = await jiti.import(
    '../../src/ui/obsidian-ui.ts',
);

function makeMenu() {
    const items = [];

    return {
        items,
        addItem(configure) {
            const item = {
                title: '',
                icon: '',
                submenu: null,
                handler: null,
                setTitle(value) { this.title = value; return this; },
                setIcon(value) { this.icon = value; return this; },
                setSubmenu() {
                    this.submenu = makeMenu();
                    return this.submenu;
                },
                onClick(handler) { this.handler = handler; return this; },
            };
            configure(item);
            items.push(item);
        },
    };
}

function makeFixture(records = []) {
    const listeners = new Set();
    const workspace = {
        on(event, callback) {
            assert.equal(event, 'file-menu');
            listeners.add(callback);
            return { off: () => listeners.delete(callback) };
        },
    };
    const stateService = {
        getFileRecords: () => records,
    };
    const calls = [];
    const fileActionService = {
        async execute(action, record) {
            calls.push({ action, record });
        },
    };
    const eventRef = registerFileGraphMenu(
        workspace,
        stateService,
        fileActionService,
    );

    return {
        calls,
        fileActionService,
        eventRef,
        showMenu(file) {
            const menu = makeMenu();
            for (const callback of listeners) {
                callback(menu, file, 'graph');
            }
            return menu;
        },
    };
}

function makeFolderRecord() {
    return {
        ...makeScannedFolder('Docs'),
        id: 'Folder000001',
        status: 'available',
        shadowNotePath: 'ShadowNotes/docs.md',
    };
}

test('managed Shadow Note gets a File Pilot submenu with two native file actions', async () => {
    const record = makeFileRecord('File00000001');
    const fixture = makeFixture([record]);
    const menu = fixture.showMenu(new TFile(record.shadowNotePath));

    assert.equal(menu.items.length, 1);
    assert.equal(menu.items[0].title, 'File Pilot');
    assert.equal(menu.items[0].icon, 'folder-cog');
    assert.deepEqual(
        menu.items[0].submenu.items.map(item => [item.title, item.icon]),
        [
            ['Open source file', 'file'],
            ['Open containing folder', 'folder-open'],
        ],
    );

    for (const item of menu.items[0].submenu.items) {
        item.handler();
    }
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(fixture.calls, [
        { action: 'openSource', record },
        { action: 'openContainingFolder', record },
    ]);
});

test('unmanaged notes, Portal Notes, and folders do not get File Pilot actions', () => {
    const record = makeFileRecord('File00000001');
    const fixture = makeFixture([record]);

    for (const file of [
        new TFile('Notes/unmanaged.md'),
        new TFile('PORTAL NOTE.md'),
        new TFile('ShadowNotes/copied-file-id.md'),
        new TFolder('ShadowNotes'),
    ]) {
        const menu = fixture.showMenu(file);
        assert.equal(menu.items.length, 0, file.path);
    }
    assert.deepEqual(fixture.calls, []);
});

test('managed folder Shadow Notes expose the same two actions', async () => {
    const record = makeFolderRecord();
    const fixture = makeFixture([record]);
    const menu = fixture.showMenu(new TFile(record.shadowNotePath));

    assert.equal(menu.items.length, 1);
    const items = menu.items[0].submenu.items;
    assert.equal(items.length, 2);

    items[0].handler();
    items[1].handler();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(fixture.calls.map(call => call.action), [
        'openSource',
        'openContainingFolder',
    ]);
    assert.ok(fixture.calls.every(call => call.record === record));
});

test('menu resolves current records at invocation and event subscription can be removed', () => {
    const record = makeFileRecord('File00000001');
    const records = [record];
    const fixture = makeFixture(records);

    assert.equal(fixture.showMenu(new TFile(record.shadowNotePath)).items.length, 1);
    records.length = 0;
    assert.equal(fixture.showMenu(new TFile(record.shadowNotePath)).items.length, 0);

    records.push(record);
    fixture.eventRef.off();
    assert.equal(fixture.showMenu(new TFile(record.shadowNotePath)).items.length, 0);
});

test('failed native action reports the existing localized file error notice', async t => {
    const record = makeFileRecord('File00000001');
    const fixture = makeFixture([record]);
    fixture.fileActionService.execute = async () => {
        throw new Error('native opener rejected');
    };
    const log = t.mock.method(console, 'error', () => {});
    Notice.messages.length = 0;

    const menu = fixture.showMenu(new TFile(record.shadowNotePath));
    menu.items[0].submenu.items[0].handler();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(Notice.messages, ['File operation failed']);
    Notice.messages.length = 0;
});
