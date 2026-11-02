import assert from 'node:assert/strict';
import test from 'node:test';
import ignore from 'ignore';
import { createJiti } from 'jiti';
import { makeFileRecord, makeScannedFolder } from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { filterFileRecords } = await jiti.import(
	'../../src/utils/file-filter-utils.ts',
);

function makeRecords() {
	return [
		makeFileRecord('normal', { path: 'docs/report.txt' }),
		makeFileRecord('missing', {
			path: 'archive/lost.pdf',
			status: 'missing',
		}),
		makeFileRecord('ignored', { path: 'private/secret.txt' }),
		makeFileRecord('missing-ignored', {
			path: 'private/lost.txt',
			status: 'missing',
		}),
	];
}

function filterIds(records, patterns, status) {
	const matcher = ignore().add(patterns);
	return filterFileRecords(records, matcher, { status })
		.map(record => record.id);
}

test('all status returns every record', () => {
	const records = makeRecords();
	assert.deepEqual(
		filterIds(records, ['/private/'], 'all'),
		records.map(record => record.id),
	);
});

test('available status excludes ignored and missing records', () => {
	assert.deepEqual(
		filterIds(makeRecords(), ['/private/'], 'available'),
		['normal'],
	);
});

test('missing status takes priority over matching ignore rules', () => {
	assert.deepEqual(
		filterIds(makeRecords(), ['/private/'], 'missing'),
		['missing', 'missing-ignored'],
	);
});

test('ignored status excludes missing records even in ignored folders', () => {
	assert.deepEqual(
		filterIds(makeRecords(), ['/private/'], 'ignored'),
		['ignored'],
	);
});

test('changing ignore rules changes the filtered results', () => {
	const records = makeRecords();
	assert.deepEqual(filterIds(records, [], 'ignored'), []);
	assert.deepEqual(
		filterIds(records, ['/private/'], 'ignored'),
		['ignored'],
	);
	assert.deepEqual(
		filterIds(records, [], 'available'),
		['normal', 'ignored'],
	);
});

test('folder records match directory ignore rules', () => {
	const folder = {
		...makeScannedFolder('Projects/Archive'),
		id: 'folder',
		status: 'available',
		shadowNotePath: 'ShadowNotes/Archive.md',
	};
	const records = [
		folder,
		makeFileRecord('report', { path: 'Projects/report.pdf' }),
	];

	assert.deepEqual(
		filterIds(records, ['/Projects/'], 'ignored'),
		['folder', 'report'],
	);
	assert.deepEqual(filterIds(records, [], 'available'), [
		'folder', 'report',
	]);
});
