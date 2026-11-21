import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { makeFileRecord } from '../factories/file-record.mjs';
import { TFile } from '../fakes/portal-note-obsidian.mjs';

const obsidianFakePath = fileURLToPath(
    new URL('../fakes/portal-note-obsidian.mjs', import.meta.url),
);
const jiti = createJiti(import.meta.url, {
    alias: { obsidian: obsidianFakePath },
});
const { PortalNoteService } = await jiti.import(
    '../../src/core/portal-note-service.ts',
);
const { FilePilotError } = await jiti.import('../../src/error.ts');

function createFakeVault({ files = [], folders = [] } = {}) {
    const entries = new Map();
    const contents = new Map();
    const calls = {
        lookups: [],
        created: [],
        processed: [],
        renamed: [],
    };

    for (const { path: filePath, content } of files) {
        const file = new TFile(filePath);
        entries.set(filePath, file);
        contents.set(filePath, content);
    }

    for (const folderPath of folders) {
        entries.set(folderPath, { path: folderPath, children: [] });
    }

    const vault = {
        getAbstractFileByPath(filePath) {
            calls.lookups.push(filePath);
            return entries.get(filePath) ?? null;
        },

        async create(filePath, content) {
            const file = new TFile(filePath);
            entries.set(filePath, file);
            contents.set(filePath, content);
            calls.created.push({ file, content });
            return file;
        },

        async rename(file, newPath) {
            const oldPath = file.path;

            if (entries.has(newPath)) {
                throw new Error(`Path already exists: ${newPath}`);
            }

            const content = contents.get(oldPath);

            entries.delete(oldPath);
            contents.delete(oldPath);

            file.path = newPath;
            entries.set(newPath, file);

            if (content !== undefined) {
                contents.set(newPath, content);
            }

            calls.renamed.push({ file, oldPath, newPath });
        },

        async process(file, updater) {
            calls.processed.push(file);
            const current = contents.get(file.path);
            const updated = updater(current);
            contents.set(file.path, updated);
            return updated;
        },
    };

    return { vault, contents, calls };
}

function createFixture({
    projectName = 'My Project',
    previousProjectName = null,
    rootPath = '',
    records = [],
    files = [],
    folders = [],
    formatFileReference,
    getFileSummary = async () => null,
} = {}) {
    const { vault, contents, calls } = createFakeVault({ files, folders });
    const referenceCalls = [];
    const stateCalls = {
        clearedPreviousProjectName: 0,
    };
    let pendingPreviousProjectName = previousProjectName;

    const stateService = {
        getProjectName: () => projectName,
        getPreviousProjectName: () => pendingPreviousProjectName,
        getRootPath: () => rootPath,
        getFileRecords: () => records,
        async clearPreviousProjectName() {
            stateCalls.clearedPreviousProjectName += 1;
            pendingPreviousProjectName = null;
        },
    };

    const referenceService = {
        formatFileReference(id) {
            referenceCalls.push(id);
            return formatFileReference
                ? formatFileReference(id)
                : `|||!${id}|||`;
        },
    };

    const service = new PortalNoteService(
        { vault },
        stateService,
        referenceService,
        { getFileSummary },
    );

    return {
        service,
        contents,
        calls,
        referenceCalls,
        stateCalls,
    };
}

test('creates a Portal Note named after the project and renders its FileRecords', async () => {
    const record = makeFileRecord('record-1', {
        path: 'Documents/report.pdf',
    });
    const { service, contents, calls, referenceCalls } = createFixture({
        projectName: 'My Project',
        records: [record],
    });

    const result = await service.syncPortalNote();
    const content = contents.get('My Project.md');

    assert.equal(result.changed, true);
    assert.equal(calls.created[0].file.path, 'My Project.md');
    assert.deepEqual(calls.lookups, ['My Project.md']);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.processed.length, 0);
    assert.deepEqual(referenceCalls, ['record-1']);
    assert.match(content, /## Directory Tree/);
    assert.match(content, /```file-pilot-tree/);
    assert.ok(content.includes(`My Project${path.sep}`));
    assert.ok(content.includes(`Documents${path.sep}`));
    assert.ok(content.includes('|||!record-1|||'));
});

test('uses the default Portal Note name and creates a root-only tree when no records exist', async () => {
    const { service, contents, calls, referenceCalls } = createFixture({
        projectName: '',
        records: [],
    });

    const result = await service.syncPortalNote();
    const content = contents.get('PORTAL NOTE.md');

    assert.equal(result.changed, true);
    assert.equal(calls.created[0].file.path, 'PORTAL NOTE.md');
    assert.deepEqual(calls.lookups, ['PORTAL NOTE.md']);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.processed.length, 0);
    assert.deepEqual(referenceCalls, []);
    assert.ok(content.includes(`Root${path.sep}`));
    assert.match(content, /## Directory Tree/);
    assert.match(content, /```file-pilot-tree/);
});

test('updates only the managed tree fence and preserves surrounding Markdown content', async () => {
    const record = makeFileRecord('record-1', {
        path: 'Documents/report.pdf',
    });
    const existingContent = [
        '# Introduction',
        '',
        'Keep this introduction.',
        '',
        '## Directory Tree',
        '',
        'User note before the tree.',
        '',
        '```file-pilot-tree',
        'Old/',
        '```',
        '',
        'User note after the tree.',
        '',
        '## Other Section',
        '',
        'Keep this section unchanged.',
        '',
    ].join('\n');
    const existingFile = new TFile('My Project.md');
    const { service, contents, calls, referenceCalls } = createFixture({
        projectName: 'My Project',
        records: [record],
        files: [{ path: existingFile.path, content: existingContent }],
    });

    const result = await service.syncPortalNote();
    const updatedContent = contents.get(existingFile.path);

    assert.equal(result.changed, true);
    assert.deepEqual(calls.created, []);
    assert.equal(calls.processed.length, 1);
    assert.equal(calls.processed[0].path, existingFile.path);
    assert.deepEqual(referenceCalls, ['record-1']);
    assert.ok(updatedContent.includes('Keep this introduction.'));
    assert.ok(updatedContent.includes('User note before the tree.'));
    assert.ok(updatedContent.includes('User note after the tree.'));
    assert.ok(updatedContent.includes('Keep this section unchanged.'));
    assert.ok(updatedContent.includes('|||!record-1|||'));
    assert.equal(
        (updatedContent.match(/```file-pilot-tree/g) ?? []).length,
        1,
    );
    assert.ok(!updatedContent.includes('Old/'));
});

test('repeated synchronization leaves an already current Portal Note unchanged', async () => {
    const record = makeFileRecord('record-1', {
        path: 'Documents/report.pdf',
    });
    const { service, contents, calls } = createFixture({
        records: [record],
    });

    const firstResult = await service.syncPortalNote();
    const firstContent = contents.get('My Project.md');

    assert.equal(firstResult.changed, true);

    const secondResult = await service.syncPortalNote();

    assert.equal(secondResult.changed, false);
    assert.equal(contents.get('My Project.md'), firstContent);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.processed.length, 1);
});

test('renames the previous Portal Note when the new path is free', async () => {
    const previousContent = [
        '# User content',
        '',
        'Preserve this text.',
        '',
        '## Directory Tree',
        '',
        '```file-pilot-tree',
        'Old/',
        '```',
    ].join('\n');

    const { service, contents, calls, stateCalls } = createFixture({
        projectName: 'Project B',
        previousProjectName: 'Project A',
        files: [{ path: 'Project A.md', content: previousContent }],
    });

    const result = await service.syncPortalNote();

    assert.equal(result.changed, true);
    assert.equal(contents.has('Project A.md'), false);
    assert.ok(contents.has('Project B.md'));
    assert.match(contents.get('Project B.md'), /Preserve this text\./);
    assert.equal(calls.renamed.length, 1);
    assert.deepEqual(
        { oldPath: calls.renamed[0].oldPath, newPath: calls.renamed[0].newPath },
        { oldPath: 'Project A.md', newPath: 'Project B.md' },
    );
    assert.equal(calls.processed.length, 1);
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
});

test('updates the new Portal Note and preserves the old note when both exist', async () => {
    const oldContent = '# Old note\n';
    const newContent = [
        '# Current note',
        '',
        'Keep current user content.',
        '',
        '## Directory Tree',
        '',
        '```file-pilot-tree',
        'Stale/',
        '```',
    ].join('\n');

    const { service, contents, calls, stateCalls } = createFixture({
        projectName: 'Project B',
        previousProjectName: 'Project A',
        files: [
            { path: 'Project A.md', content: oldContent },
            { path: 'Project B.md', content: newContent },
        ],
    });

    const result = await service.syncPortalNote();

    assert.equal(result.changed, true);
    assert.equal(contents.get('Project A.md'), oldContent);
    assert.match(contents.get('Project B.md'), /Keep current user content/);
    assert.doesNotMatch(contents.get('Project B.md'), /Stale\//);
    assert.equal(calls.renamed.length, 0);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.processed.length, 1);
    assert.equal(calls.processed[0].path, 'Project B.md');
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
});

test('creates the new Portal Note when neither previous nor current note exists', async () => {
    const { service, contents, calls, stateCalls } = createFixture({
        projectName: 'Project B',
        previousProjectName: 'Project A',
    });

    const result = await service.syncPortalNote();

    assert.equal(result.changed, true);
    assert.ok(contents.has('Project B.md'));
    assert.equal(calls.created.length, 1);
    assert.equal(calls.renamed.length, 0);
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
});

test('updates the current note when the previous Portal Note is missing', async () => {
    const currentContent = '# Current note\n';
    const { service, contents, calls, stateCalls } = createFixture({
        projectName: 'Project B',
        previousProjectName: 'Project A',
        files: [{ path: 'Project B.md', content: currentContent }],
    });

    const result = await service.syncPortalNote();

    assert.equal(result.changed, true);
    assert.equal(calls.renamed.length, 0);
    assert.equal(calls.processed.length, 1);
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
    assert.ok(contents.has('Project B.md'));
});

test('reports a path occupied by a folder without creating or updating a note', async () => {
    const { service, calls } = createFixture({
        projectName: 'My Project',
        folders: ['My Project.md'],
    });

    await assert.rejects(
        service.syncPortalNote(),
        (error) => {
            assert.ok(error instanceof FilePilotError);
            assert.equal(error.code, 'PORTAL_NOTE_PATH_OCCUPIED');
            assert.match(error.message, /My Project\.md/);
            return true;
        },
    );

    assert.equal(calls.created.length, 0);
    assert.equal(calls.processed.length, 0);
});

test('propagates a missing FileRecord reference before changing the Portal Note', async () => {
    const record = makeFileRecord('record-1');
    const { service, calls } = createFixture({
        records: [record],
        formatFileReference: () => null,
    });

    await assert.rejects(
        service.syncPortalNote(),
        (error) => {
            assert.ok(error instanceof FilePilotError);
            assert.equal(error.code, 'FILE_REFERENCE_NOT_FOUND');
            return true;
        },
    );

    assert.deepEqual(calls.lookups, []);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.processed.length, 0);
});


test('creates an annotated Portal Tree using summaries for files and managed folders', async () => {
    const folder = {
        ...makeFileRecord('folder-1', { path: 'Docs' }),
        kind: 'folder',
    };
    const file = makeFileRecord('file-1', { path: 'Docs/report.pdf' });
    const summaries = new Map([
        ['folder-1', 'Folder description'],
        ['file-1', 'File description'],
    ]);
    const calls = [];
    const fixture = createFixture({
        records: [file, folder],
        getFileSummary: async (record) => {
            calls.push(record.id);
            return summaries.get(record.id) ?? null;
        },
    });

    const result = await fixture.service.syncPortalNote();
    const content = fixture.contents.get('My Project.md');

    assert.equal(result.changed, true);
    assert.deepEqual(calls, ['file-1', 'folder-1']);
    assert.ok(content.includes('|||!folder-1|||  # Folder description'));
    assert.ok(content.includes('|||!file-1|||  # File description'));
});

test('refreshes changed annotations and removes cleared ones on full synchronization', async () => {
    const record = makeFileRecord('file-1');
    let summary = 'Original summary';
    const fixture = createFixture({
        records: [record],
        getFileSummary: async () => summary,
    });

    assert.deepEqual(await fixture.service.syncPortalNote(), { changed: true });
    assert.ok(fixture.contents.get('My Project.md').includes(
        '|||!file-1|||  # Original summary',
    ));

    summary = 'Changed summary';
    assert.deepEqual(await fixture.service.syncPortalNote(), { changed: true });
    assert.ok(fixture.contents.get('My Project.md').includes(
        '|||!file-1|||  # Changed summary',
    ));
    assert.ok(!fixture.contents.get('My Project.md').includes('Original summary'));

    assert.deepEqual(await fixture.service.syncPortalNote(), { changed: false });

    summary = null;
    assert.deepEqual(await fixture.service.syncPortalNote(), { changed: true });
    const content = fixture.contents.get('My Project.md');
    assert.ok(content.includes('|||!file-1|||'));
    assert.ok(!content.includes('  # Changed summary'));
});

test('does not create or overwrite the Portal Note when Summary reading fails', async () => {
    const record = makeFileRecord('file-1');
    const error = new Error('Shadow Note read failed');
    const existingContent = '## Directory Tree\n\n```file-pilot-tree\nOriginal/\n```\n';
    const fixture = createFixture({
        records: [record],
        files: [{ path: 'My Project.md', content: existingContent }],
        getFileSummary: async () => { throw error; },
    });

    await assert.rejects(fixture.service.syncPortalNote(), failure => failure === error);
    assert.equal(fixture.contents.get('My Project.md'), existingContent);
    assert.equal(fixture.calls.created.length, 0);
    assert.equal(fixture.calls.processed.length, 0);
    assert.equal(fixture.calls.renamed.length, 0);
});

test('does not update the Portal Note when any one of multiple Summary reads fails', async () => {
    const records = [
        makeFileRecord('file-1', { path: 'a.txt' }),
        makeFileRecord('file-2', { path: 'b.txt' }),
    ];
    const error = new Error('Cannot read second file');
    const fixture = createFixture({
        records,
        getFileSummary: async (record) => {
            if (record.id === 'file-2') throw error;
            return 'First summary';
        },
    });

    await assert.rejects(fixture.service.syncPortalNote(), failure => failure === error);
    assert.equal(fixture.calls.created.length, 0);
    assert.equal(fixture.calls.processed.length, 0);
});

test('does not modify user Markdown outside the tree when summaries change', async () => {
    const record = makeFileRecord('file-1');
    const original = [
        '# User introduction',
        '',
        'Keep this text.',
        '',
        '## Directory Tree',
        '',
        'User notes above fence.',
        '',
        '```file-pilot-tree',
        'Old/',
        '```',
        '',
        'User notes below fence.',
        '',
        '## Personal',
        '',
        'Keep this section.',
        '',
    ].join('\n');
    const fixture = createFixture({
        records: [record],
        files: [{ path: 'My Project.md', content: original }],
        getFileSummary: async () => 'Latest summary',
    });

    await fixture.service.syncPortalNote();
    const updated = fixture.contents.get('My Project.md');

    assert.ok(updated.includes('|||!file-1|||  # Latest summary'));
    assert.ok(updated.includes('Keep this text.'));
    assert.ok(updated.includes('User notes above fence.'));
    assert.ok(updated.includes('User notes below fence.'));
    assert.ok(updated.includes('## Personal\n\nKeep this section.'));
});
