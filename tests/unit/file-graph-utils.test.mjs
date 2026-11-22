import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import {
    makeFileRecord,
    makeScannedFolder,
} from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { buildPortalTree } = await jiti.import(
    '../../src/utils/portal-tree-utils.ts',
);
const { collectPortalTreeRelations } = await jiti.import(
    '../../src/utils/file-graph-utils.ts',
);
const { FilePilotError } = await jiti.import('../../src/error.ts');

function makeFolderRecord(id, path, options = {}) {
    return {
        ...makeScannedFolder(path),
        id,
        status: options.status ?? 'available',
        shadowNotePath: options.shadowNotePath ?? `ShadowNotes/${id}.md`,
    };
}

function relationIds(relations) {
    return relations.map(({ parentRecordId, childRecord }) => [
        parentRecordId,
        childRecord.id,
    ]);
}

test('returns no relationships for an empty portal tree', () => {
    const tree = buildPortalTree([], 'Project');

    assert.deepEqual(collectPortalTreeRelations(tree), []);
    assert.equal(tree.record, null);
});

test('connects top-level records to the virtual Portal Note root', () => {
    const folder = makeFolderRecord('folder', 'Documents');
    const file = makeFileRecord('readme', { path: 'README.md' });

    const relations = collectPortalTreeRelations(
        buildPortalTree([file, folder], 'Project'),
    );

    assert.deepEqual(relationIds(relations), [
        [null, 'folder'],
        [null, 'readme'],
    ]);
    assert.strictEqual(relations[0].childRecord, folder);
    assert.strictEqual(relations[1].childRecord, file);
});

test('collects nested file and folder relationships in tree order', () => {
    const records = [
        makeFileRecord('report', { path: 'Documents/report.pdf' }),
        makeFolderRecord('images', 'Documents/Images'),
        makeFileRecord('logo', { path: 'Documents/Images/logo.png' }),
        makeFolderRecord('documents', 'Documents'),
        makeFileRecord('readme', { path: 'README.md' }),
    ];

    const relations = collectPortalTreeRelations(
        buildPortalTree(records, 'Project'),
    );

    assert.deepEqual(relationIds(relations), [
        [null, 'documents'],
        ['documents', 'images'],
        ['images', 'logo'],
        ['documents', 'report'],
        [null, 'readme'],
    ]);
});

test('includes empty folders as nodes and preserves their parent links', () => {
    const records = [
        makeFolderRecord('nested', 'Empty/Nested'),
        makeFolderRecord('empty', 'Empty'),
        makeFolderRecord('top-empty', 'StandaloneEmpty'),
    ];

    const relations = collectPortalTreeRelations(
        buildPortalTree(records, 'Project'),
    );

    assert.deepEqual(relationIds(relations), [
        [null, 'empty'],
        ['empty', 'nested'],
        [null, 'top-empty'],
    ]);
    assert.equal(relations.length, records.length);
});

test('accepts folder FileRecords added after child records', () => {
    const file = makeFileRecord('report', {
        path: 'Projects/Reports/report.pdf',
    });
    const reports = makeFolderRecord('reports', 'Projects/Reports');
    const projects = makeFolderRecord('projects', 'Projects');

    const relations = collectPortalTreeRelations(
        buildPortalTree([file, reports, projects], 'Project'),
    );

    assert.deepEqual(relationIds(relations), [
        [null, 'projects'],
        ['projects', 'reports'],
        ['reports', 'report'],
    ]);
});

test('keeps separate same-named files linked to their own parents', () => {
    const records = [
        makeFileRecord('beta-report', { path: 'Beta/report.pdf' }),
        makeFolderRecord('beta', 'Beta'),
        makeFolderRecord('alpha', 'Alpha'),
        makeFileRecord('alpha-report', { path: 'Alpha/report.pdf' }),
    ];

    const relations = collectPortalTreeRelations(
        buildPortalTree(records, 'Project'),
    );

    assert.deepEqual(relationIds(relations), [
        [null, 'alpha'],
        ['alpha', 'alpha-report'],
        [null, 'beta'],
        ['beta', 'beta-report'],
    ]);
});

test('preserves missing FileRecords in extracted relationships', () => {
    const folder = makeFolderRecord('archive', 'Archive', {
        status: 'missing',
    });
    const file = makeFileRecord('old', {
        path: 'Archive/old.pdf',
        status: 'missing',
    });

    const relations = collectPortalTreeRelations(
        buildPortalTree([file, folder], 'Project'),
    );

    assert.deepEqual(relationIds(relations), [
        [null, 'archive'],
        ['archive', 'old'],
    ]);
    assert.strictEqual(relations[0].childRecord, folder);
    assert.strictEqual(relations[1].childRecord, file);
    assert.equal(relations[1].childRecord.status, 'missing');
});

test('returns deterministic relationships regardless of input order', () => {
    const records = [
        makeFolderRecord('documents', 'Documents'),
        makeFileRecord('zeta', { path: 'Documents/zeta.pdf' }),
        makeFileRecord('alpha', { path: 'Documents/alpha.pdf' }),
        makeFolderRecord('empty', 'Empty'),
    ];

    const forward = collectPortalTreeRelations(
        buildPortalTree(records, 'Project'),
    );
    const backward = collectPortalTreeRelations(
        buildPortalTree([...records].reverse(), 'Project'),
    );

    assert.deepEqual(relationIds(forward), relationIds(backward));
});

test('does not mutate the supplied portal tree or FileRecords', () => {
    const folder = Object.freeze(makeFolderRecord('docs', 'Docs'));
    const file = Object.freeze(makeFileRecord('report', {
        path: 'Docs/report.pdf',
    }));
    const tree = buildPortalTree([file, folder], 'Project');
    const before = structuredClone(tree);

    const relations = collectPortalTreeRelations(tree);

    assert.deepEqual(tree, before);
    assert.strictEqual(relations[0].childRecord, folder);
    assert.strictEqual(relations[1].childRecord, file);
});

test('throws FilePilotError when an implicit folder has no FileRecord', () => {
    const file = makeFileRecord('report', {
        path: 'Unmanaged/2026/report.pdf',
    });
    const tree = buildPortalTree([file], 'Project');

    assert.throws(
        () => collectPortalTreeRelations(tree),
        error => error instanceof FilePilotError
            && error.code === 'FILE_GRAPH_RECORD_MISSING'
            && error.message.includes('Unmanaged'),
    );
});

test('throws FilePilotError when a nested folder has no FileRecord', () => {
    const folder = makeFolderRecord('parent', 'Parent');
    const file = makeFileRecord('report', {
        path: 'Parent/Unmanaged/report.pdf',
    });
    const tree = buildPortalTree([file, folder], 'Project');

    assert.throws(
        () => collectPortalTreeRelations(tree),
        error => error instanceof FilePilotError
            && error.code === 'FILE_GRAPH_RECORD_MISSING'
            && error.message.includes('Parent/Unmanaged'),
    );
});
