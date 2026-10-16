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

test('creates the ShadowNotes folder and writes file-id frontmatter', async () => {
	const { service, createdFolders, createdFiles } = setup();
	await service.createShadowNote('ShadowNotes/report.pdf.md', 'file-123');
	assert.deepEqual(createdFolders, ['ShadowNotes']);
	assert.deepEqual(createdFiles, [{
		path: 'ShadowNotes/report.pdf.md',
		content: '---\nfile-id: file-123\n---\n',
	}]);
});
