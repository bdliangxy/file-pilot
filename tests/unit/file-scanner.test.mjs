import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
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

