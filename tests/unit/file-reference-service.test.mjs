import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { makeFileRecord } from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { FileReferenceService } = await jiti.import(
    '../../src/core/file-reference-service.ts',
);
const { generateShortKey } = await jiti.import(
    '../../src/utils/file-reference-utils.ts',
);

const ID_A = '550e8400-e29b-41d4-a716-446655440000';
const ID_B = '6fa459ea-ee8a-3ca4-894e-db77e160355e';

test('resolves short keys to the correct FileRecord references', () => {
    const first = makeFileRecord(ID_A, { path: 'docs/report.pdf' });
    const second = makeFileRecord(ID_B, { path: 'assets/image.png' });
    const service = new FileReferenceService();

    service.rebuildReferenceIndex([first, second]);

    assert.deepEqual(service.resolveShortKey(generateShortKey(ID_A)), {
        kind: 'found',
        record: first,
    });
    assert.deepEqual(service.resolveShortKey(generateShortKey(ID_B)), {
        kind: 'found',
        record: second,
    });
    assert.strictEqual(service.resolveShortKey(generateShortKey(ID_A)).record, first);
});

test('resolves full UUIDs without case sensitivity', () => {
    const record = makeFileRecord(ID_A);
    const service = new FileReferenceService();

    service.rebuildReferenceIndex([record]);

    assert.strictEqual(service.resolveFileId(ID_A), record);
    assert.strictEqual(service.resolveFileId(ID_A.toUpperCase()), record);
});

test('returns missing for unknown keys and undefined for unknown UUIDs', () => {
    const service = new FileReferenceService();

    assert.deepEqual(service.resolveShortKey(generateShortKey(ID_A)), {
        kind: 'missing',
    });
    assert.equal(service.resolveFileId(ID_A), undefined);

    service.rebuildReferenceIndex([makeFileRecord(ID_B)]);

    assert.deepEqual(service.resolveShortKey(generateShortKey(ID_A)), {
        kind: 'missing',
    });
    assert.equal(service.resolveFileId(ID_A), undefined);
});

test('marks colliding short keys as ambiguous regardless of record order', () => {
    // Repeated IDs are intentionally used to exercise the collision branch.
    // Persisted FileRecords must have unique UUIDs.
    const first = makeFileRecord(ID_A, { path: 'docs/first.pdf' });
    const second = makeFileRecord(ID_A.toUpperCase(), { path: 'docs/second.pdf' });
    const third = makeFileRecord(ID_A, { path: 'docs/third.pdf' });
    const service = new FileReferenceService();
    const key = generateShortKey(ID_A);

    for (const records of [[first, second], [second, first], [first, second, third]]) {
        service.rebuildReferenceIndex(records);
        assert.deepEqual(service.resolveShortKey(key), { kind: 'ambiguous' });
    }
});

test('rebuilding clears stale records and restores previously ambiguous keys', () => {
    const first = makeFileRecord(ID_A);
    const duplicate = makeFileRecord(ID_A, { path: 'docs/duplicate.pdf' });
    const replacement = makeFileRecord(ID_B);
    const service = new FileReferenceService();

    service.rebuildReferenceIndex([first, duplicate]);
    assert.deepEqual(service.resolveShortKey(generateShortKey(ID_A)), {
        kind: 'ambiguous',
    });

    service.rebuildReferenceIndex([replacement]);
    assert.equal(service.resolveFileId(ID_A), undefined);
    assert.deepEqual(service.resolveShortKey(generateShortKey(ID_A)), {
        kind: 'missing',
    });
    assert.strictEqual(service.resolveFileId(ID_B), replacement);

    service.rebuildReferenceIndex([first]);
    assert.deepEqual(service.resolveShortKey(generateShortKey(ID_A)), {
        kind: 'found',
        record: first,
    });
});

test('rebuilding reflects changed record metadata without changing its short key', () => {
    const original = makeFileRecord(ID_A, {
        path: 'docs/original.pdf',
        status: 'available',
    });
    const updated = makeFileRecord(ID_A, {
        path: 'docs/renamed.pdf',
        status: 'missing',
    });
    const service = new FileReferenceService();
    const key = generateShortKey(ID_A);

    service.rebuildReferenceIndex([original]);
    service.rebuildReferenceIndex([updated]);

    assert.strictEqual(service.resolveFileId(ID_A), updated);
    assert.deepEqual(service.resolveShortKey(key), {
        kind: 'found',
        record: updated,
    });
});

test('rebuilding does not modify the input array or records', () => {
    const record = Object.freeze(makeFileRecord(ID_A));
    const records = Object.freeze([record]);
    const service = new FileReferenceService();

    assert.doesNotThrow(() => service.rebuildReferenceIndex(records));
    assert.strictEqual(service.resolveFileId(ID_A), record);
});

test('resolves complete short and full references', () => {
    const record = makeFileRecord(ID_A);
    const service = new FileReferenceService();
    service.rebuildReferenceIndex([record]);

    const shortKey = generateShortKey(ID_A);
    for (const text of [
        `|||@${shortKey}|||`,
        ` |||@${shortKey}||| `,
        `|||!${ID_A}|||`,
        `  |||!${ID_A.toUpperCase()}|||  `,
    ]) {
        assert.deepEqual(
            service.resolveFileReference(text),
            { kind: 'found', record },
        );
    }
});

test('returns invalid for malformed references', () => {
    const service = new FileReferenceService();
    const invalidReferences = [
        '',
        'invalid',
        '|||@abc|||',
        '|||!invalid|||',
        '|||@abcdefghijkl||',
        'text |||@abcdefghijkl||| text',
    ];

    for (const text of invalidReferences) {
        assert.deepEqual(
            service.resolveFileReference(text),
            { kind: 'invalid' },
        );
    }
});

test('returns missing for valid but unknown references', () => {
    const service = new FileReferenceService();
    service.rebuildReferenceIndex([makeFileRecord(ID_B)]);

    assert.deepEqual(
        service.resolveFileReference(`|||@${generateShortKey(ID_A)}|||`),
        { kind: 'missing' },
    );
    assert.deepEqual(
        service.resolveFileReference(`|||!${ID_A}|||`),
        { kind: 'missing' },
    );
});

test('returns ambiguous for colliding short references', () => {
    // Repeated UUIDs are only used here to force an ambiguous lookup.
    const first = makeFileRecord(ID_A);
    const second = makeFileRecord(ID_A, { path: 'docs/another.pdf' });
    const service = new FileReferenceService();
    service.rebuildReferenceIndex([first, second]);

    assert.deepEqual(
        service.resolveFileReference(`|||@${generateShortKey(ID_A)}|||`),
        { kind: 'ambiguous' },
    );
});
