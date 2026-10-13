import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
	PluginStateService,
	ScanRootLockedError,
	ScanRootInvalidError,
	ScanRootNotFoundError,
} = await jiti.import('../../src/data/plugin-state-service.ts');

function makeRecord(id = 'file-1') {
	return {
		id,
		path: 'docs/report.pdf',
		nativeIdentity: '1:2',
		baseName: 'report',
		extension: 'pdf',
		size: 123,
		mtimeMs: 456,
		status: 'available',
		shadowNotePath: 'ShadowNotes/report.md',
	};
}

function makeData(rootPath = '', fileRecords = []) {
	return {
		settingData: {
			fileScope: {
				rootPath,
				ignorePatterns: [],
				watchEnabled: true,
			},
		},
		pluginData: {
			version: 2,
			fileRecords,
		},
	};
}

function createService(storedData = makeData()) {
	const savedData = [];
	const service = new PluginStateService({
		loadData: async () => storedData,
		saveData: async (data) => {
			savedData.push(structuredClone(data));
		},
	});

	return { service, savedData };
}

test('loads existing state without writing it again', async () => {
	const storedData = makeData('C:\\existing', [makeRecord()]);
	const { service, savedData } = createService(storedData);

	assert.equal(await service.load(), undefined);
	assert.deepEqual(service.getFileScope(), storedData.settingData.fileScope);
	assert.equal(service.getRootPath(), storedData.settingData.fileScope.rootPath);
	assert.equal(service.getFileRecordCount(), 1);
	assert.equal(savedData.length, 0);
});

test('saves and initializes defaults when stored data is missing', async () => {
	const { service, savedData } = createService(null);

	await service.load();

	const expected = makeData();
	expected.pluginData.version = 1;

	assert.deepEqual(savedData, [expected]);
	assert.deepEqual(service.getFileScope(), expected.settingData.fileScope);
	assert.equal(service.getFileRecordCount(), 0);
});

test('isolates state from source objects and returned file scopes', async () => {
	const storedData = makeData('C:\\existing');
	const { service } = createService(storedData);

	await service.load();

	storedData.settingData.fileScope.rootPath = 'changed outside';
	const returnedScope = service.getFileScope();
	returnedScope.rootPath = 'changed via getter';
	returnedScope.ignorePatterns.push('*.tmp');

	assert.equal(service.getRootPath(), 'C:\\existing');
	assert.deepEqual(service.getFileScope().ignorePatterns, []);
});

test('adds records and persists the updated state', async () => {
	const { service, savedData } = createService();

	await service.load();

	const record = makeRecord();
	await service.addFileRecords([record]);

	assert.equal(service.getFileRecordCount(), 1);
	assert.deepEqual(savedData[0].pluginData.fileRecords, [record]);
	assert.equal(savedData[0].pluginData.version, 2);

	record.path = 'changed after saving';
	assert.equal(savedData[0].pluginData.fileRecords[0].path, 'docs/report.pdf');
});

test('adding an empty batch does not persist anything', async () => {
	const { service, savedData } = createService();
	await service.load();

	await service.addFileRecords([]);

	assert.equal(service.getFileRecordCount(), 0);
	assert.equal(savedData.length, 0);
});

test('failed record persistence leaves in-memory state unchanged', async () => {
	const service = new PluginStateService({
		loadData: async () => makeData(),
		saveData: async () => {
			throw new Error('Disk failure');
		},
	});
	await service.load();

	await assert.rejects(service.addFileRecords([makeRecord()]), /Disk failure/);
	assert.equal(service.getFileRecordCount(), 0);
});

test('sets and persists a validated, trimmed root path', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'file-pilot-state-'));
	t.after(async () => rm(directory, { recursive: true, force: true }));

	const { service, savedData } = createService();
	await service.load();

	await service.setRootPath('  ' + directory + '  ');

	assert.equal(service.getRootPath(), directory);
	assert.equal(savedData[0].settingData.fileScope.rootPath, directory);
});

test('rejects relative paths, missing directories and regular files', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'file-pilot-state-'));
	t.after(async () => rm(directory, { recursive: true, force: true }));

	const regularFile = join(directory, 'not-a-directory.txt');
	await writeFile(regularFile, 'test');

	const { service, savedData } = createService();
	await service.load();

	await assert.rejects(
		service.setRootPath('relative/folder'),
		ScanRootInvalidError,
	);
	await assert.rejects(
		service.setRootPath(join(directory, 'missing')),
		ScanRootNotFoundError,
	);
	await assert.rejects(
		service.setRootPath(regularFile),
		ScanRootNotFoundError,
	);

	assert.equal(service.getRootPath(), '');
	assert.equal(savedData.length, 0);
});

test('prevents changing the root when file records exist', async () => {
	const storedData = makeData('C:\\existing', [makeRecord()]);
	const { service, savedData } = createService(storedData);
	await service.load();

	await assert.rejects(
		service.setRootPath('C:\\different'),
		ScanRootLockedError,
	);

	assert.equal(service.getRootPath(), 'C:\\existing');
	assert.equal(savedData.length, 0);
});

test('setting the same root path does not save again', async () => {
	const { service, savedData } = createService(
		makeData('C:\\existing', [makeRecord()]),
	);
	await service.load();

	await service.setRootPath('C:\\existing');

	assert.equal(savedData.length, 0);
});

test('allows clearing a configured scan root', async () => {
	const { service, savedData } = createService(makeData('C:\\existing'));
	await service.load();

	await service.setRootPath('   ');

	assert.equal(service.getRootPath(), '');
	assert.equal(savedData.length, 1);
	assert.equal(savedData[0].settingData.fileScope.rootPath, '');
});

test('failed root persistence leaves the previous path unchanged', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'file-pilot-state-'));
	t.after(async () => rm(directory, { recursive: true, force: true }));

	const service = new PluginStateService({
		loadData: async () => makeData(),
		saveData: async () => {
			throw new Error('Disk failure');
		},
	});
	await service.load();

	await assert.rejects(service.setRootPath(directory), /Disk failure/);
	assert.equal(service.getRootPath(), '');
});

test('requires load before accessing state', async () => {
	const { service } = createService();

	assert.throws(() => service.getRootPath(), /has not been loaded/);
	assert.throws(() => service.getFileRecordCount(), /has not been loaded/);
	await assert.rejects(service.addFileRecords([makeRecord()]), /has not been loaded/);
});
