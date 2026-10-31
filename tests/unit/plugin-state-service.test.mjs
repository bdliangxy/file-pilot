import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestJiti } from '../helpers/test-jiti.mjs';
import { makeFileRecord } from '../factories/file-record.mjs';
import { makePluginData } from '../factories/plugin-data.mjs';
import { createFakeDataAdapter } from '../fakes/index.mjs';
import { createPluginStateServiceTestContext } from '../helpers/plugin-state-service.mjs';

const jiti = createTestJiti(import.meta.url);
const { PluginStateService } = await jiti.import('../../src/data/plugin-state-service.ts');
const { DEFAULT_IGNORE_PATTERNS } = await jiti.import('../../src/data/setting-data.ts');
const { FilePilotError } = await jiti.import('../../src/error.ts');

test('loads existing state without writing it again', async () => {
	const storedData = makePluginData({ rootPath: 'C:\\existing', fileRecords: [makeFileRecord()] });
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService, storedData);

	assert.equal(await service.load(), undefined);
	assert.deepEqual(service.getFileScope(), storedData.settingData.fileScope);
	assert.equal(service.getRootPath(), storedData.settingData.fileScope.rootPath);
	assert.equal(service.getFileRecordCount(), 1);
	assert.equal(savedData.length, 0);
});

test('saves and initializes defaults when stored data is missing', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService, null);

	await service.load();

	const expected = makePluginData({ ignorePatterns: [...DEFAULT_IGNORE_PATTERNS] });
	expected.pluginData.version = 1;

	assert.deepEqual(savedData, [expected]);
	assert.deepEqual(service.getFileScope(), expected.settingData.fileScope);
	assert.equal(service.getFileRecordCount(), 0);
});

test('isolates state from source objects and returned file scopes', async () => {
	const storedData = makePluginData({ rootPath: 'C:\\existing' });
	const { service } = createPluginStateServiceTestContext(PluginStateService, storedData);

	await service.load();

	storedData.settingData.fileScope.rootPath = 'changed outside';
	const returnedScope = service.getFileScope();
	returnedScope.rootPath = 'changed via getter';
	returnedScope.ignorePatterns.push('*.tmp');

	assert.equal(service.getRootPath(), 'C:\\existing');
	assert.deepEqual(service.getFileScope().ignorePatterns, []);
});

test('getFileRecords returns an isolated snapshot without saving', async () => {
	const originalRecords = [
		makeFileRecord('file-1', { path: 'docs/report.pdf' }),
		makeFileRecord('file-2', { path: 'images/photo.png' }),
	];
	const { service, savedData } = createPluginStateServiceTestContext(
		PluginStateService,
		makePluginData({ fileRecords: originalRecords }),
	);
	await service.load();

	const returnedRecords = service.getFileRecords();
	assert.deepEqual(returnedRecords, originalRecords);

	returnedRecords[0].path = 'changed/by/ui.pdf';
	returnedRecords.push(makeFileRecord('file-3', { path: 'extra.txt' }));

	assert.deepEqual(service.getFileRecords(), originalRecords);
	assert.equal(service.getFileRecordCount(), 2);
	assert.equal(savedData.length, 0);
});

test('adds records and persists the updated state', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService,);

	await service.load();

	const record = makeFileRecord();
	await service.addFileRecords([record]);

	assert.equal(service.getFileRecordCount(), 1);
	assert.deepEqual(savedData[0].pluginData.fileRecords, [record]);
	assert.equal(savedData[0].pluginData.version, 2);

	record.path = 'changed after saving';
	assert.equal(savedData[0].pluginData.fileRecords[0].path, 'docs/report.pdf');
});

test('rejects an already managed path without changing stored records', async () => {
	const existingRecord = makeFileRecord('file-1', { path: 'docs/report.pdf' });
	const { service, savedData } = createPluginStateServiceTestContext(
		PluginStateService,
		makePluginData({ fileRecords: [existingRecord] }),
	);
	await service.load();

	const duplicatePathRecord = makeFileRecord('file-2', {
		path: 'docs/report.pdf',
	});

	await assert.rejects(
		service.addFileRecords([duplicatePathRecord]),
		/Duplicate FileRecord path/,
	);

	assert.deepEqual(service.getFileRecords(), [existingRecord]);
	assert.equal(savedData.length, 0);
});

test('adding an empty batch does not persist anything', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService,);
	await service.load();

	await service.addFileRecords([]);

	assert.equal(service.getFileRecordCount(), 0);
	assert.equal(savedData.length, 0);
});

test('failed record persistence leaves in-memory state unchanged', async () => {
	const service = new PluginStateService({
		loadData: async () => makePluginData(),
		saveData: async () => {
			throw new Error('Disk failure');
		},
	});
	await service.load();

	await assert.rejects(service.addFileRecords([makeFileRecord()]), /Disk failure/);
	assert.equal(service.getFileRecordCount(), 0);
});

test('updates and persists a validated, trimmed root path', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'file-pilot-state-'));
	t.after(async () => rm(directory, { recursive: true, force: true }));

	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
	await service.load();

	const result = await service.updateSettings({ rootPath: '  ' + directory + '  ' });

	assert.deepEqual(result, { updated: ['rootPath'], errors: {} });
	assert.equal(service.getRootPath(), directory);
	assert.equal(savedData.length, 1);
	assert.equal(savedData[0].settingData.fileScope.rootPath, directory);
});

test('reports invalid root paths without saving or throwing', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'file-pilot-state-'));
	t.after(async () => rm(directory, { recursive: true, force: true }));

	const regularFile = join(directory, 'not-a-directory.txt');
	await writeFile(regularFile, 'test');

	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
	await service.load();

	for (const [path, code] of [
		['relative/folder', 'SCAN_ROOT_INVALID'],
		[join(directory, 'missing'), 'SCAN_ROOT_NOT_FOUND'],
		[regularFile, 'SCAN_ROOT_NOT_FOUND'],
	]) {
		const result = await service.updateSettings({ rootPath: path });
		assert.deepEqual(result.updated, []);
		assert.ok(result.errors.rootPath instanceof FilePilotError);
		assert.equal(result.errors.rootPath.code, code);
	}

	assert.equal(service.getRootPath(), '');
	assert.equal(savedData.length, 0);
});

test('reports a locked root and preserves existing records', async () => {
	const storedData = makePluginData({
		rootPath: 'C:\\existing',
		fileRecords: [makeFileRecord()],
	});
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService, storedData);
	await service.load();

	const result = await service.updateSettings({ rootPath: 'C:\\different' });

	assert.deepEqual(result.updated, []);
	assert.equal(result.errors.rootPath?.code, 'SCAN_ROOT_LOCKED');
	assert.equal(service.getRootPath(), 'C:\\existing');
	assert.equal(service.getFileRecordCount(), 1);
	assert.equal(savedData.length, 0);
});

test('unchanged root path does not trigger validation or persistence', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(
		PluginStateService,
		makePluginData({ rootPath: 'C:\\existing', fileRecords: [makeFileRecord()] }),
	);
	await service.load();

	const result = await service.updateSettings({ rootPath: 'C:\\existing' });

	assert.deepEqual(result, { updated: [], errors: {} });
	assert.equal(savedData.length, 0);
});

test('allows clearing a configured scan root', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(
		PluginStateService,
		makePluginData({ rootPath: 'C:\\existing' }),
	);
	await service.load();

	const result = await service.updateSettings({ rootPath: '   ' });

	assert.deepEqual(result, { updated: ['rootPath'], errors: {} });
	assert.equal(service.getRootPath(), '');
	assert.equal(savedData.length, 1);
	assert.equal(savedData[0].settingData.fileScope.rootPath, '');
});

test('failed root persistence leaves the previous path unchanged', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'file-pilot-state-'));
	t.after(async () => rm(directory, { recursive: true, force: true }));

	const service = new PluginStateService({
		loadData: async () => makePluginData(),
		saveData: async () => {
			throw new Error('Disk failure');
		},
	});
	await service.load();

	await assert.rejects(service.updateSettings({ rootPath: directory }), /Disk failure/);
	assert.equal(service.getRootPath(), '');
});

test('requires load before accessing or updating state', async () => {
	const { service } = createPluginStateServiceTestContext(PluginStateService);
	const isDataLost = (error) =>
		error instanceof FilePilotError && error.code === 'DATA_LOST';

	assert.throws(() => service.getRootPath(), isDataLost);
	assert.throws(() => service.getIgnorePatterns(), isDataLost);
	assert.throws(() => service.getFileRecordCount(), isDataLost);
	await assert.rejects(service.addFileRecords([makeFileRecord()]), isDataLost);
	await assert.rejects(service.updateSettings({ ignorePatterns: ['*.tmp'] }), isDataLost);
});

test('getIgnorePatterns returns an isolated copy', async () => {
	const storedData = makePluginData({ ignorePatterns: ['*.tmp'] });
	const { service } = createPluginStateServiceTestContext(PluginStateService, storedData);
	await service.load();

	const returned = service.getIgnorePatterns();
	returned.push('ignored/');
	storedData.settingData.fileScope.ignorePatterns.push('external/');

	assert.deepEqual(service.getIgnorePatterns(), ['*.tmp']);
});

test('updates ignore patterns without modifying unrelated state', async () => {
	const record = makeFileRecord();
	const initial = makePluginData({ rootPath: 'C:\\existing', fileRecords: [record] });
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService, initial);
	await service.load();

	const result = await service.updateSettings({ ignorePatterns: ['*.tmp', 'private/'] });

	assert.deepEqual(result, { updated: ['ignorePatterns'], errors: {} });
	assert.deepEqual(service.getIgnorePatterns(), ['*.tmp', 'private/']);
	assert.equal(savedData.length, 1);
	assert.equal(savedData[0].settingData.fileScope.rootPath, initial.settingData.fileScope.rootPath);
	assert.deepEqual(savedData[0].pluginData.fileRecords, [record]);
	assert.deepEqual(savedData[0].settingData.fileScope.ignorePatterns, ['*.tmp', 'private/']);
});

test('ignores blank rules but preserves pattern order and meaningful whitespace', async () => {
	const { service } = createPluginStateServiceTestContext(PluginStateService);
	await service.load();

	const result = await service.updateSettings({
		ignorePatterns: ['', '*.pdf', '   ', '!important.pdf', 'name\\ ', '# comment'],
	});

	assert.deepEqual(result, { updated: ['ignorePatterns'], errors: {} });
	assert.deepEqual(service.getIgnorePatterns(), [
		'*.pdf', '!important.pdf', 'name\\ ', '# comment',
	]);
});

test('unchanged and normalized-equivalent ignore rules do not save again', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
	await service.load();

	const first = await service.updateSettings({ ignorePatterns: [] });
	const second = await service.updateSettings({ ignorePatterns: ['*.tmp', '', 'private/'] });
	const third = await service.updateSettings({ ignorePatterns: ['*.tmp', '   ', 'private/'] });

	assert.deepEqual(first.updated, []);
	assert.deepEqual(second.updated, ['ignorePatterns']);
	assert.deepEqual(third.updated, []);
	assert.equal(savedData.length, 1);
});

test('supports clearing existing ignore rules', async () => {
	const initial = makePluginData({ ignorePatterns: ['*.tmp'] });
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService, initial);
	await service.load();

	const result = await service.updateSettings({ ignorePatterns: [] });

	assert.deepEqual(result, { updated: ['ignorePatterns'], errors: {} });
	assert.deepEqual(service.getIgnorePatterns(), []);
	assert.equal(savedData.length, 1);
	assert.deepEqual(savedData[0].settingData.fileScope.ignorePatterns, []);
});

test('failed ignore persistence leaves in-memory state unchanged', async () => {
	const initial = makePluginData({ ignorePatterns: ['original/'] });
	const service = new PluginStateService({
		loadData: async () => structuredClone(initial),
		saveData: async () => { throw new Error('Disk failure'); },
	});
	await service.load();

	await assert.rejects(
		service.updateSettings({ ignorePatterns: ['new/'] }),
		/Disk failure/,
	);
	assert.deepEqual(service.getIgnorePatterns(), ['original/']);
});

test('reloads saved ignore rules from a persistent adapter', async () => {
	const adapter = createFakeDataAdapter(makePluginData());
	const firstService = new PluginStateService(adapter);
	await firstService.load();
	const result = await firstService.updateSettings({ ignorePatterns: ['*.tmp', 'private/'] });

	const secondService = new PluginStateService(adapter);
	await secondService.load();

	assert.deepEqual(result.updated, ['ignorePatterns']);
	assert.deepEqual(secondService.getIgnorePatterns(), ['*.tmp', 'private/']);
	assert.equal(adapter.savedData.length, 1);
});

test('valid root and ignore changes are committed in a single write', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'file-pilot-state-'));
	t.after(async () => rm(directory, { recursive: true, force: true }));
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
	await service.load();

	const result = await service.updateSettings({
		rootPath: directory,
		ignorePatterns: ['*.tmp', 'build/'],
	});

	assert.deepEqual(result, {
		updated: ['rootPath', 'ignorePatterns'],
		errors: {},
	});
	assert.equal(savedData.length, 1);
	assert.equal(service.getRootPath(), directory);
	assert.deepEqual(service.getIgnorePatterns(), ['*.tmp', 'build/']);
	assert.equal(savedData[0].settingData.fileScope.rootPath, directory);
	assert.deepEqual(savedData[0].settingData.fileScope.ignorePatterns, ['*.tmp', 'build/']);
});

test('an invalid root does not prevent valid ignore rules from being saved', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
	await service.load();

	const result = await service.updateSettings({
		rootPath: 'relative/invalid',
		ignorePatterns: ['*.log'],
	});

	assert.deepEqual(result.updated, ['ignorePatterns']);
	assert.equal(result.errors.rootPath?.code, 'SCAN_ROOT_INVALID');
	assert.equal(service.getRootPath(), '');
	assert.deepEqual(service.getIgnorePatterns(), ['*.log']);
	assert.equal(savedData.length, 1);
	assert.equal(savedData[0].settingData.fileScope.rootPath, '');
});

test('invalid root with unchanged ignore rules makes no write', async () => {
	const initial = makePluginData({ ignorePatterns: ['*.tmp'] });
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService, initial);
	await service.load();

	const result = await service.updateSettings({
		rootPath: 'relative/invalid',
		ignorePatterns: ['*.tmp'],
	});

	assert.deepEqual(result.updated, []);
	assert.equal(result.errors.rootPath?.code, 'SCAN_ROOT_INVALID');
	assert.deepEqual(service.getIgnorePatterns(), ['*.tmp']);
	assert.equal(savedData.length, 0);
});

test('omitted settings are not modified or persisted', async () => {
	const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
	await service.load();

	const result = await service.updateSettings({});

	assert.deepEqual(result, { updated: [], errors: {} });
	assert.equal(savedData.length, 0);
});

test('failed visibility setting persistence preserves the previous value', async () => {
    const service = new PluginStateService({
        loadData: async () => makePluginData(),
        saveData: async () => { throw new Error('Disk failure'); },
    });
    await service.load();

    await assert.rejects(
        service.updateSettings({ hideShadowNotesFlag: false }),
        /Disk failure/,
    );
    assert.equal(service.getHideShadowNotesFlag(), true);
});


test('project name is trimmed, persisted and survives reloading', async () => {
    const adapter = createFakeDataAdapter(makePluginData());
    const first = new PluginStateService(adapter);
    await first.load();
    assert.equal(first.getProjectName(), '');

    assert.deepEqual(await first.updateSettings({ projectName: '  Work Files  ' }), {
        updated: ['projectName'], errors: {},
    });
    assert.equal(first.getProjectName(), 'Work Files');
    assert.equal(adapter.savedData.length, 1);

    const next = new PluginStateService(adapter);
    await next.load();
    assert.equal(next.getProjectName(), 'Work Files');
    assert.equal(adapter.savedData.length, 1);
});

test('project name accepts 30 Unicode characters but rejects longer or control-character names', async () => {
    const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
    await service.load();
    const valid = '文'.repeat(30);
    assert.deepEqual((await service.updateSettings({ projectName: valid })).updated, ['projectName']);
    assert.equal(service.getProjectName(), valid);

    for (const invalid of ['文'.repeat(31), 'bad\nname', 'bad\u007fname']) {
        const result = await service.updateSettings({ projectName: invalid });
        assert.deepEqual(result.updated, []);
        assert.ok(result.errors.projectName instanceof Error);
        assert.equal(service.getProjectName(), valid);
    }
    assert.equal(savedData.length, 1);
});

test('unchanged project name does not persist, and clearing it restores the default value', async () => {
    const { service, savedData } = createPluginStateServiceTestContext(
        PluginStateService, makePluginData({ projectName: 'Work' }),
    );
    await service.load();
    assert.deepEqual((await service.updateSettings({ projectName: ' Work ' })).updated, []);
    assert.equal(savedData.length, 0);
    assert.deepEqual((await service.updateSettings({ projectName: '  ' })).updated, ['projectName']);
    assert.equal(service.getProjectName(), '');
    assert.equal(savedData.length, 1);
});

test('invalid project name does not block other valid settings', async () => {
    const { service, savedData } = createPluginStateServiceTestContext(PluginStateService);
    await service.load();
    const result = await service.updateSettings({
        projectName: 'x'.repeat(31), ignorePatterns: ['*.log'],
    });
    assert.deepEqual(result.updated, ['ignorePatterns']);
    assert.ok(result.errors.projectName instanceof Error);
    assert.equal(service.getProjectName(), '');
    assert.deepEqual(service.getIgnorePatterns(), ['*.log']);
    assert.equal(savedData.length, 1);
});

test('failed project-name persistence preserves the previous value', async () => {
    const service = new PluginStateService({
        loadData: async () => makePluginData({ projectName: 'Old' }),
        saveData: async () => { throw new Error('Disk failure'); },
    });
    await service.load();
    await assert.rejects(service.updateSettings({ projectName: 'New' }), /Disk failure/);
    assert.equal(service.getProjectName(), 'Old');
});
