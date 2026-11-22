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
const { PluginStateService, isValidFileId } = await jiti.import('../../src/data/plugin-state-service.ts');
const { DEFAULT_IGNORE_PATTERNS } = await jiti.import('../../src/data/setting-data.ts');
const { FilePilotError } = await jiti.import('../../src/error.ts');

test('validates case-sensitive 12-character FileRecord IDs', () => {
    for (const id of ['Ab7Xc9Km2LdQ', '123456789012', 'aB09_-xY7kLm']) {
        assert.equal(isValidFileId(id), true);
    }
    for (const id of [null, undefined, 123456789012, {}, '', 'short',
        'Ab7Xc9Km2LdQx', 'Ab7Xc9Km2Ld!', 'Ab7Xc9Km2Ld\n']) {
        assert.equal(isValidFileId(id), false);
    }
});

test('loads distinct IDs that differ only in case', async () => {
    const records = [
        makeFileRecord('Ab7Xc9Km2LdQ'),
        makeFileRecord('ab7Xc9Km2LdQ', { path: 'other.pdf' }),
    ];
    const { service, savedData } = createPluginStateServiceTestContext(
        PluginStateService, makePluginData({ fileRecords: records }),
    );
    await service.load();
    assert.deepEqual(service.getFileRecords(), records);
    assert.equal(savedData.length, 0);
});

test('rejects invalid and duplicate IDs without persisting any part of a batch', async () => {
    const existing = makeFileRecord('File00000001');
    const { service, savedData } = createPluginStateServiceTestContext(
        PluginStateService, makePluginData({ fileRecords: [existing] }),
    );
    await service.load();

    const valid = makeFileRecord('File00000002', { path: 'a.pdf' });

    await assert.rejects(service.addFileRecords([
        valid, makeFileRecord('invalid', { path: 'b.pdf' }),
    ]), /Invalid FileRecord ID/);
    await assert.rejects(service.addFileRecords([
        valid, makeFileRecord(existing.id, { path: 'b.pdf' }),
    ]), /Duplicate FileRecord ID/);
    await assert.rejects(service.addFileRecords([
        valid, makeFileRecord(valid.id, { path: 'b.pdf' }),
    ]), /Duplicate FileRecord ID/);

    assert.deepEqual(service.getFileRecords(), [existing]);
    assert.equal(savedData.length, 0);
});

test('accepts case-distinct IDs when adding records', async () => {
    const first = makeFileRecord('Ab7Xc9Km2LdQ');
    const second = makeFileRecord('ab7Xc9Km2LdQ', { path: 'other.pdf' });
    const { service, savedData } = createPluginStateServiceTestContext(
        PluginStateService, makePluginData({ fileRecords: [first] }),
    );
    await service.load();
    await service.addFileRecords([second]);
    assert.deepEqual(service.getFileRecords(), [first, second]);
    assert.deepEqual(savedData[0].pluginData.fileRecords, [first, second]);
});

test('invalid persisted data initializes defaults and logs the reason', async (t) => {
    const valid = makeFileRecord();
    const expected = makePluginData({ ignorePatterns: [...DEFAULT_IGNORE_PATTERNS] });
    const cases = [
        ['invalid top-level value', 42, /expected an object/],
        ['missing settings', { pluginData: {} }, /missing settingData/],
        ['missing plugin data', { settingData: {} }, /missing pluginData/],
        ['invalid plugin data', { settingData: {}, pluginData: null }, /pluginData must be an object/],
        ['missing version', { settingData: {}, pluginData: { fileRecords: [] } }, /missing pluginData.version/],
        ['wrong version', makePluginData({ version: 2 }), /expected version 1/],
        ['invalid records array', { settingData: {}, pluginData: { version: 1, fileRecords: {} } }, /fileRecords must be an array/],
        ['invalid record', makePluginData({ fileRecords: [null] }), /fileRecords\[0\] must be an object/],
        ['missing ID', makePluginData({ fileRecords: [{}] }), /missing fileRecords\[0\].id/],
        ['invalid ID', makePluginData({ fileRecords: [makeFileRecord('invalid')] }), /fileRecords\[0\].id must be a 12-character/],
        ['duplicate ID', makePluginData({ fileRecords: [valid, makeFileRecord(valid.id, { path: 'other.pdf' })] }), /duplicate FileRecord ID.*fileRecords\[1\]/],
    ];

    const warnings = t.mock.method(console, 'warn', () => {});
    for (const [name, storedData, pattern] of cases) {
        warnings.mock.resetCalls();
        const { service, savedData } = createPluginStateServiceTestContext(
            PluginStateService, storedData,
        );
        await service.load();
        assert.equal(service.getFileRecordCount(), 0, name);
        assert.deepEqual(savedData, [expected], name);
        assert.equal(warnings.mock.callCount(), 1, name);
        assert.match(warnings.mock.calls[0].arguments[0], pattern, name);
    }
});

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
		makeFileRecord('File00000001', { path: 'docs/report.pdf' }),
		makeFileRecord('File00000002', { path: 'images/photo.png' }),
	];
	const { service, savedData } = createPluginStateServiceTestContext(
		PluginStateService,
		makePluginData({ fileRecords: originalRecords }),
	);
	await service.load();

	const returnedRecords = service.getFileRecords();
	assert.deepEqual(returnedRecords, originalRecords);

	returnedRecords[0].path = 'changed/by/ui.pdf';
	returnedRecords.push(makeFileRecord('File00000003', { path: 'extra.txt' }));

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
	assert.equal(savedData[0].pluginData.version, 1);

	record.path = 'changed after saving';
	assert.equal(savedData[0].pluginData.fileRecords[0].path, 'docs/report.pdf');
});

test('rejects an already managed path without changing stored records', async () => {
	const existingRecord = makeFileRecord('File00000001', { path: 'docs/report.pdf' });
	const { service, savedData } = createPluginStateServiceTestContext(
		PluginStateService,
		makePluginData({ fileRecords: [existingRecord] }),
	);
	await service.load();

	const duplicatePathRecord = makeFileRecord('File00000002', {
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


test('project name is trimmed, previous name is recorded and both survive reloading', async () => {
    const adapter = createFakeDataAdapter(makePluginData());
    const first = new PluginStateService(adapter);
    await first.load();

    assert.equal(first.getProjectName(), '');
    assert.equal(first.getPreviousProjectName(), null);

    assert.deepEqual(await first.updateSettings({ projectName: '  Work Files  ' }), {
        updated: ['projectName'], errors: {},
    });
    assert.equal(first.getProjectName(), 'Work Files');
    assert.equal(first.getPreviousProjectName(), '');
    assert.equal(adapter.savedData.length, 1);
    assert.equal(adapter.savedData[0].settingData.previousProjectName, '');

    const next = new PluginStateService(adapter);
    await next.load();
    assert.equal(next.getProjectName(), 'Work Files');
    assert.equal(next.getPreviousProjectName(), '');
    assert.equal(adapter.savedData.length, 1);
});

test('preserves the first previous project name across consecutive renames', async () => {
    const { service, savedData } = createPluginStateServiceTestContext(
        PluginStateService,
        makePluginData({ projectName: 'Project A' }),
    );
    await service.load();

    await service.updateSettings({ projectName: 'Project B' });
    assert.equal(service.getProjectName(), 'Project B');
    assert.equal(service.getPreviousProjectName(), 'Project A');

    await service.updateSettings({ projectName: 'Project C' });
    assert.equal(service.getProjectName(), 'Project C');
    assert.equal(service.getPreviousProjectName(), 'Project A');
    assert.equal(savedData.length, 2);
    assert.equal(savedData[1].settingData.projectName, 'Project C');
    assert.equal(savedData[1].settingData.previousProjectName, 'Project A');
});

test('clears previous project name and persists the result only once', async () => {
    const { service, savedData } = createPluginStateServiceTestContext(
        PluginStateService,
        makePluginData({ projectName: 'Project B', previousProjectName: 'Project A' }),
    );
    await service.load();

    await service.clearPreviousProjectName();
    assert.equal(service.getProjectName(), 'Project B');
    assert.equal(service.getPreviousProjectName(), null);
    assert.equal(savedData.length, 1);
    assert.equal(savedData[0].settingData.previousProjectName, null);

    await service.clearPreviousProjectName();
    assert.equal(savedData.length, 1);
});

test('failed clearing preserves the previous project name in memory', async () => {
    const service = new PluginStateService({
        loadData: async () => makePluginData({
            projectName: 'Project B',
            previousProjectName: 'Project A',
        }),
        saveData: async () => { throw new Error('Disk failure'); },
    });
    await service.load();

    await assert.rejects(service.clearPreviousProjectName(), /Disk failure/);
    assert.equal(service.getProjectName(), 'Project B');
    assert.equal(service.getPreviousProjectName(), 'Project A');
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
    assert.equal(service.getPreviousProjectName(), null);
    assert.equal(savedData.length, 0);
    assert.deepEqual((await service.updateSettings({ projectName: '  ' })).updated, ['projectName']);
    assert.equal(service.getProjectName(), '');
    assert.equal(service.getPreviousProjectName(), 'Work');
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
    assert.equal(service.getPreviousProjectName(), null);
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
    assert.equal(service.getPreviousProjectName(), null);
});
