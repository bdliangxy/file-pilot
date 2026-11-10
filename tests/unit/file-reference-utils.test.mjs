import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
    generateShortKey,
    parseFileReference,
} = await jiti.import(
    '../../src/utils/file-reference-utils.ts',
);

const ID_A = '550e8400-e29b-41d4-a716-446655440000';
const ID_B = '6fa459ea-ee8a-3ca4-894e-db77e160355e';

test('short key is deterministic and case-insensitive for UUIDs', () => {
    const key = generateShortKey(ID_A);

    assert.equal(generateShortKey(ID_A), key);
    assert.equal(generateShortKey(ID_A.toUpperCase()), key);
});

test('short key uses twelve Base64URL-safe characters', () => {
    for (const id of [ID_A, ID_B]) {
        assert.match(generateShortKey(id), /^[A-Za-z0-9_-]{12}$/);
    }
});

test('short key follows the documented SHA-256 Base64URL algorithm', () => {
    const expected = createHash('sha256')
        .update(ID_A, 'utf8')
        .digest('base64url')
        .slice(0, 12);

    assert.equal(generateShortKey(ID_A), expected);
    assert.equal(generateShortKey(ID_A), 'o6nh7ZcyyrKI');
});

test('different UUID inputs yield different keys for the test fixtures', () => {
    assert.notEqual(generateShortKey(ID_A), generateShortKey(ID_B));
});

test('parses short references and preserves key case', () => {
    const key = generateShortKey(ID_A);

    assert.deepEqual(
        parseFileReference(`|||@${key}|||`),
        { kind: 'short', key },
    );
    assert.deepEqual(
        parseFileReference(`  |||@${key}|||  `),
        { kind: 'short', key },
    );
    assert.deepEqual(
        parseFileReference('|||@AbCdEfGhIjK_|||'),
        { kind: 'short', key: 'AbCdEfGhIjK_' },
    );
});

test('parses full references and normalizes UUID case', () => {
    assert.deepEqual(
        parseFileReference(`|||!${ID_A.toUpperCase()}|||`),
        { kind: 'full', id: ID_A },
    );
    assert.deepEqual(
        parseFileReference(`\t|||!${ID_A}|||\n`),
        { kind: 'full', id: ID_A },
    );
});

test('rejects malformed file references', () => {
    const invalidReferences = [
        '',
        '|||@abc|||',
        '|||!invalid-uuid|||',
        '|||@abcdefghijkl||',
        '||| @abcdefghijkl |||',
        '|||@ abcdefghijkl|||',
        'text |||@abcdefghijkl||| text',
        '|||@abcdefghijkl||||||@abcdefghijkl|||',
        '|||@abcdefghijklmnop|||',
        '|||!550e8400e29b41d4a716446655440000|||',
    ];

    for (const text of invalidReferences) {
        assert.equal(parseFileReference(text), null, text);
    }
});
