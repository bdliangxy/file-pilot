import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTestJiti } from '../helpers/test-jiti.mjs';
import { IGNORE_FILE_TREE, IGNORE_FILE_TREE_SORTED } from '../fixtures/file-trees.mjs';
import { createTempFileTree } from '../helpers/temp-filesystem.mjs';

const jiti = createTestJiti(import.meta.url);
const { FileScanner } = await jiti.import(
	'../../src/core/file-scanner.ts',
);

async function createTestFiles() {
	const rootPath = await fs.mkdtemp(
		path.join(os.tmpdir(), 'file-pilot-scanner-unit-test-'),
	);

	await fs.mkdir(
		path.join(rootPath, 'folder'),
		{ recursive: true },
	);

	await Promise.all([
		fs.writeFile(path.join(rootPath, 'a.pdf'), 'pdf-content'),
		fs.writeFile(path.join(rootPath, 'b.docx'), 'docx-content'),
		fs.writeFile(path.join(rootPath, 'image.png'), 'png-content'),
		fs.writeFile(path.join(rootPath, 'program.cpp'), 'cpp-content'),
		fs.writeFile(path.join(rootPath, 'archive.zip'), 'zip-content'),
		fs.writeFile(path.join(rootPath, 'unknown.xyz'), 'xyz-content'),
		fs.writeFile(
			path.join(rootPath, 'folder', 'c.txt'),
			'text-content',
		),
	]);

	return rootPath;
}

test('recursively scans regular files into ScannedFileInfo', async (t) => {
	const rootPath = await createTestFiles();

	t.after(async () => {
		await fs.rm(rootPath, {
			recursive: true,
			force: true,
		});
	});

	const scanner = new FileScanner();

	const results = await scanner.scan({
		rootPath,
		ignorePatterns: [],
		watchEnabled: false,
	});

	const scannedPaths = results
		.map((file) => file.path)
		.sort();

	assert.deepEqual(scannedPaths, [
		'a.pdf',
		'archive.zip',
		'b.docx',
		'folder/c.txt',
		'image.png',
		'program.cpp',
		'unknown.xyz',
	]);
});

test('builds correct file name and metadata', async (t) => {
	const rootPath = await createTestFiles();

	t.after(async () => {
		await fs.rm(rootPath, {
			recursive: true,
			force: true,
		});
	});

	const scanner = new FileScanner();

	const results = await scanner.scan({
		rootPath,
		ignorePatterns: [],
		watchEnabled: false,
	});

	const file = results.find(
		(item) => item.path === 'folder/c.txt',
	);

	assert.ok(file);
	assert.equal(file.baseName, 'c');
	assert.equal(file.extension, 'txt');
	assert.equal(file.size, Buffer.byteLength('text-content'));
	assert.ok(file.mtimeMs > 0);

	if (file.nativeIdentity !== undefined) {
		assert.match(file.nativeIdentity, /^\d+:\d+$/);
	}
});


async function scanIgnoreFixture(t, ignorePatterns) {
    const fixture = await createTempFileTree(IGNORE_FILE_TREE);
    t.after(() => fixture.cleanup());

    const scanner = new FileScanner();
    const results = await scanner.scan({
        rootPath: fixture.rootPath,
        ignorePatterns,
        watchEnabled: false,
    });

    return results.map((file) => file.path).sort();
}

test('ignores an exact root-relative file path', async (t) => {
    const paths = await scanIgnoreFixture(t, ['folder/c.txt']);

    assert.equal(paths.includes('folder/c.txt'), false);
    assert.equal(paths.includes('folder/keep.pdf'), true);
    assert.equal(paths.includes('report.pdf'), true);
});

test('ignores files matching a wildcard at any depth', async (t) => {
    const paths = await scanIgnoreFixture(t, ['*.tmp']);

    assert.equal(paths.includes('temp.tmp'), false);
    assert.equal(paths.includes('folder/keep.pdf'), true);
});

test('ignores an entire directory and all its descendants', async (t) => {
    const paths = await scanIgnoreFixture(t, ['ignored/']);

    assert.equal(paths.some((file) => file.startsWith('ignored/')), false);
    assert.equal(paths.includes('report.pdf'), true);
});

test('anchors slash-prefixed directory patterns to the scan root', async (t) => {
    const paths = await scanIgnoreFixture(t, ['/temp/']);

    assert.equal(paths.includes('temp/root.txt'), false);
    assert.equal(paths.includes('folder/temp/nested.txt'), true);
});

test('ignores a filename at any directory depth', async (t) => {
    const paths = await scanIgnoreFixture(t, ['Thumbs.db']);

    assert.equal(paths.includes('Thumbs.db'), false);
    assert.equal(paths.includes('folder/Thumbs.db'), false);
    assert.equal(paths.includes('report.pdf'), true);
});

test('does not filter files when ignore patterns are empty', async (t) => {
    const paths = await scanIgnoreFixture(t, []);

    assert.deepEqual(paths, IGNORE_FILE_TREE_SORTED);
});

test('supports ordered negation rules for files', async (t) => {
    const paths = await scanIgnoreFixture(t, ['*.pdf', '!folder/important.pdf']);

    assert.equal(paths.includes('report.pdf'), false);
    assert.equal(paths.includes('folder/keep.pdf'), false);
    assert.equal(paths.includes('folder/important.pdf'), true);
});

test('does not re-include a file inside an ignored parent directory', async (t) => {
    const paths = await scanIgnoreFixture(t, ['ignored/', '!ignored/secret.pdf']);

    assert.equal(paths.includes('ignored/secret.pdf'), false);
    assert.equal(paths.includes('ignored/nested/deep.txt'), false);
});
