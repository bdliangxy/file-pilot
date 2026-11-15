import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { makeFileRecord } from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { FileSortRule, sortFileRecords } = await jiti.import(
    '../../src/utils/file-sort-utils.ts',
);

const records = [
    makeFileRecord('a', { path: 'z/archive-report.pdf' }),
    makeFileRecord('b', { path: 'b/report-other.pdf' }),
    makeFileRecord('c', { path: 'a/report.pdf' }),
];

test('filename prefix takes priority over path, and path breaks ties', () => {
    const result = sortFileRecords(records, [
        FileSortRule.NAME_PREFIX_FIRST,
        FileSortRule.PATH_ASC,
    ], { query: 'report' });
    assert.deepEqual(result.map(item => item.path), [
        'a/report.pdf', 'b/report-other.pdf', 'z/archive-report.pdf',
    ]);
});

test('rule priority is controlled by the caller', () => {
    const result = sortFileRecords(records, [
        FileSortRule.PATH_ASC,
        FileSortRule.NAME_PREFIX_FIRST,
    ], { query: 'report' });
    assert.deepEqual(result.map(item => item.path), [
        'a/report.pdf', 'b/report-other.pdf', 'z/archive-report.pdf',
    ]);
    const reversed = sortFileRecords([
        makeFileRecord('d', { path: 'a/archive-report.pdf' }),
        makeFileRecord('e', { path: 'z/report.pdf' }),
    ], [FileSortRule.PATH_ASC, FileSortRule.NAME_PREFIX_FIRST], { query: 'report' });
    assert.deepEqual(reversed.map(item => item.path), [
        'a/archive-report.pdf', 'z/report.pdf',
    ]);
});

test('empty query leaves prefix comparison neutral', () => {
    const result = sortFileRecords(records, [
        FileSortRule.NAME_PREFIX_FIRST,
        FileSortRule.PATH_ASC,
    ]);
    assert.deepEqual(result.map(item => item.path), [
        'a/report.pdf', 'b/report-other.pdf', 'z/archive-report.pdf',
    ]);
});

test('sorting never mutates records or the input array', () => {
    const frozenRecords = Object.freeze(records.map(item => Object.freeze({ ...item })));
    const result = sortFileRecords(frozenRecords, [FileSortRule.PATH_ASC]);
    assert.notStrictEqual(result, frozenRecords);
    assert.equal(frozenRecords[0].path, 'z/archive-report.pdf');
    assert.equal(result[0].path, 'a/report.pdf');
});

