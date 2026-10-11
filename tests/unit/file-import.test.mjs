import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

// ShadowNoteService imports Obsidian; alias it to the existing test mock.
const mockPath = fileURLToPath(new URL('../mocks/obsidian.mjs', import.meta.url));
const jiti = createJiti(import.meta.url, {
	alias: { obsidian: mockPath },
});
const { importScannedFiles } = await jiti.import('../../src/core/file-import.ts');

function scannedFile(path, baseName) {
	return {
		path,
		baseName,
		extension: 'pdf',
		nativeIdentity: '1:2',
		size: 123,
		mtimeMs: 456,
	};
}

function createService() {
	const requestedPaths = [];
	const createdNotes = [];

	return {
		requestedPaths,
		createdNotes,
		getAvailableShadowNotePath(relativePath) {
			requestedPaths.push(relativePath);
			return `ShadowNotes/${relativePath.replaceAll('/', '_')}.md`;
		},
		async createShadowNote(notePath, fileId) {
			createdNotes.push({ notePath, fileId });
		},
	};
}

test('imports metadata and links each FileRecord to its own Shadow Note', async () => {
	const service = createService();
	const files = [
		scannedFile('docs/report.pdf', 'report'),
		scannedFile('other/report.pdf', 'report'),
	];
	const records = await importScannedFiles(files, service);

	assert.equal(records.length, files.length);
	assert.notEqual(records[0].id, records[1].id);
	for (const [index, record] of records.entries()) {
		const source = files[index];
		assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
		assert.deepEqual(record, {
			...source,
			id: record.id,
			status: 'available',
			shadowNotePath: `ShadowNotes/${source.path.replaceAll('/', '_')}.md`,
		});
	}

	assert.deepEqual(service.requestedPaths, files.map((file) => file.path));
	assert.deepEqual(service.createdNotes, records.map((record) => ({
		notePath: record.shadowNotePath,
		fileId: record.id,
	})));
});

test('falls back to a UUID-suffixed Shadow Note name if candidates are exhausted', async () => {
	const service = createService();
	service.getAvailableShadowNotePath = () => {
		throw new Error('No available candidate name');
	};

	const [record] = await importScannedFiles(
		[scannedFile('docs/report.pdf', 'report')],
		service,
	);

	assert.ok(record);
	assert.equal(record.shadowNotePath, `ShadowNotes/report-${record.id}.md`);
	assert.deepEqual(service.createdNotes, [{
		notePath: record.shadowNotePath,
		fileId: record.id,
	}]);
});
