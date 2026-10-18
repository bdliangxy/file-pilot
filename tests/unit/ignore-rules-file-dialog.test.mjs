import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const { importIgnoreRules, exportIgnoreRules } =
    await jiti.import('../../src/ui/ignore-rules-file-dialog.ts');

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

test('imports a UTF-8 ignore file and normalizes BOM and line endings', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'file-pilot-ignore-import-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const source = join(dir, 'rules.txt');
    await writeFile(source, '\uFEFF# comment\r\n*.tmp\rprivate/\n', 'utf8');

    let received;
    installDialog(t, {
        async showOpenDialog(options) {
            received = options;
            return { canceled: false, filePaths: [source] };
        },
    });

    assert.equal(await importIgnoreRules(), '# comment\n*.tmp\nprivate/\n');
    assert.deepEqual(received.properties, ['openFile', 'showHiddenFiles']);
    assert.deepEqual(received.filters[0].extensions, ['txt', 'gitignore']);
});

test('canceling import does not try to read a file', async (t) => {
    installDialog(t, {
        async showOpenDialog() {
            return { canceled: true, filePaths: [] };
        },
    });
    assert.equal(await importIgnoreRules(), undefined);
});

test('exports the provided draft without changing its contents', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'file-pilot-ignore-export-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const destination = join(dir, 'rules.txt');
    let received;

    installDialog(t, {
        async showSaveDialog(options) {
            received = options;
            return { canceled: false, filePath: destination };
        },
    });

    const draft = '# Example\n*.pdf\n!important.pdf\n';
    assert.equal(await exportIgnoreRules(draft), true);
    assert.equal(await readFile(destination, 'utf8'), draft);
    assert.equal(received.defaultPath, 'file-pilot-ignore.txt');
    assert.deepEqual(received.filters[0].extensions, ['txt']);
});

test('canceling export reports false', async (t) => {
    installDialog(t, {
        async showSaveDialog() {
            return { canceled: true };
        },
    });

    assert.equal(await exportIgnoreRules('*.tmp'), false);
});
