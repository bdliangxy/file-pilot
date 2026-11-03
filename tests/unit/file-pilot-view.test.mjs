import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { FakeElement, Notice } from '../fakes/obsidian-view.mjs';
import { makeFileRecord, makeScannedFolder } from '../factories/file-record.mjs';

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
    let ignorePatterns = [];
    let records = [record];
    let projectName = '';
    const listeners = new Set();
    let subscribed = 0;
    let unsubscribed = 0;
    let reads = 0;
    const app = {};
    const plugin = {
        shadowNoteWatcher: {
            onNoteChanged(callback) {
                subscribed++;
                listeners.add(callback);
                return () => {
                    if (listeners.delete(callback)) {
                        unsubscribed++;
                    }
                };
            },
        },
        stateService: {
            getRootPath: () => 'C:/files',
            getProjectName: () => projectName,
            getFileRecords: () => records,
            getIgnorePatterns: () => [...ignorePatterns],
        },
        shadowNoteService: {
            getFileSummary: (received) => {
                reads++;
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
        emit: (path) => {
            for (const callback of listeners) {
                callback(path);
            }
        },
        setIgnorePatterns: (patterns) => { ignorePatterns = [...patterns]; },
        setRecords: (nextRecords) => { records = nextRecords; },
        setProjectName: (name) => { projectName = name; },
        getOverviewTitle: () => view.rootSetting?.name,
        get reads() { return reads; },
        get subscribed() { return subscribed; },
        get unsubscribed() { return unsubscribed; },
        get activeSubscriptions() { return listeners.size; },
    };
}

async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
}

// Locate native-like controls in the fake DOM without relying on Setting internals.
function findTag(element, tag) {
    if (!element) return null;
    if (element.tag === tag) return element;
    for (const child of element.children) {
        const match = findTag(child, tag);
        if (match) return match;
    }
    return null;
}

function searchInput(ui) {
    const input = findTag(ui.find('file-pilot-search-section'), 'input');
    assert.ok(input, 'Search input should exist');
    return input;
}

function statusSelect(ui) {
    const select = findTag(ui.find('file-pilot-filter-section'), 'select');
    assert.ok(select, 'Status selector should exist');
    return select;
}

function changeSearch(ui, value) {
    const input = searchInput(ui);
    input.value = value;
    input.dispatch('input');
}

function changeStatus(ui, value) {
    const select = statusSelect(ui);
    assert.ok(select.options.has(value), `Unknown status option: ${value}`);
    select.value = value;
    select.dispatch('change');
}

function visibleNames(ui) {
    return ui.find('file-pilot-files-section').children
        .filter(item => item.classes.has('file-pilot-file-item'))
        .map(item => item.children[0].children[0].text);
}

function makeQueryRecords() {
    return [
        makeFileRecord('available-report', {
            path: 'Docs/report.pdf',
            shadowNotePath: 'ShadowNotes/Docs_report.md',
        }),
        makeFileRecord('missing-report', {
            path: 'Archive/report.pdf',
            status: 'missing',
            shadowNotePath: 'ShadowNotes/Archive_report.md',
        }),
        makeFileRecord('ignored-report', {
            path: 'Private/report.pdf',
            shadowNotePath: 'ShadowNotes/Private_report.md',
        }),
        makeFileRecord('missing-private', {
            path: 'Private/missing-report.pdf',
            status: 'missing',
            shadowNotePath: 'ShadowNotes/Private_missing-report.md',
        }),
        makeFileRecord('notes', {
            path: 'Docs/notes.txt',
            shadowNotePath: 'ShadowNotes/Docs_notes.md',
        }),
    ];
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

test('closes and reopens without accumulating watcher subscriptions', async () => {
    const ui = setup();
    await ui.view.onOpen();
    assert.equal(ui.subscribed, 1);
    assert.equal(ui.activeSubscriptions, 1);
    await ui.view.onClose();
    assert.equal(ui.unsubscribed, 1);
    assert.equal(ui.activeSubscriptions, 0);
    const before = ui.reads;
    ui.emit(ui.record.shadowNotePath);
    await flush();
    assert.equal(ui.reads, before);
    await ui.view.onOpen();
    assert.equal(ui.subscribed, 2);
    assert.equal(ui.activeSubscriptions, 1);
    await ui.view.onClose();
    assert.equal(ui.unsubscribed, 2);
    assert.equal(ui.activeSubscriptions, 0);
});


test('opening the view immediately shows ignored status from saved rules', async () => {
    const ui = setup();
    ui.setIgnorePatterns(['/docs/report.pdf']);
    await ui.view.onOpen();
    const status = ui.find('file-pilot-file-status');
    assert.equal(status.text, 'Ignored');
    assert.ok(status.classes.has('file-pilot-status-ignored'));
    assert.equal(ui.record.status, 'available');
    await ui.view.onClose();
});

test('refreshing the view switches ignored status back without changing FileRecord', async () => {
    const ui = setup();
    await ui.view.onOpen();
    const initial = ui.find('file-pilot-file-status');
    assert.equal(initial.text, 'Normal');

    ui.setIgnorePatterns(['*.pdf']);
    ui.view.refreshFileList();
    const ignored = ui.find('file-pilot-file-status');
    assert.equal(ignored.text, 'Ignored');
    assert.ok(ignored.classes.has('file-pilot-status-ignored'));

    ui.setIgnorePatterns([]);
    ui.view.refreshFileList();
    const restored = ui.find('file-pilot-file-status');
    assert.equal(restored.text, 'Normal');
    assert.ok(restored.classes.has('file-pilot-status-available'));
    assert.equal(ui.record.status, 'available');
    await ui.view.onClose();
});

test('refresh keeps missing status above ignored when ignore rules change', async () => {
    const ui = setup();
    ui.record.status = 'missing';
    ui.setIgnorePatterns(['/docs/']);
    await ui.view.onOpen();
    const initialStatus = ui.find('file-pilot-file-status');
    assert.equal(initialStatus.text, 'Missing');
    assert.ok(initialStatus.classes.has('file-pilot-status-missing'));

    ui.setIgnorePatterns([]);
    ui.view.refreshFileList();
    const status = ui.find('file-pilot-file-status');
    assert.equal(status.text, 'Missing');
    assert.ok(status.classes.has('file-pilot-status-missing'));
    assert.equal(ui.record.status, 'missing');
    await ui.view.onClose();
});

test('overview uses the configured project name and refreshes without rebuilding the list', async () => {
    const ui = setup();
    ui.setProjectName('Client Documents');
    await ui.view.onOpen();
    assert.equal(ui.getOverviewTitle(), 'Client Documents');
    const secondary = ui.find('file-pilot-file-secondary');
    ui.setProjectName('Archive');
    ui.view.refreshProjectName();
    assert.equal(ui.getOverviewTitle(), 'Archive');
    assert.equal(ui.find('file-pilot-file-secondary'), secondary);

    ui.setProjectName('');
    ui.view.refreshProjectName();
    assert.equal(ui.getOverviewTitle(), 'project directory');
    await ui.view.onClose();
});

test('overview counts files and folders separately and renders folder labels and sizes', async () => {
    const ui = setup();
    const folder = {
        ...makeScannedFolder('Projects/Empty.v2'),
        id: 'folder-1',
        status: 'available',
        shadowNotePath: 'ShadowNotes/Empty.v2.md',
    };
    ui.setRecords([ui.record, folder]);
    await ui.view.onOpen();
    await flush();

    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 1 files, 1 folders');
    const folderName = ui.find('file-pilot-folder-name');
    assert.ok(folderName);
    assert.equal(folderName.text, 'Empty.v2');

    const items = ui.find('file-pilot-files-section').children;
    assert.equal(items.length, 2);
    assert.equal(items[1].children[1].children[0].text, '—');
    assert.equal(items[0].children[1].children[0].text, '123 B');
    await ui.view.onClose();
});

test('overview updates counts after refresh and keeps totals independent of search filters', async () => {
    const ui = setup();
    const folder = {
        ...makeScannedFolder('Projects/Empty'),
        id: 'folder-1',
        status: 'available',
        shadowNotePath: 'ShadowNotes/Empty.md',
    };
    ui.setRecords([folder]);
    await ui.view.onOpen();

    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 0 files, 1 folders');
    changeSearch(ui, 'missing-name');
    assert.deepEqual(visibleNames(ui), []);
    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 0 files, 1 folders');

    ui.setRecords([folder, ui.record]);
    ui.view.refreshFileList();
    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 1 files, 1 folders');
    ui.setRecords([]);
    ui.view.refreshFileList();
    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 0 files, 0 folders');
    await ui.view.onClose();
});

test('folder summary and ignored status update without mutating its record', async () => {
    const ui = setup(async (record) =>
        record.kind === 'folder' ? 'Folder summary' : null);
    const folder = {
        ...makeScannedFolder('Projects/Empty.v2'),
        id: 'folder-1',
        status: 'available',
        shadowNotePath: 'ShadowNotes/Empty.v2.md',
    };
    ui.setRecords([folder]);
    ui.setIgnorePatterns(['/Projects/']);
    await ui.view.onOpen();
    await flush();

    assert.equal(ui.find('file-pilot-file-status').text, 'Ignored');
    assert.equal(ui.find('file-pilot-file-secondary').text, 'Folder summary');
    assert.equal(folder.status, 'available');
    ui.setIgnorePatterns([]);
    ui.view.refreshFileList();
    assert.equal(ui.find('file-pilot-file-status').text, 'Normal');
    await ui.view.onClose();
});

test('scan notice reports file and folder imports and no new entries', async () => {
    const ui = setup();
    let result = {
        importedCount: 3,
        importedFileCount: 1,
        importedFolderCount: 2,
    };
    ui.view.filePilot.syncFiles = async () => result;
    await ui.view.onOpen();
    const scanButton = ui.view.rootSetting.controlEl.children[0];
    Notice.messages.length = 0;

    scanButton.click();
    await flush();
    assert.equal(Notice.messages.at(-1), 'Imported 1 files and 2 folders');

    result = { importedCount: 1, importedFileCount: 0, importedFolderCount: 1 };
    scanButton.click();
    await flush();
    assert.equal(Notice.messages.at(-1), 'Imported 0 files and 1 folders');

    result = { importedCount: 0, importedFileCount: 0, importedFolderCount: 0 };
    scanButton.click();
    await flush();
    assert.equal(Notice.messages.at(-1), 'No new files or folders imported');
    assert.equal(Notice.messages.length, 3);
    await ui.view.onClose();
});

test('settings shortcut remains beside the title after a name refresh', async () => {
    const ui = setup();
    await ui.view.onOpen();
    const button = ui.find('file-pilot-overview-settings-button');
    const row = ui.find('file-pilot-overview-title-row');
    assert.ok(button.classes.has('clickable-icon'));
    assert.equal(button.icon, 'settings');
    assert.equal(button.attributes['aria-label'], 'Open file pilot settings');
    assert.equal(button.parent, row);
    ui.setProjectName('Renamed');
    ui.view.refreshProjectName();
    assert.equal(ui.find('file-pilot-overview-settings-button'), button);
    assert.equal(row.children[1].text, 'Renamed');
    await ui.view.onClose();
});

test('search and status controls apply their intersection and restore all records', async () => {
    const ui = setup();
    const records = makeQueryRecords();
    const before = structuredClone(records);
    ui.setRecords(records);
    ui.setIgnorePatterns(['/Private/']);
    await ui.view.onOpen();

    assert.equal(searchInput(ui).value, '');
    assert.equal(statusSelect(ui).value, 'all');
    assert.deepEqual([...statusSelect(ui).options.keys()], ['all', 'available', 'missing', 'ignored']);
    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 5 files, 0 folders');
    assert.equal(visibleNames(ui).length, 5);

    changeSearch(ui, 'REPORT');
    assert.deepEqual(visibleNames(ui), ['report.pdf', 'report.pdf', 'report.pdf', 'missing-report.pdf']);
    changeStatus(ui, 'missing');
    assert.deepEqual(visibleNames(ui), ['report.pdf', 'missing-report.pdf']);
    changeStatus(ui, 'ignored');
    assert.deepEqual(visibleNames(ui), ['report.pdf']);
    changeSearch(ui, 'notes');
    assert.deepEqual(visibleNames(ui), []);
    assert.equal(ui.find('file-pilot-file-empty').text, 'No matching files or folders');

    changeSearch(ui, '');
    assert.deepEqual(visibleNames(ui), ['report.pdf']);
    changeStatus(ui, 'all');
    assert.equal(visibleNames(ui).length, 5);
    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 5 files, 0 folders');
    assert.deepEqual(records, before);
    await ui.view.onClose();
});

test('search and filter preserve each other on refresh and respond to ignore changes', async () => {
    const ui = setup();
    ui.setRecords(makeQueryRecords());
    ui.setIgnorePatterns(['/Private/']);
    await ui.view.onOpen();

    changeSearch(ui, 'Private');
    changeStatus(ui, 'ignored');
    assert.deepEqual(visibleNames(ui), ['report.pdf']);
    ui.setIgnorePatterns([]);
    ui.view.refreshFileList();
    assert.deepEqual(visibleNames(ui), []);
    assert.equal(searchInput(ui).value, 'Private');
    assert.equal(statusSelect(ui).value, 'ignored');

    ui.setIgnorePatterns(['/Private/']);
    ui.view.refreshFileList();
    assert.deepEqual(visibleNames(ui), ['report.pdf']);
    ui.setRecords([...makeQueryRecords(), makeFileRecord('new', {
        path: 'Private/new.pdf',
        shadowNotePath: 'ShadowNotes/new.md',
    })]);
    ui.view.refreshFileList();
    assert.deepEqual(visibleNames(ui), ['report.pdf', 'new.pdf']);
    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 6 files, 0 folders');
    await ui.view.onClose();
});

test('query changes reset scroll but background list refresh preserves it', async () => {
    const ui = setup();
    ui.setRecords(makeQueryRecords());
    await ui.view.onOpen();
    const list = ui.find('file-pilot-files-section');
    list.scrollTop = 125;
    changeSearch(ui, 'report');
    assert.equal(list.scrollTop, 0);
    list.scrollTop = 76;
    ui.view.refreshFileList();
    assert.equal(list.scrollTop, 76);
    changeStatus(ui, 'missing');
    assert.equal(list.scrollTop, 0);
    await ui.view.onClose();
});

test('empty database and unmatched query use different empty messages', async () => {
    const ui = setup();
    ui.setRecords([]);
    await ui.view.onOpen();
    assert.equal(ui.find('file-pilot-file-empty').text, 'No managed files or folders yet in project directory');
    changeSearch(ui, 'nonexistent');
    assert.equal(ui.find('file-pilot-file-empty').text, 'No managed files or folders yet in project directory');
    ui.setRecords(makeQueryRecords());
    ui.view.refreshFileList();
    assert.equal(ui.find('file-pilot-file-empty').text, 'No matching files or folders');
    await ui.view.onClose();
});

test('reopening the view restores search and status controls from criteria', async () => {
    const ui = setup();
    ui.setRecords(makeQueryRecords());
    await ui.view.onOpen();
    changeSearch(ui, 'Archive');
    changeStatus(ui, 'missing');
    assert.deepEqual(visibleNames(ui), ['report.pdf']);
    await ui.view.onClose();
    await ui.view.onOpen();
    assert.equal(searchInput(ui).value, 'Archive');
    assert.equal(statusSelect(ui).value, 'missing');
    assert.deepEqual(visibleNames(ui), ['report.pdf']);
    await ui.view.onClose();
});

test('search matches managed folders and does not change their metadata', async () => {
    const ui = setup();
    const folder = {
        ...makeScannedFolder('Projects/合同资料'),
        id: 'folder-cn',
        status: 'available',
        shadowNotePath: 'ShadowNotes/folder-cn.md',
    };
    ui.setRecords([folder, ...makeQueryRecords()]);
    await ui.view.onOpen();
    changeSearch(ui, '合同');
    assert.deepEqual(visibleNames(ui), ['合同资料']);
    assert.equal(ui.find('file-pilot-managed-count').text, 'Managed: 5 files, 1 folders');
    changeStatus(ui, 'missing');
    assert.deepEqual(visibleNames(ui), []);
    await ui.view.onClose();
});
