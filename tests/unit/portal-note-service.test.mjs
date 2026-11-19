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
    rootPath = '',
    records = [],
    files = [],
    folders = [],
    formatFileReference,
} = {}) {
    const { vault, contents, calls } = createFakeVault({ files, folders });
    const referenceCalls = [];

    const stateService = {
        getProjectName: () => projectName,
        getRootPath: () => rootPath,
        getFileRecords: () => records,
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
    );

    return {
        service,
        contents,
        calls,
        referenceCalls,
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

