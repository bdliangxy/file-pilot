import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeVault } from '../fakes/index.mjs';
import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const { ShadowNoteService } = await jiti.import('../../src/core/shadow-note.ts');

function setup(existingPaths = []) {
	const fake = createFakeVault(existingPaths);
	return { service: new ShadowNoteService({ vault: fake.vault }), ...fake };
}

test('uses the file name when no Shadow Note name conflicts', () => {
	const { service, lookedUpPaths } = setup();
	const path = service.getAvailableShadowNotePath('docs/report.pdf', 'file-1');
	assert.equal(path, 'ShadowNotes/report.pdf.md');
	assert.deepEqual(lookedUpPaths, ['ShadowNotes/report.pdf.md']);
});

test('adds parent folder names when the first candidate conflicts', () => {
	const { service, lookedUpPaths } = setup(['ShadowNotes/report.pdf.md']);
	const path = service.getAvailableShadowNotePath('docs/report.pdf', 'file-1');
	assert.equal(path, 'ShadowNotes/docs_report.pdf.md');
	assert.deepEqual(lookedUpPaths, [
		'ShadowNotes/report.pdf.md',
		'ShadowNotes/docs_report.pdf.md',
	]);
});

test('falls back to UUID-suffixed name when all parent candidates conflict', () => {
	const { service, lookedUpPaths } = setup([
		'ShadowNotes/report.pdf.md',
		'ShadowNotes/docs_report.pdf.md',
	]);
	const path = service.getAvailableShadowNotePath('docs/report.pdf', 'file-123');
	assert.equal(path, 'ShadowNotes/report.pdf-file-123.md');
	assert.deepEqual(lookedUpPaths, [
		'ShadowNotes/report.pdf.md',
		'ShadowNotes/docs_report.pdf.md',
	]);
});

test('retrieves the Shadow Note associated with a FileRecord', () => {
	const notePath = 'ShadowNotes/report.pdf.md';
	const { service } = setup([notePath]);
	assert.deepEqual(service.getShadowNote({ shadowNotePath: notePath }), {
		path: notePath,
	});
	assert.equal(service.getShadowNote({ shadowNotePath: 'ShadowNotes/missing.md' }), null);
});

test('creates the ShadowNotes folder with file-id and File Summary heading', async () => {
	const { service, createdFolders, createdFiles } = setup();
	await service.createShadowNote('ShadowNotes/report.pdf.md', 'file-123');
	assert.deepEqual(createdFolders, ['ShadowNotes']);
	assert.deepEqual(createdFiles, [{
		path: 'ShadowNotes/report.pdf.md',
		content: '---\nfile-id: file-123\n---\n\n## File Summary\n\n',
	}]);
});

function setupSummary({ exists = true, cache = null, content = '' } = {}) {
    const notePath = 'ShadowNotes/report.pdf.md';
    const reads = [];
    const app = {
        vault: {
            getFileByPath(path) {
                return exists && path === notePath ? { path } : null;
            },
            async cachedRead(note) {
                reads.push(note.path);
                return content;
            },
        },
        metadataCache: {
            getFileCache(note) {
                assert.equal(note.path, notePath);
                return cache;
            },
        },
    };
    return {
        service: new ShadowNoteService(app),
        record: { shadowNotePath: notePath },
        reads,
    };
}

test('getFileSummary returns null when the Shadow Note is missing', async () => {
    const { service, record, reads } = setupSummary({ exists: false });
    assert.equal(await service.getFileSummary(record), null);
    assert.deepEqual(reads, []);
});

test('getFileSummary returns null when heading metadata is unavailable', async () => {
    const { service, record, reads } = setupSummary({ cache: {} });
    assert.equal(await service.getFileSummary(record), null);
    assert.deepEqual(reads, []);
});

test('getFileSummary extracts the first paragraph using Obsidian heading metadata', async () => {
    const { shadowNoteFixtures } = await import('../fixtures/shadow-notes.mjs');
    const fixture = shadowNoteFixtures.standard;
    const { service, record, reads } = setupSummary({
        cache: { headings: fixture.headings },
        content: fixture.content,
    });
    assert.equal(
        await service.getFileSummary(record),
        'This is a project report. It contains budget information.',
    );
    assert.deepEqual(reads, [record.shadowNotePath]);
});

test('getFileSummary returns null for an empty File Summary section', async () => {
    const { shadowNoteFixtures } = await import('../fixtures/shadow-notes.mjs');
    const fixture = shadowNoteFixtures.empty;
    const { service, record } = setupSummary({
        cache: { headings: fixture.headings },
        content: fixture.content,
    });
    assert.equal(await service.getFileSummary(record), null);
});
