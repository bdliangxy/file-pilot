import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const { pickPaths, pickSavePath } = await jiti.import('../../src/ui/native-file-dialog.ts');

function installDialog(t, dialog) {
    const previousWindow = globalThis.window;
    globalThis.window = {
        require(id) {
            assert.equal(id, '@electron/remote');
            return { dialog };
        },
    };
    t.after(() => {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    });
}

test('file picker defaults to one file and always shows hidden files', async (t) => {
    let received;
    installDialog(t, {
        async showOpenDialog(options) {
            received = options;
            return { canceled: false, filePaths: ['C:/example.txt'] };
        },
    });

    assert.deepEqual(await pickPaths(), ['C:/example.txt']);
    assert.deepEqual(received.properties, ['openFile', 'showHiddenFiles']);
});

test('directory picker preserves options and does not duplicate showHiddenFiles', async (t) => {
    let received;
    installDialog(t, {
        async showOpenDialog(options) {
            received = options;
            return { canceled: false, filePaths: ['C:/root'] };
        },
    });

    const result = await pickPaths({
        title: 'Choose directory',
        defaultPath: 'C:/',
        properties: ['openDirectory', 'showHiddenFiles'],
    });

    assert.deepEqual(result, ['C:/root']);
    assert.equal(received.title, 'Choose directory');
    assert.equal(received.defaultPath, 'C:/');
    assert.deepEqual(received.properties, ['openDirectory', 'showHiddenFiles']);
});

test('canceled open dialogs return an empty list', async (t) => {
    installDialog(t, {
        async showOpenDialog() {
            return { canceled: true, filePaths: ['ignored'] };
        },
    });

    assert.deepEqual(await pickPaths({ properties: ['openDirectory'] }), []);
});

test('save picker returns the selected path and forwards options', async (t) => {
    let received;
    installDialog(t, {
        async showSaveDialog(options) {
            received = options;
            return { canceled: false, filePath: 'C:/rules.txt' };
        },
    });

    const result = await pickSavePath({
        title: 'Export rules',
        defaultPath: 'rules.txt',
        filters: [{ name: 'Text', extensions: ['txt'] }],
    });

    assert.equal(result, 'C:/rules.txt');
    assert.equal(received.title, 'Export rules');
    assert.equal(received.defaultPath, 'rules.txt');
    assert.deepEqual(received.filters, [{ name: 'Text', extensions: ['txt'] }]);
});

test('canceled save dialogs return undefined', async (t) => {
    installDialog(t, {
        async showSaveDialog() {
            return { canceled: true, filePath: 'ignored' };
        },
    });

    assert.equal(await pickSavePath(), undefined);
});

test('missing Electron loader produces a meaningful error', async (t) => {
    const previousWindow = globalThis.window;
    globalThis.window = {};
    t.after(() => {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    });

    await assert.rejects(pickPaths(), /Electron module loader unavailable/);
});
