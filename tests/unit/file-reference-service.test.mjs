import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { makeFileRecord } from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { FileReferenceService } = await jiti.import(
    '../../src/core/file-reference-service.ts',
);

const ID_A = 'Ab7Xc9Km2LdQ';
const ID_B = 'Zk3Mr6Tn8PwV';
const fileRef = id => '|||@' + id + '|||';

test('resolves FileRecords by their exact IDs', () => {
    const first = makeFileRecord(ID_A);
    const second = makeFileRecord(ID_B, { path: 'assets/image.png' });
    const service = new FileReferenceService();
    service.rebuildReferenceIndex([first, second]);

    assert.strictEqual(service.resolveFileId(ID_A), first);
    assert.strictEqual(service.resolveFileId(ID_B), second);
    assert.deepEqual(service.resolveFileReference(fileRef(ID_A)), {
        kind: 'found', record: first,
    });
    assert.deepEqual(service.resolveFileReference(fileRef(ID_B)), {
        kind: 'found', record: second,
    });
});

test('resolves distinct IDs that differ only in case', () => {
    const first = makeFileRecord(ID_A);
    const second = makeFileRecord(ID_A.toLowerCase(), { path: 'other.pdf' });
    const service = new FileReferenceService();
    service.rebuildReferenceIndex([first, second]);

    assert.strictEqual(service.resolveFileId(first.id), first);
    assert.strictEqual(service.resolveFileId(second.id), second);
    for (const record of [first, second]) {
        assert.equal(service.formatFileReference(record.id), fileRef(record.id));
        assert.strictEqual(service.resolveFileReference(fileRef(record.id)).record, record);
    }
    assert.equal(service.resolveFileId(ID_A.toUpperCase()), undefined);
    assert.equal(service.formatFileReference(ID_A.toUpperCase()), null);
    assert.deepEqual(service.resolveFileReference(fileRef(ID_A.toUpperCase())), { kind: 'missing' });
});

test('formats references only for currently indexed records', () => {
    const service = new FileReferenceService();
    assert.equal(service.formatFileReference(ID_A), null);
    service.rebuildReferenceIndex([makeFileRecord(ID_A)]);
    assert.equal(service.formatFileReference(ID_A), fileRef(ID_A));
    assert.equal(service.formatFileReference(ID_B), null);
});

test('rebuilding removes stale records and clears the index', () => {
    const first = makeFileRecord(ID_A);
    const replacement = makeFileRecord(ID_B);
    const service = new FileReferenceService();
    service.rebuildReferenceIndex([first]);
    service.rebuildReferenceIndex([replacement]);

    assert.equal(service.resolveFileId(ID_A), undefined);
    assert.equal(service.formatFileReference(ID_A), null);
    assert.deepEqual(service.resolveFileReference(fileRef(ID_A)), { kind: 'missing' });
    assert.strictEqual(service.resolveFileId(ID_B), replacement);
    service.rebuildReferenceIndex([]);
    assert.equal(service.resolveFileId(ID_B), undefined);
    assert.equal(service.formatFileReference(ID_B), null);
});

test('rebuilding reflects changed metadata without changing the reference', () => {
    const original = makeFileRecord(ID_A, { path: 'docs/original.pdf' });
    const updated = makeFileRecord(ID_A, { path: 'docs/renamed.pdf', status: 'missing' });
    const service = new FileReferenceService();

    service.rebuildReferenceIndex([original]);
    const reference = service.formatFileReference(ID_A);
    service.rebuildReferenceIndex([updated]);

    assert.equal(service.formatFileReference(ID_A), reference);
    assert.strictEqual(service.resolveFileId(ID_A), updated);
    assert.deepEqual(service.resolveFileReference(reference), { kind: 'found', record: updated });
});

test('rebuilding does not modify the input array or records', () => {
    const record = Object.freeze(makeFileRecord(ID_A));
    const records = Object.freeze([record]);
    const service = new FileReferenceService();

    assert.doesNotThrow(() => service.rebuildReferenceIndex(records));
    assert.strictEqual(service.resolveFileId(ID_A), record);
});

test('resolves complete references with surrounding whitespace', () => {
    const record = makeFileRecord(ID_A);
    const service = new FileReferenceService();
    service.rebuildReferenceIndex([record]);

    for (const text of [fileRef(ID_A), '  ' + fileRef(ID_A) + '  ']) {
        assert.deepEqual(service.resolveFileReference(text), { kind: 'found', record });
    }
});

test('returns invalid for malformed and obsolete references', () => {
    const service = new FileReferenceService();
    for (const text of [
        '', 'invalid', '|||@abc|||', '|||!invalid|||',
        '|||!550e8400-e29b-41d4-a716-446655440000|||',
        '|||@abcdefghijkl||', 'text |||@abcdefghijkl||| text',
    ]) {
        assert.deepEqual(service.resolveFileReference(text), { kind: 'invalid' });
    }
});

test('returns missing for valid but unknown references', () => {
    const service = new FileReferenceService();
    assert.deepEqual(service.resolveFileReference(fileRef(ID_A)), { kind: 'missing' });
    service.rebuildReferenceIndex([makeFileRecord(ID_B)]);
    assert.deepEqual(service.resolveFileReference(fileRef(ID_A)), { kind: 'missing' });
    assert.equal(service.resolveFileId(ID_A), undefined);
});

test('index change listeners observe the published index', () => {
    const service = new FileReferenceService();
    const first = makeFileRecord(ID_A, { path: 'docs/old.pdf' });
    const updated = makeFileRecord(ID_A, { path: 'docs/new.pdf' });
    const snapshots = [];
    const unsubscribe = service.onIndexChanged(() => {
        snapshots.push({
            record: service.resolveFileId(ID_A),
            reference: service.formatFileReference(ID_A),
            lookup: service.resolveFileReference(fileRef(ID_A)),
        });
    });

    service.rebuildReferenceIndex([first]);
    service.rebuildReferenceIndex([updated]);
    service.rebuildReferenceIndex([]);

    assert.deepEqual(snapshots, [
        { record: first, reference: fileRef(ID_A), lookup: { kind: 'found', record: first } },
        { record: updated, reference: fileRef(ID_A), lookup: { kind: 'found', record: updated } },
        { record: undefined, reference: null, lookup: { kind: 'missing' } },
    ]);

    unsubscribe();
});

test('index listeners unsubscribe independently without affecting other listeners', () => {
    const service = new FileReferenceService();
    const calls = [];
    const stopFirst = service.onIndexChanged(() => calls.push('first'));
    const stopSecond = service.onIndexChanged(() => calls.push('second'));

    service.rebuildReferenceIndex([makeFileRecord(ID_A)]);
    stopFirst();
    stopFirst();
    service.rebuildReferenceIndex([]);
    stopSecond();
    service.rebuildReferenceIndex([makeFileRecord(ID_B)]);

    assert.deepEqual(calls, ['first', 'second', 'second']);
});

test('rejects duplicate IDs without replacing the current index', () => {
    const service = new FileReferenceService();
    const original = makeFileRecord(ID_A);
    service.rebuildReferenceIndex([original]);

    let notifications = 0;
    const unsubscribe = service.onIndexChanged(() => {
        notifications++;
    });

    const first = makeFileRecord(ID_B, { path: 'first.pdf' });
    const duplicate = makeFileRecord(ID_B, { path: 'second.pdf' });

    assert.throws(
        () => service.rebuildReferenceIndex([first, duplicate]),
        /Duplicate FileRecord ID/,
    );
    assert.strictEqual(service.resolveFileId(ID_A), original);
    assert.equal(service.formatFileReference(ID_A), fileRef(ID_A));
    assert.equal(service.resolveFileId(ID_B), undefined);
    assert.equal(service.formatFileReference(ID_B), null);
    assert.equal(notifications, 0);

    unsubscribe();
});
