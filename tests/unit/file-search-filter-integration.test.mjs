import assert from 'node:assert/strict';
import test from 'node:test';
import ignore from 'ignore';
import { createJiti } from 'jiti';
import { makeFileRecord, makeScannedFolder } from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { filterFileRecords } = await jiti.import(
	'../../src/utils/file-filter-utils.ts',
);
const { searchFileRecords } = await jiti.import(
	'../../src/utils/file-search-utils.ts',
);

function makeRecords() {
	return [
		makeFileRecord('available-report', { path: 'Docs/report.pdf' }),
		makeFileRecord('missing-report', {
			path: 'Archive/report.pdf',
			status: 'missing',
		}),
		makeFileRecord('ignored-report', { path: 'Private/report.pdf' }),
		makeFileRecord('missing-private-report', {
			path: 'Private/missing-report.pdf',
			status: 'missing',
		}),
		makeFileRecord('available-notes', { path: 'Docs/notes.txt' }),
	];
}

function queryIds(records, patterns, status, query, searchFirst = false) {
	const matcher = ignore().add(patterns);
	let draft = [...records];

	if (searchFirst) {
		draft = searchFileRecords(draft, { query });
		draft = filterFileRecords(draft, matcher, { status });
	} else {
		draft = filterFileRecords(draft, matcher, { status });
		draft = searchFileRecords(draft, { query });
	}

	return draft.map(record => record.id);
}

test('status filter and path search return their intersection', () => {
	const records = makeRecords();
	const patterns = ['/Private/'];

	assert.deepEqual(
		queryIds(records, patterns, 'available', 'report'),
		['available-report'],
	);
	assert.deepEqual(
		queryIds(records, patterns, 'missing', 'report'),
		['missing-report', 'missing-private-report'],
	);
	assert.deepEqual(
		queryIds(records, patterns, 'ignored', 'report'),
		['ignored-report'],
	);
});

test('all status and empty query remove their respective restrictions', () => {
	const records = makeRecords();
	const patterns = ['/Private/'];

	assert.deepEqual(
		queryIds(records, patterns, 'all', ''),
		records.map(record => record.id),
	);
	assert.deepEqual(
		queryIds(records, patterns, 'all', 'report'),
		['available-report', 'missing-report', 'ignored-report', 'missing-private-report'],
	);
	assert.deepEqual(
		queryIds(records, patterns, 'ignored', ''),
		['ignored-report'],
	);
});

test('changes to ignore rules affect the combined results', () => {
	const records = makeRecords();

	assert.deepEqual(
		queryIds(records, [], 'available', 'Private/report'),
		['ignored-report'],
	);
	assert.deepEqual(
		queryIds(records, ['/Private/'], 'available', 'Private/report'),
		[],
	);
	assert.deepEqual(
		queryIds(records, ['/Private/'], 'ignored', 'Private/report'),
		['ignored-report'],
	);
});

test('combined filtering and searching works with managed folders', () => {
	const folder = {
		...makeScannedFolder('Projects/Archive'),
		id: 'archive-folder',
		status: 'available',
		shadowNotePath: 'ShadowNotes/Archive.md',
	};
	const records = [
		folder,
		makeFileRecord('project-file', { path: 'Projects/report.pdf' }),
		makeFileRecord('other-file', { path: 'Other/report.pdf' }),
	];

	assert.deepEqual(
		queryIds(records, ['/Projects/'], 'ignored', 'Projects'),
		['archive-folder', 'project-file'],
	);
	assert.deepEqual(
		queryIds(records, ['/Projects/'], 'ignored', 'report'),
		['project-file'],
	);
});

test('search and filter produce the same intersection in either order', () => {
	const records = makeRecords();
	const patterns = ['/Private/'];

	for (const status of ['all', 'available', 'missing', 'ignored']) {
		for (const query of ['', 'report', 'Private', 'Docs', 'nonexistent']) {
			assert.deepEqual(
				queryIds(records, patterns, status, query, false),
				queryIds(records, patterns, status, query, true),
				`status=${status}, query=${query}`,
			);
		}
	}
});

test('each criteria change recomputes the draft from the complete records', () => {
	const records = makeRecords();
	const patterns = ['/Private/'];

	assert.deepEqual(
		queryIds(records, patterns, 'ignored', 'report'),
		['ignored-report'],
	);
	assert.deepEqual(
		queryIds(records, patterns, 'all', 'report'),
		[
			'available-report',
			'missing-report',
			'ignored-report',
			'missing-private-report',
		],
	);
	assert.deepEqual(
		queryIds(records, patterns, 'all', ''),
		records.map(record => record.id),
	);
});
