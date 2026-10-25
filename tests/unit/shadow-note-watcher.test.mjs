import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { TFile, TFolder } from '../fakes/obsidian-watcher.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-watcher.mjs', import.meta.url)),
    },
});
const { ShadowNoteWatcher } = await jiti.import('../../src/core/shadow-note-watcher.ts');

function makeEmitter() {
    const listeners = new Map();
    return {
        on(event, callback) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(callback);
            return { off: () => listeners.get(event).delete(callback) };
        },
        emit(event, file) {
            for (const callback of [...(listeners.get(event) ?? [])]) callback(file);
        },
        count(event) {
            return listeners.get(event)?.size ?? 0;
        },
    };
}

function setup(records = []) {
    const vault = makeEmitter();
    const metadataCache = makeEmitter();
    let stored = [...records];
    const removed = [];
    let refreshed = 0;
    const stateService = {
        getFileRecords: () => [...stored],
        async removeFileRecord(id) {
            removed.push(id);
            stored = stored.filter(record => record.id !== id);
        },
    };
    const watcher = new ShadowNoteWatcher(
        vault,
        metadataCache,
        stateService,
        () => { refreshed++; },
    );
    watcher.onload();
    return {
        watcher, vault, metadataCache, removed,
        get records() { return stored; },
        get refreshed() { return refreshed; },
    };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

test('registers one changed listener on load, before any deletion', () => {
    const ctx = setup();
    assert.equal(ctx.metadataCache.count('changed'), 1);
    assert.equal(ctx.vault.count('delete'), 1);
    ctx.watcher.unload();
});

test('notifies multiple subscribers and supports independent unsubscription', () => {
    const ctx = setup();
    const first = [];
    const second = [];
    const unsubscribeFirst = ctx.watcher.onNoteChanged(path => first.push(path));
    const unsubscribeSecond = ctx.watcher.onNoteChanged(path => second.push(path));

    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    assert.deepEqual(first, ['ShadowNotes/a.md']);
    assert.deepEqual(second, ['ShadowNotes/a.md']);

    unsubscribeFirst();
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/b.md'));
    assert.deepEqual(first, ['ShadowNotes/a.md']);
    assert.deepEqual(second, ['ShadowNotes/a.md', 'ShadowNotes/b.md']);

    unsubscribeSecond();
    ctx.watcher.unload();
});

test('a failing subscriber does not prevent other subscribers from receiving changes', () => {
    const ctx = setup();
    const received = [];
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        ctx.watcher.onNoteChanged(() => { throw new Error('subscriber failed'); });
        ctx.watcher.onNoteChanged(path => received.push(path));
        ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
        assert.deepEqual(received, ['ShadowNotes/a.md']);
        assert.equal(errors.length, 1);
    } finally {
        console.error = originalError;
        ctx.watcher.unload();
    }
});

test('unload removes both native event listeners', () => {
    const ctx = setup();
    const received = [];
    ctx.watcher.onNoteChanged(path => received.push(path));
    ctx.watcher.unload();

    assert.equal(ctx.metadataCache.count('changed'), 0);
    assert.equal(ctx.vault.count('delete'), 0);
    ctx.metadataCache.emit('changed', new TFile('ShadowNotes/a.md'));
    assert.deepEqual(received, []);
});

test('deletes only matching managed records and refreshes the view', async () => {
    const ctx = setup([
        { id: 'one', shadowNotePath: 'ShadowNotes/a.md' },
        { id: 'two', shadowNotePath: 'ShadowNotes/b.md' },
    ]);
    ctx.vault.emit('delete', new TFile('Unrelated/note.md'));
    ctx.vault.emit('delete', new TFolder('ShadowNotes'));
    ctx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
    await flush();

    assert.deepEqual(ctx.removed, ['one']);
    assert.deepEqual(ctx.records, [{ id: 'two', shadowNotePath: 'ShadowNotes/b.md' }]);
    assert.equal(ctx.refreshed, 1);
    ctx.watcher.unload();
});

test('sequential deletions preserve every unrelated record', async () => {
    const ctx = setup([
        { id: 'one', shadowNotePath: 'ShadowNotes/a.md' },
        { id: 'two', shadowNotePath: 'ShadowNotes/b.md' },
        { id: 'three', shadowNotePath: 'ShadowNotes/c.md' },
    ]);
    ctx.vault.emit('delete', new TFile('ShadowNotes/a.md'));
    ctx.vault.emit('delete', new TFile('ShadowNotes/b.md'));
    await flush();

    assert.deepEqual(ctx.removed, ['one', 'two']);
    assert.deepEqual(ctx.records, [{ id: 'three', shadowNotePath: 'ShadowNotes/c.md' }]);
    assert.equal(ctx.refreshed, 2);
    ctx.watcher.unload();
});
