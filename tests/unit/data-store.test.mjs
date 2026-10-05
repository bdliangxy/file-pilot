import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { DataStore } = await jiti.import('../../src/data/data-store.ts');

test('loads stored data', async () => {
	const storedData = {
		pluginSettings: {
			fileScope: {
				rootPath: 'F:\\test\\ob-external-files',
				ignorePatterns: [],
				watchEnabled: true,
			},

		},
		pluginData: {
			version: 2,
			fileRecords: [],
		},
	};
	const store = new DataStore({
		loadData: async () => storedData,
		saveData: async () => assert.fail('Unexpected save'),
	});

	assert.deepEqual(await store.load(), storedData);
});

test('saves defaults when stored data is missing', async () => {
	let savedData;
	const store = new DataStore({
		loadData: async () => null,
		saveData: async (data) => {
			savedData = data;
		},
	});
	const expectedData = {
		pluginSettings: {
			fileScope: {
				rootPath: '',
				ignorePatterns: [],
				watchEnabled: true,
			},
		},
		pluginData: {
			version: 1,
			fileRecords: [],
		},
	}
	assert.deepEqual(await store.load(), expectedData);
	assert.deepEqual(savedData, expectedData);
});

test('mutating loaded data does not mutate the default data template', async () => {
	const createStore = () => new DataStore({
		loadData: async () => null,
		saveData: async () => { },
	});

	const firstData = await createStore().load();

	firstData.pluginSettings.fileScope.ignorePatterns.push('*.tmp');
	firstData.pluginData.fileRecords.push({
		id: 'test-id',
		path: 'test.txt',
		baseName: 'test',
		extension: 'txt',
		size: 1,
		mtimeMs: 0,
		shadowNotePath: 'test.md',
	});

	const secondData = await createStore().load();

	assert.deepEqual(
		secondData.pluginSettings.fileScope.ignorePatterns,
		[],
	);

	assert.deepEqual(
		secondData.pluginData.fileRecords,
		[],
	);
});
