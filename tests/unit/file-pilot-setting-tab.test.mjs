import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import {
    Setting, Notice, findButton, setLanguage,
} from '../fakes/obsidian-settings.mjs';
import { makePluginData } from '../factories/plugin-data.mjs';
import { makeFileRecord } from '../factories/file-record.mjs';
import { createPluginStateServiceTestContext } from '../helpers/plugin-state-service.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(new URL('../fakes/obsidian-settings.mjs', import.meta.url)),
    },
});
const { FilePilotSettingTab } = await jiti.import(
    '../../src/ui/file-pilot-setting-tab.ts',
);
const { PluginStateService } = await jiti.import(
    '../../src/data/plugin-state-service.ts',
);

async function setup(data = makePluginData()) {
    setLanguage('en');
    const { service, savedData } = createPluginStateServiceTestContext(PluginStateService, data);
    await service.load();

    let refreshes = 0;
    let projectNameRefreshes = 0;
    let listRefreshes = 0;
    let visibilityRefreshes = 0;
    const plugin = {
        stateService: service,
        refreshViewRootPath() { refreshes++; },
        refreshViewProjectName() { projectNameRefreshes++; },
        refreshViewFileList() { listRefreshes++; },
        applyShadowNotesVisibility() { visibilityRefreshes++; },
    };
    const tab = new FilePilotSettingTab({}, plugin);
    const definitions = tab.getSettingDefinitions();
    const settings = definitions.map((definition) => {
        const setting = new Setting();
        definition.render(setting);
        return setting;
    });
    tab.containerEl = {
        querySelectorAll: () => settings
            .filter(({ settingEl }) => settingEl.classes.has('file-pilot-requires-root'))
            .map(({ settingEl }) => settingEl),
    };
    Notice.messages.length = 0;
    return {
        service,
        savedData,
        tab,
        settings,
        rootInput: settings[0].texts[0],
        projectNameInput: settings[1].texts[0],
        ignoreInput: settings[2].textAreas[0],
        hideToggle: settings[3].toggles[0],
        browse: findButton(settings[0], 'Browse'),
        save: findButton(settings[4], 'Save settings'),
        get refreshes() { return refreshes; },
        get projectNameRefreshes() { return projectNameRefreshes; },
        get listRefreshes() { return listRefreshes; },
        get visibilityRefreshes() { return visibilityRefreshes; },
    };
}

async function waitFor(check) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (check()) return;
        await delay(10);
    }
    assert.fail('Timed out waiting for an asynchronous settings update');
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

test('Enter saves a valid root without saving the unsaved Ignore draft', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'file-pilot-tab-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const ui = await setup();
    ui.ignoreInput.edit('*.tmp');

    ui.rootInput.setValue('  ' + directory + '  ');
    assert.equal(ui.rootInput.inputEl.dispatchKey('Enter', true).prevented, false);
    assert.equal(ui.service.getRootPath(), '');

    assert.equal(ui.rootInput.inputEl.dispatchKey('Enter').prevented, true);
    await waitFor(() => ui.service.getRootPath() === directory);
    assert.equal(ui.rootInput.getValue(), directory);
    assert.deepEqual(ui.service.getIgnorePatterns(), []);
    assert.equal(ui.refreshes, 1);
    assert.equal(ui.listRefreshes, 0);
    assert.equal(ui.savedData.length, 1);
});

test('Enter rejects a locked root and restores the stored path', async () => {
    const existing = path.resolve('saved-root');
    const ui = await setup(makePluginData({
        rootPath: existing,
        fileRecords: [makeFileRecord()],
    }));
    ui.rootInput.setValue(path.resolve('different-root'));
    ui.rootInput.inputEl.dispatchKey('Enter');

    await waitFor(() => Notice.messages.length > 0);
    assert.equal(ui.service.getRootPath(), existing);
    assert.equal(ui.rootInput.getValue(), existing);
    assert.equal(ui.refreshes, 0);
    assert.equal(ui.savedData.length, 0);
    assert.match(Notice.messages[0], /Cannot change/);
});

test('Browse selection saves the root and cancellation changes nothing', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'file-pilot-browse-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let canceled = false;
    installDialog(t, {
        async showOpenDialog(options) {
            assert.deepEqual(options.properties, ['openDirectory', 'showHiddenFiles']);
            return canceled
                ? { canceled: true, filePaths: [] }
                : { canceled: false, filePaths: [directory] };
        },
    });

    const ui = await setup();
    await ui.browse.click();
    assert.equal(ui.rootInput.getValue(), directory);
    assert.equal(ui.service.getRootPath(), directory);
    assert.equal(ui.refreshes, 1);

    canceled = true;
    await ui.browse.click();
    assert.equal(ui.rootInput.getValue(), directory);
    assert.equal(ui.savedData.length, 1);
});

test('Browse restores the previous root when changing it is locked', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'file-pilot-browse-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    installDialog(t, {
        async showOpenDialog() {
            return { canceled: false, filePaths: [directory] };
        },
    });
    const initial = path.resolve('saved-root');
    const ui = await setup(makePluginData({
        rootPath: initial,
        fileRecords: [makeFileRecord()],
    }));

    await ui.browse.click();
    assert.equal(ui.service.getRootPath(), initial);
    assert.equal(ui.rootInput.getValue(), initial);
    assert.equal(ui.savedData.length, 0);
    assert.equal(ui.refreshes, 0);
});

test('Save settings commits the Ignore draft but restores a locked root', async () => {
    const initial = path.resolve('saved-root');
    const ui = await setup(makePluginData({
        rootPath: initial,
        ignorePatterns: ['*.pdf'],
        fileRecords: [makeFileRecord()],
    }));
    ui.rootInput.setValue(path.resolve('new-root'));
    ui.ignoreInput.edit('*.pdf\n*.log');

    await ui.save.click();

    assert.equal(ui.rootInput.getValue(), initial);
    assert.equal(ui.service.getRootPath(), initial);
    assert.deepEqual(ui.service.getIgnorePatterns(), ['*.pdf', '*.log']);
    assert.equal(ui.tab.getSettingDefinitions().length, 5);
    assert.equal(ui.ignoreInput.getValue(), '*.pdf\n*.log');
    assert.equal(ui.savedData.length, 1);
    assert.equal(ui.refreshes, 0);
    assert.equal(ui.listRefreshes, 1);
    assert.match(Notice.messages[0], /Some settings were saved/);
});

test('Save settings restores an invalid root while preserving unchanged Ignore rules', async () => {
    const ui = await setup(makePluginData({ ignorePatterns: ['*.pdf'] }));
    ui.rootInput.setValue('relative/not-allowed');

    await ui.save.click();

    assert.equal(ui.rootInput.getValue(), '');
    assert.equal(ui.service.getRootPath(), '');
    assert.deepEqual(ui.service.getIgnorePatterns(), ['*.pdf']);
    assert.equal(ui.savedData.length, 0);
    assert.match(Notice.messages[0], /Failed to save settings/);
});

test('failed persistence also restores the root and reports an error', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'file-pilot-failed-save-'));
    t.after(() => rm(directory, { recursive: true, force: true }));

    const service = new PluginStateService({
        loadData: async () => makePluginData(),
        saveData: async () => { throw new Error('Disk failure'); },
    });
    await service.load();
    const tab = new FilePilotSettingTab({}, {
        stateService: service,
        refreshViewRootPath() { assert.fail('Should not refresh on failure'); },
    });
    const setting = new Setting();
    tab.getSettingDefinitions()[0].render(setting);
    const rootInput = setting.texts[0];
    rootInput.setValue(directory);
    Notice.messages.length = 0;

    rootInput.inputEl.dispatchKey('Enter');
    await waitFor(() => Notice.messages.length > 0);

    assert.equal(rootInput.getValue(), '');
    assert.equal(service.getRootPath(), '');
    assert.match(Notice.messages[0], /Failed to save settings/);
});

test('an in-flight save does not replace edits typed after submission', async () => {
    let finishSave;
    const stateService = {
        getRootPath() { return 'saved'; },
        getProjectName() { return ''; },
        getIgnorePatterns() { return []; },
        getHideShadowNotesFlag() { return true; },
        updateSettings() {
            return new Promise((resolve) => {
                finishSave = () => resolve({ updated: [], errors: {} });
            });
        },
    };
    const tab = new FilePilotSettingTab({}, {
        stateService,
        refreshViewRootPath() { },
    });
    const root = new Setting();
    tab.getSettingDefinitions()[0].render(root);
    const input = root.texts[0];

    input.setValue('submitted');
    input.inputEl.dispatchKey('Enter');
    input.setValue('still editing');
    finishSave();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(input.getValue(), 'still editing');
});


test('saving changed ignore rules triggers one file-list refresh, not a root refresh', async () => {
    const ui = await setup(makePluginData({ ignorePatterns: ['*.tmp'] }));
    ui.ignoreInput.edit('*.pdf');
    await ui.save.click();
    assert.deepEqual(ui.service.getIgnorePatterns(), ['*.pdf']);
    assert.equal(ui.listRefreshes, 1);
    assert.equal(ui.refreshes, 0);

    await ui.save.click();
    assert.equal(ui.listRefreshes, 1);
    assert.equal(ui.savedData.length, 1);

    ui.ignoreInput.edit('');
    await ui.save.click();
    assert.deepEqual(ui.service.getIgnorePatterns(), []);
    assert.equal(ui.listRefreshes, 2);
});

test('invalid root with unchanged ignore rules does not refresh either view field', async () => {
    const ui = await setup(makePluginData({ ignorePatterns: ['*.pdf'] }));
    ui.rootInput.setValue('relative/invalid');
    await ui.save.click();
    assert.equal(ui.refreshes, 0);
    assert.equal(ui.listRefreshes, 0);
    assert.equal(ui.savedData.length, 0);
});

test('ShadowNotes toggle edits a draft and only saves when Save settings is clicked', async () => {
    const ui = await setup();
    assert.equal(ui.hideToggle.getValue(), true);

    ui.hideToggle.change(false);
    assert.equal(ui.hideToggle.getValue(), false);
    assert.equal(ui.service.getHideShadowNotesFlag(), true);
    assert.equal(ui.savedData.length, 0);
    assert.equal(ui.visibilityRefreshes, 0);

    await ui.save.click();
    assert.equal(ui.service.getHideShadowNotesFlag(), false);
    assert.equal(ui.savedData.length, 1);
    assert.equal(ui.savedData[0].settingData.hideShadowNotesFlag, false);
    assert.equal(ui.visibilityRefreshes, 1);
    assert.equal(ui.refreshes, 0);
    assert.equal(ui.listRefreshes, 0);

    await ui.save.click();
    assert.equal(ui.savedData.length, 1);
    assert.equal(ui.visibilityRefreshes, 1);

    ui.hideToggle.change(true);
    assert.equal(ui.service.getHideShadowNotesFlag(), false);
    assert.equal(ui.visibilityRefreshes, 1);
    await ui.save.click();
    assert.equal(ui.service.getHideShadowNotesFlag(), true);
    assert.equal(ui.visibilityRefreshes, 2);
    assert.equal(ui.savedData.length, 2);
});

test('ShadowNotes draft is not persisted or applied when saving fails', async () => {
    const service = new PluginStateService({
        loadData: async () => makePluginData(),
        saveData: async () => { throw new Error('Disk failure'); },
    });
    await service.load();
    let visibilityRefreshes = 0;
    const tab = new FilePilotSettingTab({}, {
        stateService: service,
        applyShadowNotesVisibility() { visibilityRefreshes++; },
    });
    const definitions = tab.getSettingDefinitions();
    const toggleSetting = new Setting();
    definitions[3].render(toggleSetting);
    const toggle = toggleSetting.toggles[0];
    const saveSetting = new Setting();
    definitions[4].render(saveSetting);
    const save = findButton(saveSetting, 'Save settings');
    const previousLog = console.error;
    console.error = () => {};
    try {
        toggle.change(false);
        assert.equal(service.getHideShadowNotesFlag(), true);
        await save.click();
        assert.equal(service.getHideShadowNotesFlag(), true);
        assert.equal(visibilityRefreshes, 0);
    } finally {
        console.error = previousLog;
    }
});


test('project-name draft is saved and only its overview title is refreshed', async () => {
    const ui = await setup();
    assert.equal(ui.projectNameInput.getValue(), '');
    ui.projectNameInput.edit('  My Project  ');
    assert.equal(ui.service.getProjectName(), '');
    assert.equal(ui.savedData.length, 0);

    await ui.save.click();
    assert.equal(ui.service.getProjectName(), 'My Project');
    assert.equal(ui.savedData.length, 1);
    assert.equal(ui.projectNameRefreshes, 1);
    assert.equal(ui.refreshes, 0);
    assert.equal(ui.listRefreshes, 0);

    await ui.save.click();
    assert.equal(ui.savedData.length, 1);
    assert.equal(ui.projectNameRefreshes, 1);

    ui.projectNameInput.edit(' ');
    await ui.save.click();
    assert.equal(ui.service.getProjectName(), '');
    assert.equal(ui.projectNameRefreshes, 2);
});

test('invalid project name shows localized validation feedback without refreshing the view', async () => {
    const ui = await setup();
    ui.projectNameInput.edit('x'.repeat(31));
    await ui.save.click();
    assert.equal(ui.service.getProjectName(), '');
    assert.equal(ui.projectNameRefreshes, 0);
    assert.equal(ui.savedData.length, 0);
    assert.match(Notice.messages.at(-1), /at most 30 characters/);
});
