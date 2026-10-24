import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { FakeElement } from '../fakes/obsidian-view.mjs';
import { makeFileRecord } from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-view.mjs', import.meta.url)),
    },
});
const { FilePilotView } = await jiti.import('../../src/ui/file-pilot-view.ts');

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

function setup(summaryReader = async () => null) {
    const record = makeFileRecord('file-1', {
        shadowNotePath: 'ShadowNotes/report.md',
    });
    const callbacks = new Map();
    let subscribed = 0;
    let unsubscribed = 0;
    let reads = 0;
    const app = {
        metadataCache: {
            on(name, callback) {
                assert.equal(name, 'changed');
                subscribed++;
                callbacks.set(name, callback);
                return { name };
            },
            offref(ref) {
                callbacks.delete(ref.name);
                unsubscribed++;
            },
        },
    };
    const plugin = {
        stateService: {
            getRootPath: () => 'C:/files',
            getFileRecords: () => [record],
        },
        shadowNoteService: {
            getFileSummary: (received) => {
                reads++;
                assert.equal(received.id, record.id);
                return summaryReader(received);
            },
        },
    };
    const view = new FilePilotView({
        app,
        contentEl: new FakeElement(),
    }, plugin);
    const find = (cls) => {
        function search(el) {
            if (el.classes.has(cls)) return el;
            for (const child of el.children) {
                const result = search(child);
                if (result) return result;
            }
            return null;
        }
        return search(view.contentEl);
    };
    return {
        view, record, find,
        emit: (path) => callbacks.get('changed')?.({ path }),
        get reads() { return reads; },
        get subscribed() { return subscribed; },
        get unsubscribed() { return unsubscribed; },
    };
}

async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('renders the summary and refreshes only for the matching Shadow Note', async () => {
    let summary = 'Initial summary';
    const ui = setup(async () => summary);
    await ui.view.onOpen();
    await flush();
    const secondary = ui.find('file-pilot-file-secondary');
    assert.equal(secondary.text, 'Initial summary');
    assert.ok(secondary.classes.has('file-pilot-file-summary'));

    summary = 'Updated summary';
    ui.emit('Unrelated/note.md');
    await flush();
    assert.equal(ui.reads, 1);
    ui.emit(ui.record.shadowNotePath);
    await flush();
    assert.equal(secondary.text, 'Updated summary');
    assert.equal(ui.reads, 2);
    await ui.view.onClose();
});

test('removing a summary restores the absolute path and its CSS class', async () => {
    let summary = 'Present';
    const ui = setup(async () => summary);
    await ui.view.onOpen();
    await flush();
    const secondary = ui.find('file-pilot-file-secondary');
    summary = null;
    ui.emit(ui.record.shadowNotePath);
    await flush();
    assert.equal(secondary.text.replaceAll('\\', '/'), 'C:/files/docs/report.pdf');
    assert.ok(secondary.classes.has('file-pilot-file-path'));
    assert.ok(!secondary.classes.has('file-pilot-file-summary'));
    await ui.view.onClose();
});

test('outdated summary reads cannot overwrite a newer result', async () => {
    const pending = deferred();
    let count = 0;
    const ui = setup(() => ++count === 1 ? pending.promise : Promise.resolve('Newest'));
    await ui.view.onOpen();
    ui.emit(ui.record.shadowNotePath);
    await flush();
    assert.equal(ui.find('file-pilot-file-secondary').text, 'Newest');
    pending.resolve('Stale');
    await flush();
    assert.equal(ui.find('file-pilot-file-secondary').text, 'Newest');
    await ui.view.onClose();
});

test('closes and reopens without accumulating metadata listeners', async () => {
    const ui = setup();
    await ui.view.onOpen();
    assert.equal(ui.subscribed, 1);
    await ui.view.onClose();
    assert.equal(ui.unsubscribed, 1);
    const before = ui.reads;
    ui.emit(ui.record.shadowNotePath);
    await flush();
    assert.equal(ui.reads, before);
    await ui.view.onOpen();
    assert.equal(ui.subscribed, 2);
    await ui.view.onClose();
    assert.equal(ui.unsubscribed, 2);
});
