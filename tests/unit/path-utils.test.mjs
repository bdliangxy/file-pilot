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

