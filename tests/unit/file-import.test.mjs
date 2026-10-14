import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFakeShadowNoteService,
	createTestJiti,
	makeScannedFile,
} from '../fakes/index.mjs';

const jiti = createTestJiti(import.meta.url);
const { importScannedFiles } = await jiti.import(
	'../../src/core/file-import.ts',
);

test('imports metadata and links each FileRecord to its own Shadow Note', async () => {
	const service = createFakeShadowNoteService();
	const files = [
		makeScannedFile('docs/report.pdf', { baseName: 'report' }),
		makeScannedFile('other/report.pdf', { baseName: 'report' }),
	];
	const records = await importScannedFiles(files, service);

	assert.equal(records.length, files.length);
	assert.notEqual(records[0].id, records[1].id);
	for (const [index, record] of records.entries()) {
		const source = files[index];
		assert.match(
			record.id,
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		assert.deepEqual(record, {
			...source,
			id: record.id,
			status: 'available',
			shadowNotePath: `ShadowNotes/${source.path.replaceAll('/', '_')}.md`,
		});
	}

	assert.deepEqual(
		service.requestedPaths,
		files.map((file) => file.path),
	);
	assert.deepEqual(
		service.createdNotes,
		records.map((record) => ({
			notePath: record.shadowNotePath,
			fileId: record.id,
		})),
	);
});

test('falls back to a UUID-suffixed Shadow Note name if candidates are exhausted', async () => {
	const service = createFakeShadowNoteService();
	service.getAvailableShadowNotePath = () => {
		throw new Error('No available candidate name');
	};

	const [record] = await importScannedFiles(
		[makeScannedFile('docs/report.pdf', { baseName: 'report' })],
		service,
	);

	assert.ok(record);
	assert.equal(
		record.shadowNotePath,
		`ShadowNotes/report-${record.id}.md`,
	);
	assert.deepEqual(service.createdNotes, [{
		notePath: record.shadowNotePath,
		fileId: record.id,
	}]);
});
