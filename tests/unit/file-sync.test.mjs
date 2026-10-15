import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFakeShadowNoteService,
	createTestJiti,
	makeScannedFile,
} from '../fakes/index.mjs';

const jiti = createTestJiti(import.meta.url);
const { FileSyncService } = await jiti.import(
	'../../src/core/file-sync.ts',
);
const { FilePilotError } = await jiti.import('../../src/error.ts');

function makeScope(rootPath = 'C:\\files') {
	return {
		rootPath,
		ignorePatterns: [],
		watchEnabled: false,
	};
}

test('scans, imports, and persists records', async () => {
	const scope = makeScope();
	const scannedFiles = [
		makeScannedFile('a.pdf', { nativeIdentity: '1:1' }),
		makeScannedFile('folder/b.txt', { nativeIdentity: '1:2' }),
	];
	const scanCalls = [];
	const persistedBatches = [];
	const scanner = {
		async scan(receivedScope) {
			scanCalls.push(receivedScope);
			return scannedFiles;
		},
	};
	const shadowNoteService = createFakeShadowNoteService();
	const service = new FileSyncService(
		scanner,
		shadowNoteService,
		async (records) => {
			persistedBatches.push(records);
		},
	);

	const result = await service.syncFiles(scope);

	assert.deepEqual(scanCalls, [scope]);
	assert.equal(result.importedCount, 2);
	assert.equal(persistedBatches.length, 1);
	assert.equal(persistedBatches[0].length, 2);
	assert.deepEqual(
		persistedBatches[0].map((record) => record.path),
		scannedFiles.map((file) => file.path),
	);
	assert.deepEqual(
		shadowNoteService.createdNotes.map((note) => note.fileId),
		persistedBatches[0].map((record) => record.id),
	);
});

test('rejects an empty scan root before scanning', async () => {
	let scanCalled = false;
	let persistCalled = false;
	const scanner = {
		async scan() {
			scanCalled = true;
			return [];
		},
	};
	const service = new FileSyncService(
		scanner,
		createFakeShadowNoteService(),
		async () => {
			persistCalled = true;
		},
	);

	await assert.rejects(
		service.syncFiles(makeScope('   ')),
		(error) => error instanceof FilePilotError && error.code === 'SCAN_ROOT_NOT_CONFIGURED',
	);
	assert.equal(scanCalled, false);
	assert.equal(persistCalled, false);
});

test('does not persist when scanning fails', async () => {
	let persistCalled = false;
	const scanner = {
		async scan() {
			throw new Error('scan failed');
		},
	};
	const service = new FileSyncService(
		scanner,
		createFakeShadowNoteService(),
		async () => {
			persistCalled = true;
		},
	);

	await assert.rejects(
		service.syncFiles(makeScope()),
		/scan failed/,
	);
	assert.equal(persistCalled, false);
});

test('propagates persistence failures', async () => {
	const scanner = {
		async scan() {
			return [makeScannedFile('a.pdf')];
		},
	};
	const service = new FileSyncService(
		scanner,
		createFakeShadowNoteService(),
		async () => {
			throw new Error('save failed');
		},
	);

	await assert.rejects(
		service.syncFiles(makeScope()),
		/save failed/,
	);
});

test('rejects a concurrent sync while one is already running', async () => {
	let releaseScan;
	const scanner = {
		scan() {
			return new Promise((resolve) => {
				releaseScan = () => resolve([]);
			});
		},
	};
	const service = new FileSyncService(
		scanner,
		createFakeShadowNoteService(),
		async () => {},
	);

	const firstSync = service.syncFiles(makeScope());

	await assert.rejects(
		service.syncFiles(makeScope()),
		(error) => error instanceof FilePilotError && error.code === 'SYNC_IN_PROGRESS',
	);

	releaseScan();
	await firstSync;
});

test('allows retry after a failed sync', async () => {
	let scanCount = 0;
	const scanner = {
		async scan() {
			scanCount += 1;
			if (scanCount === 1) {
				throw new Error('temporary failure');
			}
			return [];
		},
	};
	const service = new FileSyncService(
		scanner,
		createFakeShadowNoteService(),
		async () => {},
	);

	await assert.rejects(
		service.syncFiles(makeScope()),
		/temporary failure/,
	);

	const result = await service.syncFiles(makeScope());

	assert.equal(scanCount, 2);
	assert.equal(result.importedCount, 0);
});
