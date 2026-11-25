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
    extraFiles = {},
    resolvedLinks = {},
    caches = {},
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

    for (const [path, content] of Object.entries(extraFiles)) {
        addFile(path, content);
    }

    const app = {
        vault: {
            getAbstractFileByPath: path => entries.get(path) ?? null,
            getFileByPath: path => entries.get(path) ?? null,
            read: async file => contents.get(file.path),
        },
        metadataCache: {
            resolvedLinks,
            getFileCache: file => caches[file.path] ?? null,
            getFirstLinkpathDest(linkpath) {
                const direct = entries.get(linkpath) ?? entries.get(`${linkpath}.md`);
                if (direct) return direct;
                const matches = [...entries.values()].filter(file =>
                    file.path.endsWith(`/${linkpath}`) ||
                    file.path.endsWith(`/${linkpath}.md`),
                );
                return matches.length === 1 ? matches[0] : null;
            },
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

test('queries native incoming and outgoing connections with independent link sources', () => {
    const f = createFixture({
        extraFiles: {
            'A.md': '', 'B.md': '', 'C.md': '', 'D.md': '', 'image.png': '',
        },
        resolvedLinks: {
            'A.md': { 'Project.md': 1 },
            'B.md': { 'Project.md': 1 },
            'Project.md': {
                'C.md': 3, 'D.md': 1, 'image.png': 1,
                'Project.md': 1, 'missing.md': 1,
            },
            'missing.md': { 'Project.md': 1 },
        },
        caches: {
            'A.md': {
                frontmatterLinks: [{
                    key: 'file-pilot-links.0', link: 'Project',
                    original: '[[Project | Alias ]]', displayText: 'Alias',
                }],
            },
            'B.md': { links: [{ link: 'Project#Intro' }] },
            'Project.md': {
                frontmatterLinks: [
                    { key: 'file-pilot-links.0', link: 'C' },
                    { key: 'file-pilot-links.1', link: 'C#Intro' },
                    { key: 'related.0', link: 'C' },
                    { key: 'file-pilot-links.custom', link: 'D' },
                    { key: 'file-pilot-links.0.name', link: 'D' },
                ],
                embeds: [{ link: 'image.png' }],
            },
        },
    });
    const connection = (path, filePilotLink, otherLink) => ({
        note: f.entries.get(path), filePilotLink, otherLink,
    });

    assert.deepEqual(f.service.getNodeConnections(f.entries.get('Project.md')), {
        incoming: [connection('A.md', true, false), connection('B.md', false, true)],
        outgoing: [
            connection('C.md', true, true),
            connection('D.md', false, true),
            connection('image.png', false, true),
        ],
    });
    assert.deepEqual(f.writes, []);
});

test('recognizes scalar property keys and falls back to read-only for unknown sources', () => {
    const f = createFixture({
        extraFiles: { 'A.md': '', 'B.md': '', 'C.md': '' },
        resolvedLinks: { 'Project.md': { 'A.md': 1, 'B.md': 1 } },
        caches: {
            'Project.md': { frontmatterLinks: [{ key: 'file-pilot-links', link: 'A' }] },
        },
    });
    assert.deepEqual(f.service.getNodeConnections(f.entries.get('Project.md')).outgoing, [
        { note: f.entries.get('A.md'), filePilotLink: true, otherLink: false },
        { note: f.entries.get('B.md'), filePilotLink: false, otherLink: true },
    ]);
    assert.deepEqual(f.service.getNodeConnections(f.entries.get('C.md')), {
        incoming: [], outgoing: [],
    });
});

test('adds a managed link to an ordinary note without changing its existing body or properties', async () => {
    const f = createFixture({
        extraFiles: {
            'A.md': '---\ntags: [keep]\nrelated: "[[Project]]"\n---\nSee [[Project]].\n',
        },
    });
    const source = f.entries.get('A.md');
    const target = f.entries.get('Project.md');

    assert.equal(await f.service.setNodeConnection(source, target, true), true);
    assert.deepEqual(f.properties(source.path), {
        tags: ['keep'], related: '[[Project]]', 'file-pilot-links': ['[[Project]]'],
    });
    assert.ok(f.contents.get(source.path).endsWith('See [[Project]].\n'));
    assert.equal(await f.service.setNodeConnection(source, target, true), false);
    assert.deepEqual(f.writes, [source.path]);
    assert.equal(await f.service.setNodeConnection(source, target, false), true);
    assert.equal(await f.service.setNodeConnection(source, target, false), false);
    assert.deepEqual(f.properties(source.path), {
        tags: ['keep'], related: '[[Project]]', 'file-pilot-links': [],
    });
    assert.ok(f.contents.get(source.path).endsWith('See [[Project]].\n'));
    assert.deepEqual(f.writes, [source.path, source.path]);
});

test('deduplicates and removes aliases and heading links while preserving unresolved values', async () => {
    const links = [
        '[[Project]]', '[[Project | Alias ]]', '[[Project#Intro]]',
        '[[Missing]]', 'plain text', '[[Other]]',
    ];
    const f = createFixture({
        portalContent: '# Project\n',
        extraFiles: {
            'A.md': `---\n${stringifyYaml({ 'file-pilot-links': links })}---\nSee [[Project]].\n`,
            'Other.md': '',
        },
    });
    const source = f.entries.get('A.md');
    const target = f.entries.get('Project.md');
    assert.equal(await f.service.setNodeConnection(source, target, true), false);
    assert.deepEqual(f.writes, []);
    assert.equal(await f.service.setNodeConnection(source, target, false), true);
    assert.deepEqual(f.properties(source.path)['file-pilot-links'], links.slice(3));
    assert.ok(f.contents.get(source.path).endsWith('See [[Project]].\n'));
});

test('creates frontmatter on a note without existing properties', async () => {
    const f = createFixture({ extraFiles: { 'A.md': '# Body\n' } });
    assert.equal(await f.service.setNodeConnection(
        f.entries.get('A.md'), f.entries.get('Project.md'), true,
    ), true);
    assert.deepEqual(f.properties('A.md')['file-pilot-links'], ['[[Project]]']);
    assert.ok(f.contents.get('A.md').endsWith('# Body\n'));
});

test('rejects new self-links but allows removal of an existing self-link', async () => {
    const f = createFixture({
        portalContent: '---\nfile-pilot-links: ["[[Project]]"]\n---\n',
    });
    const note = f.entries.get('Project.md');
    await assert.rejects(f.service.setNodeConnection(note, note, true), {
        code: 'FILE_GRAPH_SELF_LINK',
    });
    assert.deepEqual(f.writes, []);
    assert.equal(await f.service.setNodeConnection(note, note, false), true);
    assert.deepEqual(f.properties(note.path)['file-pilot-links'], []);
});

test('requires Markdown sources and new targets but allows deletion of existing attachment links', async () => {
    const f = createFixture({
        portalContent: '---\nfile-pilot-links: ["[[image.png]]"]\n---\n',
        extraFiles: { 'image.png': '' },
    });
    const note = f.entries.get('Project.md');
    const attachment = f.entries.get('image.png');
    for (const [source, target, connected] of [
        [note, attachment, true], [attachment, note, true], [attachment, note, false],
    ]) {
        await assert.rejects(f.service.setNodeConnection(source, target, connected), {
            code: 'FILE_GRAPH_INVALID_NOTE_TYPE',
        });
    }
    assert.deepEqual(f.writes, []);
    assert.equal(await f.service.setNodeConnection(note, attachment, false), true);
    assert.deepEqual(f.properties(note.path)['file-pilot-links'], []);
});

test('rejects missing or replaced endpoints before writing', async () => {
    const f = createFixture({ extraFiles: { 'A.md': '' } });
    const source = f.entries.get('A.md');
    const target = f.entries.get('Project.md');
    f.entries.delete(target.path);
    await assert.rejects(f.service.setNodeConnection(source, target, true), {
        code: 'FILE_GRAPH_NOTE_NOT_FOUND',
    });
    f.entries.set(target.path, new TFile(target.path));
    await assert.rejects(f.service.setNodeConnection(source, target, true), {
        code: 'FILE_GRAPH_NOTE_NOT_FOUND',
    });
    assert.deepEqual(f.writes, []);
});

test('checks endpoint existence again during the frontmatter update', async () => {
    const f = createFixture({ extraFiles: { 'A.md': '' } });
    const source = f.entries.get('A.md');
    const target = f.entries.get('Project.md');
    const process = f.app.fileManager.processFrontMatter;
    f.app.fileManager.processFrontMatter = (file, callback) => {
        f.entries.delete(target.path);
        return process(file, callback);
    };
    await assert.rejects(f.service.setNodeConnection(source, target, true), {
        code: 'FILE_GRAPH_NOTE_NOT_FOUND',
    });
    assert.deepEqual(f.writes, []);
    assert.equal(f.contents.get(source.path), '');
});

test('rejects malformed frontmatter and non-string managed property values without writing', async () => {
    for (const content of [
        '---\nvalue: [\n---\n',
        '---\nhello\n---\n',
        '---\nfile-pilot-links: invalid\n---\n',
        '---\nfile-pilot-links: [42]\n---\n',
    ]) {
        const f = createFixture({ extraFiles: { 'A.md': content } });
        await assert.rejects(f.service.setNodeConnection(
            f.entries.get('A.md'), f.entries.get('Project.md'), true,
        ), { code: 'FILE_GRAPH_FRONTMATTER_INVALID' });
        assert.deepEqual(f.writes, []);
        assert.equal(f.contents.get('A.md'), content);
    }
});

test('checks clearing state before and during a managed link update', async () => {
    const f = createFixture({ extraFiles: { 'A.md': '' }, clearing: true });
    const source = f.entries.get('A.md');
    const target = f.entries.get('Project.md');
    await assert.rejects(f.service.setNodeConnection(source, target, true), {
        code: 'CLEAR_IN_PROGRESS',
    });
    f.stateService.isClearingData = false;
    const process = f.app.fileManager.processFrontMatter;
    f.app.fileManager.processFrontMatter = (file, callback) => {
        f.stateService.isClearingData = true;
        return process(file, callback);
    };
    await assert.rejects(f.service.setNodeConnection(source, target, true), {
        code: 'CLEAR_IN_PROGRESS',
    });
    assert.deepEqual(f.writes, []);
});

test('revalidates the latest managed property inside processFrontMatter', async () => {
    const f = createFixture({ extraFiles: { 'A.md': '' } });
    const source = f.entries.get('A.md');
    const target = f.entries.get('Project.md');
    const process = f.app.fileManager.processFrontMatter;
    f.app.fileManager.processFrontMatter = (file, callback) => {
        f.contents.set(file.path, '---\nfile-pilot-links: invalid\n---\n');
        return process(file, callback);
    };
    await assert.rejects(f.service.setNodeConnection(source, target, true), {
        code: 'FILE_GRAPH_FRONTMATTER_INVALID',
    });
    assert.deepEqual(f.writes, []);
});
