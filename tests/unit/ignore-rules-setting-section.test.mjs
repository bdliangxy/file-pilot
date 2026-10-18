import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import {
    Setting, Notice, DropdownComponent, ButtonComponent, findComponents, findButton,
} from '../fakes/obsidian-settings.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-settings.mjs', import.meta.url)),
    },
});
const { IgnoreRulesSettingSection } = await jiti.import(
    '../../src/ui/ignore-rules-setting-section.ts',
);

function setup(patterns = [], rootPath = '') {
    const state = {
        rootPath,
        patterns: [...patterns],
        getRootPath() { return this.rootPath; },
        getIgnorePatterns() { return [...this.patterns]; },
    };
    const section = new IgnoreRulesSettingSection(state);
    const setting = new Setting();
    section.render(setting);
    const dropdown = findComponents(setting.settingEl, DropdownComponent)[0];
    const textarea = setting.textAreas[0];
    const categoryList = setting.controlEl.querySelector('.file-pilot-ignore-category-list');
    Notice.messages.length = 0;
    return { section, setting, state, dropdown, textarea, categoryList };
}

function pillLabels(container) {
    return container.children
        .filter((child) => child.classes.has('file-pilot-ignore-pill'))
        .map((pill) => pill.children.find((child) =>
            child.classes.has('file-pilot-ignore-pill-label'))?.text)
        .filter(Boolean);
}

function installDialog(t, dialog) {
    const previousWindow = globalThis.window;
    globalThis.window = {
        require(id) {
            assert.equal(id, '@electron/remote');
            return { dialog };
        },
    };
    t.after(() => {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    });
}

test('initializes the Ignore draft and textarea from persisted rules', () => {
    const { section, state, textarea } = setup(['*.pdf', 'build/']);
    assert.deepEqual(section.getDraft(), ['*.pdf', 'build/']);
    assert.equal(textarea.getValue(), '*.pdf\nbuild/');

    const returned = section.getDraft();
    returned.push('not persisted');
    assert.deepEqual(section.getDraft(), ['*.pdf', 'build/']);
    assert.deepEqual(state.patterns, ['*.pdf', 'build/']);
});

test('editing and clearing the draft do not persist changes', () => {
    const { section, setting, state, textarea } = setup(['*.pdf']);
    textarea.edit('*.docx\n!keep.docx\n');
    assert.deepEqual(section.getDraft(), ['*.docx', '!keep.docx', '']);
    assert.deepEqual(state.patterns, ['*.pdf']);

    findButton(setting, 'Clear').click();
    assert.deepEqual(section.getDraft(), []);
    assert.equal(textarea.getValue(), '');
    assert.deepEqual(state.patterns, ['*.pdf']);
});

test('restores default ignore rules into the unsaved draft', async () => {
    const { DEFAULT_IGNORE_PATTERNS } = await jiti.import('../../src/data/setting-data.ts');
    const { section, setting, state, textarea } = setup(['custom/']);
    findButton(setting, 'Restore defaults').click();

    assert.deepEqual(section.getDraft(), DEFAULT_IGNORE_PATTERNS);
    assert.equal(textarea.getValue(), DEFAULT_IGNORE_PATTERNS.join('\n'));
    assert.deepEqual(state.patterns, ['custom/']);
});

test('filters categories and removes the correct rule from the full draft', () => {
    const { section, dropdown, textarea, categoryList } =
        setup(['*.pdf', 'build/', 'docs/report.txt', '*.tar.gz']);

    dropdown.change('directories');
    assert.deepEqual(pillLabels(categoryList), ['build/']);
    assert.equal(textarea.inputEl.classes.has('file-pilot-ignore-hidden'), true);
    assert.equal(categoryList.classes.has('file-pilot-ignore-hidden'), false);

    const remove = findComponents(categoryList, ButtonComponent)
        .find((button) => button.icon === 'x');
    assert.ok(remove);
    remove.click();

    assert.deepEqual(section.getDraft(), ['*.pdf', 'docs/report.txt', '*.tar.gz']);
    assert.equal(textarea.getValue(), '*.pdf\ndocs/report.txt\n*.tar.gz');
    dropdown.change('extensions');
    assert.deepEqual(pillLabels(categoryList), ['*.pdf', '*.tar.gz']);
    dropdown.change('filenames');
    assert.deepEqual(pillLabels(categoryList), ['docs/report.txt']);
    dropdown.change('all');
    assert.equal(textarea.inputEl.classes.has('file-pilot-ignore-hidden'), false);
});

test('invalid and duplicate extension submissions clear the input without editing the draft', () => {
    const { section, dropdown, categoryList } = setup(['*.PDF']);
    dropdown.change('extensions');
    const input = categoryList.querySelector('.file-pilot-ignore-extension-input');
    assert.ok(input);

    input.value = 'tar..gz';
    assert.equal(input.dispatchKey('Enter').prevented, true);
    assert.equal(input.value, '');
    assert.deepEqual(section.getDraft(), ['*.PDF']);

    input.value = 'pdf';
    input.dispatchKey('Enter');
    assert.equal(input.value, '');
    assert.deepEqual(section.getDraft(), ['*.PDF']);
    assert.equal(Notice.messages.length, 2);
});

test('extension editor ignores composition and adds valid compound extensions', () => {
    const { section, dropdown, textarea, categoryList } = setup();
    dropdown.change('extensions');
    const input = categoryList.querySelector('.file-pilot-ignore-extension-input');

    input.value = 'tar.gz';
    assert.equal(input.dispatchKey('Enter', true).prevented, false);
    assert.equal(input.value, 'tar.gz');
    assert.deepEqual(section.getDraft(), []);

    assert.equal(input.dispatchKey('Enter').prevented, true);
    assert.deepEqual(section.getDraft(), ['*.tar.gz']);
    assert.equal(textarea.getValue(), '*.tar.gz');
    assert.deepEqual(pillLabels(categoryList), ['*.tar.gz']);

    const replacement = categoryList.querySelector('.file-pilot-ignore-extension-input');
    assert.ok(replacement);
    assert.notEqual(replacement, input);
    assert.equal(replacement.value, '');
    assert.equal(replacement.focused, true);
});

test('syncSavedRules replaces the draft with persisted rules', () => {
    const { section, state, textarea } = setup(['*.pdf']);
    textarea.edit('*.tmp\nbuild/');
    state.patterns = ['*.log'];

    section.syncSavedRules();

    assert.deepEqual(section.getDraft(), ['*.log']);
    assert.equal(textarea.getValue(), '*.log');
});

test('cannot select ignored paths without a persisted scan root', async () => {
    const { section, setting, dropdown } = setup();
    dropdown.change('directories');

    const add = findComponents(setting.settingEl, ButtonComponent)
        .find((button) => button.icon === 'plus');
    await add.click();

    assert.deepEqual(section.getDraft(), []);
    assert.equal(Notice.messages.length, 1);
});

test('selects root-relative directories, deduplicates, and rejects paths outside root', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'file-pilot-section-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'file-pilot-outside-'));
    t.after(() => Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
    ]));
    const folders = [path.join(root, 'docs'), path.join(root, 'cache')];
    await Promise.all(folders.map((folder) => mkdir(folder)));
    const selectedBatches = [folders, folders, [path.join(outside)]];
    installDialog(t, {
        async showOpenDialog(options) {
            assert.ok(options.properties.includes('openDirectory'));
            assert.ok(options.properties.includes('multiSelections'));
            assert.equal(options.defaultPath, root);
            return { canceled: false, filePaths: selectedBatches.shift() };
        },
    });

    const { section, setting, dropdown, textarea } = setup([], root);
    dropdown.change('directories');
    const add = findComponents(setting.settingEl, ButtonComponent)
        .find((button) => button.icon === 'plus');

    await add.click();
    assert.deepEqual(section.getDraft(), ['/docs/', '/cache/']);
    await add.click();
    assert.deepEqual(section.getDraft(), ['/docs/', '/cache/']);
    await add.click();
    assert.deepEqual(section.getDraft(), ['/docs/', '/cache/']);
    assert.equal(textarea.getValue(), '/docs/\n/cache/');
    assert.equal(Notice.messages.length, 1);
});

test('selects an ignored file without persisting it', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'file-pilot-section-files-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const file = path.join(root, 'report[final].pdf');
    await writeFile(file, 'hello');
    installDialog(t, {
        async showOpenDialog(options) {
            assert.ok(options.properties.includes('openFile'));
            return { canceled: false, filePaths: [file] };
        },
    });

    const { section, state, setting, dropdown } = setup([], root);
    dropdown.change('filenames');
    const add = findComponents(setting.settingEl, ButtonComponent)
        .find((button) => button.icon === 'plus');
    await add.click();

    assert.deepEqual(section.getDraft(), ['/report\\[final\\].pdf']);
    assert.deepEqual(state.patterns, []);
});

test('imports new draft and exports it without saving settings', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'file-pilot-section-io-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'in.txt');
    const destination = path.join(root, 'out.txt');
    await writeFile(source, '*.tmp\n!keep.tmp\n');
    installDialog(t, {
        async showOpenDialog() { return { canceled: false, filePaths: [source] }; },
        async showSaveDialog() { return { canceled: false, filePath: destination }; },
    });

    const { section, state, setting, textarea } = setup(['*.pdf']);
    await findButton(setting, 'Import').click();
    assert.deepEqual(section.getDraft(), ['*.tmp', '!keep.tmp', '']);
    assert.equal(textarea.getValue(), '*.tmp\n!keep.tmp\n');
    assert.deepEqual(state.patterns, ['*.pdf']);

    await findButton(setting, 'Export').click();
    assert.equal(await readFile(destination, 'utf8'), '*.tmp\n!keep.tmp\n');
});
