import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFakeShadowNoteService } from '../fakes/index.mjs';
import { makeScannedFile } from '../factories/file-record.mjs';
import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const { FileSyncService } = await jiti.import(
	'../../src/core/file-sync.ts',
);
const { FilePilotError } = await jiti.import('../../src/error.ts');
const { FileScanner } = await jiti.import('../../src/core/file-scanner.ts');

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
		() => [],
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

test('repeated scans reuse existing records without creating duplicate Shadow Notes', async () => {
	const scope = makeScope();
	const scannedFiles = [
		makeScannedFile('a.pdf', { nativeIdentity: '1:1' }),
		makeScannedFile('folder/b.txt', { nativeIdentity: '1:2' }),
	];
	let scanCount = 0;
	let persistCount = 0;
	const storedRecords = [];
	const scanner = {
		async scan() {
			scanCount += 1;
			return scannedFiles;
		},
	};
	const shadowNoteService = createFakeShadowNoteService();
	const service = new FileSyncService(
		scanner,
		shadowNoteService,
		async (records) => {
			persistCount += 1;
			storedRecords.push(...records);
		},
		() => structuredClone(storedRecords),
	);

	const firstResult = await service.syncFiles(scope);
	const firstRecords = structuredClone(storedRecords);
	const firstNotes = structuredClone(shadowNoteService.createdNotes);

	const secondResult = await service.syncFiles(scope);

	assert.equal(scanCount, 2);
	assert.equal(firstResult.importedCount, 2);
	assert.equal(secondResult.importedCount, 0);
	assert.equal(persistCount, 1);
	assert.deepEqual(storedRecords, firstRecords);
	assert.deepEqual(shadowNoteService.createdNotes, firstNotes);
	assert.equal(shadowNoteService.requestedPaths.length, 2);
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
		() => [],
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
		() => [],
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
		() => [],
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
		() => [],
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
		() => [],
	);

	await assert.rejects(
		service.syncFiles(makeScope()),
		/temporary failure/,
	);

	const result = await service.syncFiles(makeScope());

	assert.equal(scanCount, 2);
	assert.equal(result.importedCount, 0);
});

test('real directory scan imports folders and files once, including empty folders', async (t) => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'file-pilot-sync-folders-'));
    t.after(() => fs.rm(rootPath, { recursive: true, force: true }));
    await fs.mkdir(path.join(rootPath, 'Projects', 'Empty'), { recursive: true });
    await fs.mkdir(path.join(rootPath, 'Ignored'), { recursive: true });
    await fs.writeFile(path.join(rootPath, 'Projects', 'report.pdf'), 'report');
    await fs.writeFile(path.join(rootPath, 'Ignored', 'secret.txt'), 'secret');

    const records = [];
    const notes = createFakeShadowNoteService();
    let saveCount = 0;
    const service = new FileSyncService(
        new FileScanner(),
        notes,
        async (batch) => {
            saveCount++;
            records.push(...structuredClone(batch));
        },
        () => structuredClone(records),
    );
    const scope = { rootPath, ignorePatterns: ['/Ignored/'], watchEnabled: false };
    const first = await service.syncFiles(scope);
    assert.equal(first.importedCount, 3);
    assert.deepEqual(
        records.map(record => [record.kind, record.path]).sort((a, b) => a[1].localeCompare(b[1])),
        [
            ['folder', 'Projects'],
            ['folder', 'Projects/Empty'],
            ['file', 'Projects/report.pdf'],
        ],
    );
    assert.ok(records.every(record => record.id && record.shadowNotePath));
    assert.equal(new Set(records.map(record => record.id)).size, 3);
    assert.equal(notes.createdNotes.length, 3);
    const empty = records.find(record => record.path === 'Projects/Empty');
    assert.equal(Object.hasOwn(empty, 'size'), false);
    assert.equal(Object.hasOwn(empty, 'extension'), false);

    const second = await service.syncFiles(scope);
    assert.equal(second.importedCount, 0);
    assert.equal(saveCount, 1);
    assert.equal(notes.createdNotes.length, 3);
});
