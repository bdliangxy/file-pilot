import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

const { formatFileSize } = await jiti.import(
	'../../src/utils/file-utils.ts'
);

test('formats file sizes using automatic units', () => {
	assert.equal(formatFileSize(0), '0 B');
	assert.equal(formatFileSize(512), '512 B');
	assert.equal(formatFileSize(1024), '1 KB');
	assert.equal(formatFileSize(1536), '1.5 KB');
	assert.equal(formatFileSize(1024 ** 2), '1 MB');
	assert.equal(formatFileSize(1024 ** 3), '1 GB');
	assert.equal(formatFileSize(1024 ** 4), '1 TB');
	assert.equal(formatFileSize(1024 ** 5), '1 PB');
});

test('rejects invalid file sizes', () => {
	assert.equal(formatFileSize(-1), '—');
	assert.equal(formatFileSize(NaN), '—');
	assert.equal(formatFileSize(Infinity), '—');
});
