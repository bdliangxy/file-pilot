import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { makeFileRecord } from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { searchFileRecords } = await jiti.import(
	'../../src/utils/file-search-utils.ts',
);

function makeRecords() {
	return [
		makeFileRecord('report', { path: 'docs/report.pdf' }),
		makeFileRecord('budget', { path: 'Projects/Finance/Budget.XLSX' }),
		makeFileRecord('photo', { path: 'images/photo.png' }),
		makeFileRecord('archive', { path: 'archive/report.docx' }),
	];
}

function searchPaths(records, query) {
	return searchFileRecords(records, { query }).map(record => record.path);
}

test('searches file names using a substring of the relative path', () => {
	const records = makeRecords();

	assert.deepEqual(searchPaths(records, 'report'), [
		'docs/report.pdf',
		'archive/report.docx',
	]);
});

test('searches directories in the relative path', () => {
	assert.deepEqual(searchPaths(makeRecords(), 'Projects/Finance'), [
		'Projects/Finance/Budget.XLSX',
	]);
});

test('accepts both backslashes and forward slashes in the query', () => {
	const records = makeRecords();

	assert.deepEqual(searchPaths(records, 'Projects\\Finance\\Budget'), [
		'Projects/Finance/Budget.XLSX',
	]);
	assert.deepEqual(searchPaths(records, 'Projects/Finance/Budget'), [
		'Projects/Finance/Budget.XLSX',
	]);
});

test('an empty or whitespace-only query returns every record in a new array', () => {
	const records = makeRecords();

	for (const query of ['', '   ']) {
		const result = searchFileRecords(records, { query });
		assert.deepEqual(result, records);
		assert.notStrictEqual(result, records);
		assert.strictEqual(result[0], records[0]);
	}
});

test('returns an empty array when nothing matches', () => {
	assert.deepEqual(searchPaths(makeRecords(), 'nonexistent'), []);
});

test('does not search Shadow Note paths, metadata, or an implicit root path', () => {
	const records = [
		makeFileRecord('record-1', {
			path: 'docs/report.pdf',
			shadowNotePath: 'ShadowNotes/important-summary.md',
			baseName: 'different-name',
		}),
	];

	assert.deepEqual(searchPaths(records, 'important-summary'), []);
	assert.deepEqual(searchPaths(records, 'different-name'), []);
	assert.deepEqual(searchPaths(records, 'D:/ManagedFiles'), []);
});

test('matches managed folder records by their relative paths too', () => {
	const folder = {
		id: 'folder-1',
		kind: 'folder',
		path: 'Projects/Empty',
		baseName: 'Empty',
		mtimeMs: 123,
		status: 'available',
		shadowNotePath: 'ShadowNotes/Empty.md',
	};

	assert.deepEqual(searchPaths([folder], 'projects/empty'), ['Projects/Empty']);
});
