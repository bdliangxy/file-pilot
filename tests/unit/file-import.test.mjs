import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { createJiti } from 'jiti';

import { createFakeShadowNoteService } from '../fakes/index.mjs';
import { makeScannedFile, makeScannedFolder } from '../factories/file-record.mjs';
import { createTestJiti } from '../helpers/test-jiti.mjs';

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
	const usedIds = new Set(['Existing0001']);
	const records = await importScannedFiles(files, service, usedIds);
	assert.equal(usedIds.size, files.length + 1);
	assert.ok(usedIds.has('Existing0001'));
	for (const record of records) {
		assert.ok(usedIds.has(record.id));
		assert.notEqual(record.id, 'Existing0001');
	}

	assert.equal(records.length, files.length);
	assert.notEqual(records[0].id, records[1].id);
	for (const [index, record] of records.entries()) {
		const source = files[index];
		assert.match(
			record.id,
			/^[A-Za-z0-9_-]{12}$/,
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

test('imports folders and files with distinct Shadow Notes', async () => {
    const service = createFakeShadowNoteService();
    const scannedEntries = [
        makeScannedFolder('Projects'),
        makeScannedFolder('Projects/EmptyFolder'),
        makeScannedFolder('Projects/Project.v2'),
        makeScannedFile('Projects/report.pdf'),
    ];

    const records = await importScannedFiles(scannedEntries, service, new Set());
    assert.equal(records.length, scannedEntries.length);
    assert.deepEqual(records.map(record => record.kind), [
        'folder', 'folder', 'folder', 'file',
    ]);
    assert.equal(new Set(records.map(record => record.id)).size, records.length);

    for (const [index, record] of records.entries()) {
        assert.deepEqual(record, {
            ...scannedEntries[index],
            id: record.id,
            status: 'available',
            shadowNotePath: `ShadowNotes/${scannedEntries[index].path.replaceAll('/', '_')}.md`,
        });
    }
    for (const folder of records.filter(record => record.kind === 'folder')) {
        assert.equal(Object.hasOwn(folder, 'size'), false);
        assert.equal(Object.hasOwn(folder, 'extension'), false);
    }
    assert.equal(records[2].baseName, 'Project.v2');
    assert.deepEqual(service.requestedPaths, scannedEntries.map(entry => entry.path));
    assert.deepEqual(service.createdNotes, records.map(record => ({
        notePath: record.shadowNotePath,
        fileId: record.id,
    })));
});

test('retries ID allocation on existing and batch collisions', async (t) => {
    const existingId = 'Existing0001';
    const firstId = 'Ab7Xc9Km2LdQ';
    const secondId = 'Zk3Mr6Tn8PwV';
    const candidates = [existingId, firstId, firstId, secondId];
    let calls = 0;

    const randomBytesMock = t.mock.method(crypto, 'randomBytes', (size) => {
        assert.equal(size, 9);
        assert.ok(calls < candidates.length);
        return Buffer.from(candidates[calls++], 'base64url');
    });
    syncBuiltinESMExports();

    try {
        const service = createFakeShadowNoteService();
        const usedIds = new Set([existingId]);
        const isolatedJiti = createJiti(import.meta.url, { moduleCache: false });
        const { importScannedFiles: importWithMock } = await isolatedJiti.import(
            '../../src/core/file-import.ts',
        );
        const records = await importWithMock(
            [makeScannedFile('a.pdf'), makeScannedFile('b.pdf')],
            service,
            usedIds,
        );

        assert.equal(calls, 4);
        assert.deepEqual(records.map(record => record.id), [firstId, secondId]);
        assert.deepEqual(usedIds, new Set([existingId, firstId, secondId]));
        assert.deepEqual(
            service.createdNotes.map(note => note.fileId),
            [firstId, secondId],
        );
    } finally {
        randomBytesMock.mock.restore();
        syncBuiltinESMExports();
    }
});
