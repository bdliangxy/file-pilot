import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
import {
    makeFileRecord,
    makeScannedFolder,
} from '../factories/file-record.mjs';

const jiti = createJiti(import.meta.url);
const { buildPortalTree, renderPortalTree } = await jiti.import(
    '../../src/utils/portal-tree-utils.ts',
);

function makeFolderRecord(id, path, options = {}) {
    return {
        ...makeScannedFolder(path),
        id,
        status: options.status ?? 'available',
        shadowNotePath: `ShadowNotes/${id}.md`,
    };
}

function snapshot(node) {
    return {
        name: node.name,
        path: node.path,
        kind: node.kind,
        recordId: node.record?.id ?? null,
        children: node.children.map(snapshot),
    };
}

test('returns a virtual root for an empty record list', () => {
    const tree = buildPortalTree([], 'MyProject');

    assert.deepEqual(snapshot(tree), {
        name: 'MyProject',
        path: '',
        kind: 'folder',
        recordId: null,
        children: [],
    });
});

test('builds nested folders and files with folders sorted first', () => {
    const records = [
        makeFileRecord('readme', { path: 'README.md' }),
        makeFileRecord('zeta', { path: 'Documents/zeta.pdf' }),
        makeFolderRecord('images', 'Images'),
        makeFileRecord('alpha', { path: 'Documents/alpha.pdf' }),
        makeFolderRecord('documents', 'Documents'),
        makeFileRecord('logo', { path: 'Images/logo.png' }),
    ];

    const tree = buildPortalTree(records, 'Project');

    assert.deepEqual(tree.children.map(node => node.name), [
        'Documents', 'Images', 'README.md',
    ]);
    assert.deepEqual(
        tree.children[0].children.map(node => node.name),
        ['alpha.pdf', 'zeta.pdf'],
    );
    assert.deepEqual(
        tree.children[1].children.map(node => node.name),
        ['logo.png'],
    );
    assert.strictEqual(tree.children[0].record, records[4]);
    assert.strictEqual(tree.children[0].children[0].record, records[3]);
    assert.strictEqual(tree.children[2].record, records[0]);
});

test('attaches a folder record after its child has created the folder', () => {
    const child = makeFileRecord('report', {
        path: 'Projects/Reports/report.pdf',
    });
    const reports = makeFolderRecord('reports', 'Projects/Reports');
    const projects = makeFolderRecord('projects', 'Projects');

    const tree = buildPortalTree([child, reports, projects], 'Project');
    const projectsNode = tree.children[0];
    const reportsNode = projectsNode.children[0];

    assert.equal(tree.children.length, 1);
    assert.strictEqual(projectsNode.record, projects);
    assert.equal(projectsNode.children.length, 1);
    assert.strictEqual(reportsNode.record, reports);
    assert.strictEqual(reportsNode.children[0].record, child);
});

test('preserves empty folders, including nested empty folders', () => {
    const parent = makeFolderRecord('empty', 'Empty');
    const nested = makeFolderRecord('nested', 'Empty/Nested');

    const tree = buildPortalTree([nested, parent], 'Project');

    assert.strictEqual(tree.children[0].record, parent);
    assert.strictEqual(tree.children[0].children[0].record, nested);
    assert.deepEqual(tree.children[0].children[0].children, []);
});

test('creates implicit parent folders without inventing FileRecords', () => {
    const file = makeFileRecord('report', {
        path: 'Projects/2026/report.pdf',
    });

    const tree = buildPortalTree([file], 'Project');
    const projects = tree.children[0];
    const year = projects.children[0];

    assert.deepEqual(
        [projects.path, year.path, year.children[0].path],
        ['Projects', 'Projects/2026', 'Projects/2026/report.pdf'],
    );
    assert.equal(projects.kind, 'folder');
    assert.equal(year.kind, 'folder');
    assert.equal(projects.record, null);
    assert.equal(year.record, null);
    assert.strictEqual(year.children[0].record, file);
});

test('keeps same-named files under their respective parent folders', () => {
    const alpha = makeFileRecord('a', { path: 'Alpha/report.pdf' });
    const beta = makeFileRecord('b', { path: 'Beta/report.pdf' });

    const tree = buildPortalTree([beta, alpha], 'Project');

    assert.deepEqual(tree.children.map(node => node.path), ['Alpha', 'Beta']);
    assert.strictEqual(tree.children[0].children[0].record, alpha);
    assert.strictEqual(tree.children[1].children[0].record, beta);
});

test('preserves missing file and folder records in the tree', () => {
    const folder = makeFolderRecord('old-folder', 'Archive', {
        status: 'missing',
    });
    const file = makeFileRecord('old-file', {
        path: 'Archive/old.pdf',
        status: 'missing',
    });

    const tree = buildPortalTree([file, folder], 'Project');

    assert.strictEqual(tree.children[0].record, folder);
    assert.strictEqual(tree.children[0].children[0].record, file);
    assert.equal(tree.children[0].record.status, 'missing');
    assert.equal(tree.children[0].children[0].record.status, 'missing');
});

test('produces the same tree regardless of FileRecord input order', () => {
    const records = [
        makeFileRecord('readme', { path: 'README.md' }),
        makeFileRecord('plan', { path: 'Docs/plan.docx' }),
        makeFolderRecord('images', 'Images'),
        makeFolderRecord('docs', 'Docs'),
        makeFileRecord('logo', { path: 'Images/logo.png' }),
    ];

    const forward = snapshot(buildPortalTree(records, 'Project'));
    const reversed = snapshot(buildPortalTree([...records].reverse(), 'Project'));

    assert.deepEqual(reversed, forward);
});

test('does not mutate the input array or its FileRecords', () => {
    const folder = Object.freeze(makeFolderRecord('docs', 'Docs'));
    const file = Object.freeze(makeFileRecord('report', {
        path: 'Docs/report.pdf',
    }));
    const records = Object.freeze([file, folder]);
    const before = structuredClone(records);

    const tree = buildPortalTree(records, 'Project');

    assert.deepEqual(records, before);
    assert.strictEqual(tree.children[0].record, folder);
    assert.strictEqual(tree.children[0].children[0].record, file);
});

test('skips records whose relative path is empty', () => {
    const empty = makeFileRecord('invalid', { path: '' });
    const valid = makeFileRecord('valid', { path: 'notes.txt' });

    const tree = buildPortalTree([empty, valid], 'Project');

    assert.deepEqual(tree.children.map(node => node.path), ['notes.txt']);
});

function referenceFor(id) {
    return `|||@${id}|||`;
}

test('renders an empty tree with the native root separator', () => {
    const tree = buildPortalTree([], 'MyProject');

    assert.equal(renderPortalTree(tree, referenceFor), `MyProject${path.sep}`);
});

test('does not append a second root separator', () => {
    for (const separator of ['/', '\\']) {
        const tree = buildPortalTree([], `MyProject${separator}`);
        assert.equal(renderPortalTree(tree, referenceFor), `MyProject${separator}`);
    }
});

test('renders mixed multi-level branches and uses references for real records', () => {
    const records = [
        makeFileRecord('readme', { path: 'README.md' }),
        makeFileRecord('plan', { path: 'Documents/plan.docx' }),
        makeFileRecord('report', { path: 'Documents/report.pdf' }),
        makeFolderRecord('images', 'Images'),
        makeFolderRecord('documents', 'Documents'),
        makeFileRecord('logo', { path: 'Images/logo.png' }),
    ];
    const rendered = renderPortalTree(
        buildPortalTree(records, 'MyProject'),
        referenceFor,
    );

    assert.equal(rendered, [
        `MyProject${path.sep}`,
        '├── |||@documents|||',
        '│   ├── |||@plan|||',
        '│   └── |||@report|||',
        '├── |||@images|||',
        '│   └── |||@logo|||',
        '└── |||@readme|||',
    ].join('\n'));
});

test('formats a real folder only as a reference without an extra separator', () => {
    const folder = makeFolderRecord('docs', 'Documents');
    const formatReference = id => `|||!${id}|||`;

    const result = renderPortalTree(
        buildPortalTree([folder], 'Project'),
        formatReference,
    );

    assert.equal(result, [
        `Project${path.sep}`,
        '└── |||!docs|||',
    ].join('\n'));
    assert.equal(result.includes(`|||!docs|||${path.sep}`), false);
});

test('renders implicit parent folders with native separators and no fake references', () => {
    const file = makeFileRecord('report', {
        path: 'Projects/2026/report.pdf',
    });
    const calls = [];
    const rendered = renderPortalTree(
        buildPortalTree([file], 'Project'),
        id => {
            calls.push(id);
            return referenceFor(id);
        },
    );

    assert.equal(rendered, [
        `Project${path.sep}`,
        `└── Projects${path.sep}`,
        `    └── 2026${path.sep}`,
        '        └── |||@report|||',
    ].join('\n'));
    assert.deepEqual(calls, ['report']);
});

test('renders an empty real folder as a single reference line', () => {
    const folder = makeFolderRecord('empty-folder', 'Empty');

    assert.equal(
        renderPortalTree(buildPortalTree([folder], 'Project'), referenceFor),
        [`Project${path.sep}`, '└── |||@empty-folder|||'].join('\n'),
    );
});

test('renders missing records using the same reference formatter', () => {
    const missing = makeFileRecord('missing', {
        path: 'old.pdf',
        status: 'missing',
    });
    const rendered = renderPortalTree(
        buildPortalTree([missing], 'Project'),
        referenceFor,
    );

    assert.equal(rendered, [
        `Project${path.sep}`,
        '└── |||@missing|||',
    ].join('\n'));
});

test('propagates a structured error when formatting returns null', () => {
    const file = makeFileRecord('missing-index', {
        path: 'Docs/report.pdf',
    });
    const tree = buildPortalTree([file], 'Project');

    assert.throws(
        () => renderPortalTree(tree, () => null),
        error => error.name === 'FilePilotError'
            && error.code === 'FILE_REFERENCE_NOT_FOUND'
            && error.message.includes('Docs/report.pdf'),
    );
});

test('propagates an exception thrown by the reference formatter', () => {
    const file = makeFileRecord('broken', { path: 'broken.pdf' });
    const failure = new Error('reference index unavailable');

    assert.throws(
        () => renderPortalTree(buildPortalTree([file], 'Project'), () => {
            throw failure;
        }),
        error => error === failure,
    );
});

test('renders deterministically regardless of input order', () => {
    const records = [
        makeFileRecord('a', { path: 'Docs/a.pdf' }),
        makeFolderRecord('docs', 'Docs'),
        makeFileRecord('b', { path: 'Docs/b.pdf' }),
        makeFileRecord('readme', { path: 'README.md' }),
    ];

    const forward = renderPortalTree(
        buildPortalTree(records, 'Project'),
        referenceFor,
    );
    const reverse = renderPortalTree(
        buildPortalTree([...records].reverse(), 'Project'),
        referenceFor,
    );

    assert.equal(reverse, forward);
});
