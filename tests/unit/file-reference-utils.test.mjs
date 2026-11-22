import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { parseFileReference, findFileReferenceMatches } = await jiti.import(
    '../../src/utils/file-reference-utils.ts',
);

const ID_A = 'Ab7Xc9Km2LdQ';
const ID_B = 'aB09_-xY7kLm';

test('parses file references and preserves ID case', () => {
    for (const id of [ID_A, ID_A.toLowerCase(), ID_B, '123456789012']) {
        assert.deepEqual(parseFileReference('|||@' + id + '|||'), { id });
        assert.deepEqual(parseFileReference('  |||@' + id + '|||  '), { id });
    }
});

test('rejects malformed and obsolete file references', () => {
    const invalidReferences = [
        '',
        '|||@abc|||',
        '|||!invalid|||',
        '|||!550e8400-e29b-41d4-a716-446655440000|||',
        '|||!Ab7Xc9Km2LdQ|||',
        '|||@abcdefghijkl||',
        '||||@abcdefghijkl|||',
        '|||@abcdefghijkl||||',
        '||| @abcdefghijkl |||',
        '|||@ abcdefghijkl|||',
        'text |||@abcdefghijkl||| text',
        '|||@abcdefghijkl||||||@abcdefghijkl|||',
        '|||@abcdefghijk!|||',
        '|||@abcdefghijklmnop|||',
    ];

    for (const text of invalidReferences) {
        assert.equal(parseFileReference(text), null, text);
    }
});

test('finds valid references with their original offsets', () => {
    const first = '|||@' + ID_A + '|||';
    const second = '|||@' + ID_B + '|||';
    const text = 'before ' + first + ' middle ' + second + ' after';
    assert.deepEqual(findFileReferenceMatches(text), [first, second].map(raw => ({
        raw,
        start: text.indexOf(raw),
        end: text.indexOf(raw) + raw.length,
    })));
});

test('ignores malformed references and obsolete full references', () => {
    for (const raw of [
        '|||@abc|||',
        '|||!550e8400-e29b-41d4-a716-446655440000|||',
        '||||@abcdefghijkl|||',
        '|||@abcdefghijkl||||',
        '|||@abc\ndefghijkl|||',
    ]) {
        assert.deepEqual(findFileReferenceMatches(raw), [], raw);
    }
});
