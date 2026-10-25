import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import ignore from 'ignore';
import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const {
    MAX_EXTENSION_LENGTH,
    inputIsValidExtension,
    classifyIgnorePattern,
    escapeGitignorePath,
    createSelectedIgnorePattern,
    getDisplayStatus,
} = await jiti.import('../../src/utils/ignore-rule-utils.ts');

test('extension validation accepts simple and compound suffixes within the limit', () => {
    for (const extension of ['pdf', 'tar.gz', 'XLSX', 'test_1-v2', 'a'.repeat(MAX_EXTENSION_LENGTH)]) {
        assert.equal(inputIsValidExtension(extension), true, extension);
    }
});

test('extension validation rejects empty, malformed, unsupported and oversized values', () => {
    for (const extension of [
        '', '.pdf', 'pdf.', 'tar..gz', '*.pdf', 'a/b', 'a\\b',
        'with space', '中文', 'a'.repeat(MAX_EXTENSION_LENGTH + 1),
    ]) {
        assert.equal(inputIsValidExtension(extension), false, extension);
    }
});

test('classifies literal directory, filename and extension rules', () => {
    for (const [pattern, category] of [
        ['/reports/', 'directories'],
        ['cache/', 'directories'],
        ['docs/report.pdf', 'filenames'],
        ['/docs/report.pdf', 'filenames'],
        ['Thumbs.db', 'filenames'],
        ['*.pdf', 'extensions'],
        ['*.tar.gz', 'extensions'],
    ]) {
        assert.equal(classifyIgnorePattern(pattern), category, pattern);
    }
});

test('does not misclassify empty, negation, comments or complex wildcard rules', () => {
    for (const pattern of [
        '', '   ', '# comment', '!keep.pdf', '*.pdf/**',
        '**/build/', 'file?.txt', '[ab].pdf', '*/',
    ]) {
        assert.equal(classifyIgnorePattern(pattern), null, pattern);
    }
});

test('escapes special gitignore characters and trailing spaces', () => {
    assert.equal(
        escapeGitignorePath('docs/a*b?[1]#!\\file.txt  '),
        'docs/a\\*b\\?\\[1\\]\\#\\!\\\\file.txt\\ \\ ',
    );
    assert.equal(escapeGitignorePath('docs/normal.pdf'), 'docs/normal.pdf');
});

test('creates root-anchored ignore rules for selected files and directories', () => {
    const root = path.join('temporary', 'file-pilot-root');
    assert.equal(
        createSelectedIgnorePattern(root, path.join(root, 'docs', 'report.pdf'), 'filenames'),
        '/docs/report.pdf',
    );
    assert.equal(
        createSelectedIgnorePattern(root, path.join(root, 'docs', 'cache'), 'directories'),
        '/docs/cache/',
    );
});

test('generated rules ignore selected literals but not similarly named files', () => {
    const root = path.join('temporary', 'file-pilot-root');
    const selected = path.join(root, 'folder', 'data[1]?.txt');
    const rule = createSelectedIgnorePattern(root, selected, 'filenames');
    const matcher = ignore().add([rule]);

    assert.equal(matcher.ignores('folder/data[1]?.txt'), true);
    assert.equal(matcher.ignores('folder/dataA1X.txt'), false);
    assert.equal(matcher.ignores('other/data[1]?.txt'), false);
});


test('display status prioritizes ignored rules without mutating FileRecord', () => {
    const record = { path: 'reports/a.pdf', status: 'missing' };
    const original = structuredClone(record);
    const ignored = ignore().add(['/reports/']);
    assert.equal(getDisplayStatus(record, ignored), 'ignored');
    assert.deepEqual(record, original);
    assert.equal(getDisplayStatus(record, ignore()), 'missing');
});

test('display status respects filename, extension, and negation rules', () => {
    const matcher = ignore().add(['*.pdf', '!reports/keep.pdf', '/private/']);
    for (const [path, status, expected] of [
        ['reports/a.pdf', 'available', 'ignored'],
        ['reports/keep.pdf', 'available', 'available'],
        ['other/readme.txt', 'missing', 'missing'],
        ['private/report.txt', 'missing', 'ignored'],
    ]) {
        assert.equal(getDisplayStatus({ path, status }, matcher), expected, path);
    }
});
