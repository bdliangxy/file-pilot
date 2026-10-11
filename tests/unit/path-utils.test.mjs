import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
	unifyPathFormat,
	getRelativeFilePath,
	getAbsoluteFilePath,
	getFileExtension,
	getFileBaseName,
	getShadowNoteFileName,
} = await jiti.import('../../src/utils/path-utils.ts');

test('converts paths to root-relative forward-slash form', () => {
	const rootPath = path.join('example', 'root');
	const absolutePath = getAbsoluteFilePath(rootPath, path.join('docs', 'report.pdf'));

	assert.equal(absolutePath, path.join(rootPath, 'docs', 'report.pdf'));
	assert.equal(getRelativeFilePath(rootPath, absolutePath), 'docs/report.pdf');
	assert.equal(unifyPathFormat('docs\\archive\\report.pdf'), 'docs/archive/report.pdf');
});

test('extracts file names and extensions', () => {
	assert.equal(getFileBaseName('archive.tar.gz'), 'archive.tar');
	assert.equal(getFileExtension('archive.tar.gz'), 'gz');
	assert.equal(getFileBaseName('README'), 'README');
	assert.equal(getFileExtension('README'), null);
	assert.equal(getFileExtension('.gitignore'), null);
});

test('expands Shadow Note names using parent folders and stops at the root', () => {
	const relativePath = 'projects/docs/report.pdf';

	assert.equal(getShadowNoteFileName(relativePath, 0), 'report.pdf.md');
	assert.equal(getShadowNoteFileName(relativePath, 1), 'docs_report.pdf.md');
	assert.equal(getShadowNoteFileName(relativePath, 2), 'projects_docs_report.pdf.md');
	assert.equal(getShadowNoteFileName(relativePath, 3), null);
});
