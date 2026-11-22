import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
// Test-only YAML support is provided by the installed dependency tree.
// eslint-disable-next-line import/no-extraneous-dependencies -- Test-only YAML parser is transitively installed.
import YAML from 'yaml';
import {
    makeFileRecord,
    makeScannedFolder,
} from '../factories/file-record.mjs';
import {
    TFile,
    getFrontMatterInfo,
    parseYaml,
    stringifyYaml,
} from '../fakes/file-graph-obsidian.mjs';

const fakePath = fileURLToPath(
    new URL('../fakes/file-graph-obsidian.mjs', import.meta.url),
);
const jiti = createJiti(import.meta.url, {
    alias: { obsidian: fakePath },
});
const { FileGraphService } = await jiti.import(
    '../../src/core/file-graph-service.ts',
);
const { buildPortalTree } = await jiti.import(
    '../../src/utils/portal-tree-utils.ts',
);
const { FilePilotError } = await jiti.import('../../src/error.ts');

function makeFolder(id, path, extra = {}) {
    return {
        ...makeScannedFolder(path),
        id,
        status: 'available',
        shadowNotePath: `ShadowNotes/${id}.md`,
        ...extra,
    };
}

function createFixture({
    records = [],
    projectName = 'Project',
    portalContent = '---\ntitle: Project\n---\n\n# Overview\n',
    missingPaths = [],
    noteContents = {},
    clearing = false,
} = {}) {
    const contents = new Map();
    const entries = new Map();
    const writes = [];
    const linkCalls = [];
    const missing = new Set(missingPaths);

    function addFile(path, content) {
        if (missing.has(path)) return;
        entries.set(path, new TFile(path));
        contents.set(path, content);
    }

    addFile(`${projectName}.md`, portalContent);
    for (const record of records) {
        addFile(
            record.shadowNotePath,
            noteContents[record.shadowNotePath] ??
                `---\nfile-id: "${record.id}"\ntags:\n  - preserved\n---\n\n## File Summary\n\nKeep summary.\n`,
        );
    }

    const app = {
        vault: {
            getAbstractFileByPath: path => entries.get(path) ?? null,
            getFileByPath: path => entries.get(path) ?? null,
            read: async file => contents.get(file.path),
        },
        metadataCache: {
            fileToLinktext(file, sourcePath, omitMdExtension) {
                linkCalls.push({ file, sourcePath, omitMdExtension });
                return file.path.replace(/\.md$/, '');
            },
        },
        fileManager: {
            async processFrontMatter(file, callback) {
                const previous = contents.get(file.path);
                const info = getFrontMatterInfo(previous);
                const original = info.exists ? parseYaml(info.frontmatter) : {};
                const frontmatter = original ?? {};
                callback(frontmatter);
                const body = info.exists
                    ? previous.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
                    : previous;
                contents.set(
                    file.path,
                    `---\n${stringifyYaml(frontmatter)}---\n${body}`,
                );
                writes.push(file.path);
            },
        },
    };
    const stateService = {
        isClearingData: clearing,
        getProjectName: () => projectName,
        getFileRecords() {
            throw new Error('Graph service must not reload FileRecords');
        },
    };
    const service = new FileGraphService(app, stateService);
    const tree = buildPortalTree(records, projectName);

    function properties(path) {
        const content = contents.get(path);
        const info = getFrontMatterInfo(content);
        return info.exists ? YAML.parse(info.frontmatter) : {};
    }

    return { app, service, tree, contents, entries, writes, linkCalls, properties, stateService };
}

test('writes the portal root and direct child relationships, including empty folders', async () => {
    const records = [
        makeFileRecord('report', { path: 'Docs/report.pdf', shadowNotePath: 'ShadowNotes/report.md' }),
        makeFolder('docs', 'Docs'),
        makeFolder('empty', 'Empty'),
        makeFileRecord('readme', { path: 'README.md', shadowNotePath: 'ShadowNotes/readme.md' }),
    ];
    const f = createFixture({ records });

    const result = await f.service.syncLocationGraph(f.tree);

    assert.deepEqual(result, { updatedNoteCount: 5, unchangedNoteCount: 0 });
    assert.deepEqual(f.properties('Project.md')['file-pilot-links'], [
        '[[ShadowNotes/docs]]',
        '[[ShadowNotes/empty]]',
        '[[ShadowNotes/readme]]',
    ]);
    assert.deepEqual(f.properties('ShadowNotes/docs.md')['file-pilot-links'], [
        '[[ShadowNotes/report]]',
    ]);
    assert.deepEqual(f.properties('ShadowNotes/empty.md')['file-pilot-links'], []);
    assert.deepEqual(f.properties('ShadowNotes/readme.md')['file-pilot-links'], []);
    assert.deepEqual(f.properties('ShadowNotes/report.md')['file-pilot-links'], []);
    assert.equal(f.properties('ShadowNotes/docs.md')['file-id'], 'docs');
    assert.deepEqual(f.properties('ShadowNotes/docs.md').tags, ['preserved']);
    assert.ok(f.contents.get('ShadowNotes/docs.md').includes('Keep summary.'));
    assert.ok(f.contents.get('Project.md').includes('# Overview'));
    assert.equal(f.linkCalls.every(call => call.omitMdExtension === true), true);
});

test('does not rewrite unchanged notes on repeated graph synchronization', async () => {
    const record = makeFileRecord('readme', {
        path: 'README.md',
        shadowNotePath: 'ShadowNotes/readme.md',
    });
    const f = createFixture({ records: [record] });

    await f.service.syncLocationGraph(f.tree);
    const firstWriteCount = f.writes.length;
    const original = new Map(f.contents);
    const second = await f.service.syncLocationGraph(f.tree);

    assert.deepEqual(second, { updatedNoteCount: 0, unchangedNoteCount: 2 });
    assert.equal(f.writes.length, firstWriteCount);
    assert.deepEqual(f.contents, original);
});

test('replaces stale links after a physical folder relationship changes', async () => {
    const folder = makeFolder('docs', 'Docs');
    const record = makeFileRecord('report', {
        path: 'Docs/report.pdf',
        shadowNotePath: 'ShadowNotes/report.md',
    });
    const f = createFixture({ records: [folder, record] });
    await f.service.syncLocationGraph(f.tree);

    const moved = { ...record, path: 'report.pdf' };
    const updatedTree = buildPortalTree([folder, moved], 'Project');
    const changed = await f.service.syncLocationGraph(updatedTree);

    assert.deepEqual(changed, { updatedNoteCount: 2, unchangedNoteCount: 1 });
    assert.deepEqual(f.properties('Project.md')['file-pilot-links'], [
        '[[ShadowNotes/docs]]',
        '[[ShadowNotes/report]]',
    ]);
    assert.deepEqual(f.properties('ShadowNotes/docs.md')['file-pilot-links'], []);
});

test('missing Shadow Note throws before any properties are changed', async () => {
    const record = makeFileRecord('report', {
        path: 'report.pdf',
        shadowNotePath: 'ShadowNotes/report.md',
    });
    const f = createFixture({
        records: [record],
        missingPaths: ['ShadowNotes/report.md'],
    });
    const previous = new Map(f.contents);

    await assert.rejects(
        f.service.syncLocationGraph(f.tree),
        error => error instanceof FilePilotError
            && error.code === 'SHADOW_NOTE_NOT_FOUND',
    );
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.contents, previous);
});

test('missing Portal Note throws a structured error', async () => {
    const f = createFixture({ missingPaths: ['Project.md'] });
    await assert.rejects(
        f.service.syncLocationGraph(f.tree),
        error => error instanceof FilePilotError
            && error.code === 'PORTAL_NOTE_NOT_FOUND',
    );
    assert.deepEqual(f.writes, []);
});

test('invalid Portal Note YAML rejects with FilePilotError', async () => {
    const f = createFixture({
        portalContent: '---\nvalue: [\n---\n\n# Overview\n',
    });
    await assert.rejects(
        f.service.syncLocationGraph(f.tree),
        error => error instanceof FilePilotError
            && error.code === 'FILE_GRAPH_FRONTMATTER_INVALID',
    );
    assert.deepEqual(f.writes, []);
});

test('a scalar frontmatter value is rejected instead of replacing it', async () => {
    const f = createFixture({ portalContent: '---\nhello\n---\n' });
    await assert.rejects(
        f.service.syncLocationGraph(f.tree),
        error => error instanceof FilePilotError
            && error.code === 'FILE_GRAPH_FRONTMATTER_INVALID',
    );
});

test('graph synchronization of an empty tree writes an empty root links property', async () => {
    const f = createFixture();
    const result = await f.service.syncLocationGraph(f.tree);
    assert.deepEqual(result, { updatedNoteCount: 1, unchangedNoteCount: 0 });
    assert.deepEqual(f.properties('Project.md')['file-pilot-links'], []);
});

test('data clearing prevents graph writes', async () => {
    const f = createFixture({ clearing: true });
    await assert.rejects(
        f.service.syncLocationGraph(f.tree),
        error => error instanceof FilePilotError
            && error.code === 'CLEAR_IN_PROGRESS',
    );
    assert.deepEqual(f.writes, []);
});
