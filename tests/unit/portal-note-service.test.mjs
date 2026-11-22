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
        trashed: [],
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

        async trashFile(file) {
            entries.delete(file.path);
            contents.delete(file.path);
            calls.trashed.push(file);
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
        isClearingData: false,
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
                : records.some(record => record.id === id) ? `|||@${id}|||` : null;
        },
    };

    const service = new PortalNoteService(
        {
            vault,
            fileManager: {
                trashFile: (file) => vault.trashFile(file),
            },
        },
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
        stateService,
    };
}

test('creates a Portal Note named after the project and renders its FileRecords', async () => {
    const record = makeFileRecord('Record000001', {
        path: 'Documents/report.pdf',
    });
    const { service, contents, calls, referenceCalls } = createFixture({
        projectName: 'My Project',
        records: [record],
    });

    const result = await service.createPortalNote(service.buildCurrentPortalTree());
    const content = contents.get('My Project.md');

    assert.equal(result, true);
    assert.equal(calls.created[0].file.path, 'My Project.md');
    assert.deepEqual(calls.lookups, ['My Project.md']);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.processed.length, 0);
    assert.deepEqual(referenceCalls, ['Record000001']);
    assert.match(content, /## Directory Tree/);
    assert.match(content, /```file-pilot-tree/);
    assert.ok(content.includes(`My Project${path.sep}`));
    assert.ok(content.includes(`Documents${path.sep}`));
    assert.ok(content.includes('|||@Record000001|||'));
});

test('creates an empty default Portal Note without a directory tree when no records exist', async () => {
    const { service, contents, calls, referenceCalls } = createFixture({
        projectName: '',
        records: [],
    });

    const result = await service.createPortalNote(service.buildCurrentPortalTree());
    const content = contents.get('PORTAL NOTE.md');

    assert.equal(result, true);
    assert.equal(calls.created[0].file.path, 'PORTAL NOTE.md');
    assert.deepEqual(calls.lookups, ['PORTAL NOTE.md']);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.processed.length, 0);
    assert.deepEqual(referenceCalls, []);
    assert.equal(content, '');
});

test('updates only the managed tree fence and preserves surrounding Markdown content', async () => {
    const record = makeFileRecord('Record000001', {
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

    const result = await service.syncPortalNote(service.buildCurrentPortalTree());
    const updatedContent = contents.get(existingFile.path);

    assert.equal(result, true);
    assert.deepEqual(calls.created, []);
    assert.equal(calls.processed.length, 1);
    assert.equal(calls.processed[0].path, existingFile.path);
    assert.deepEqual(referenceCalls, ['Record000001']);
    assert.ok(updatedContent.includes('Keep this introduction.'));
    assert.ok(updatedContent.includes('User note before the tree.'));
    assert.ok(updatedContent.includes('User note after the tree.'));
    assert.ok(updatedContent.includes('Keep this section unchanged.'));
    assert.ok(updatedContent.includes('|||@Record000001|||'));
    assert.equal(
        (updatedContent.match(/```file-pilot-tree/g) ?? []).length,
        1,
    );
    assert.ok(!updatedContent.includes('Old/'));
});

test('repeated synchronization leaves an already current Portal Note unchanged', async () => {
    const record = makeFileRecord('Record000001', {
        path: 'Documents/report.pdf',
    });
    const { service, contents, calls } = createFixture({
        records: [record],
        files: [{ path: 'My Project.md', content: '' }],
    });

    const firstResult = await service.syncPortalNote(service.buildCurrentPortalTree());
    const firstContent = contents.get('My Project.md');

    assert.equal(firstResult, true);

    const secondResult = await service.syncPortalNote(service.buildCurrentPortalTree());

    assert.equal(secondResult, false);
    assert.equal(contents.get('My Project.md'), firstContent);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.processed.length, 2);
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

    const result = await service.handlePortalNoteProjectNameChange();

    assert.equal(result, 'renamed');
    assert.equal(contents.has('Project A.md'), false);
    assert.ok(contents.has('Project B.md'));
    assert.match(contents.get('Project B.md'), /Preserve this text\./);
    assert.equal(calls.renamed.length, 1);
    assert.deepEqual(
        { oldPath: calls.renamed[0].oldPath, newPath: calls.renamed[0].newPath },
        { oldPath: 'Project A.md', newPath: 'Project B.md' },
    );
    assert.equal(calls.processed.length, 0);
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
});

test('preserves the existing current Portal Note unchanged when both old and new notes exist', async () => {
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

    const result = await service.handlePortalNoteProjectNameChange();

    assert.equal(result, 'unchanged');
    assert.equal(contents.get('Project A.md'), oldContent);
    assert.equal(contents.get('Project B.md'), newContent);
    assert.equal(calls.renamed.length, 0);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.processed.length, 0);
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
});

test('creates the new Portal Note when neither previous nor current note exists', async () => {
    const { service, contents, calls, stateCalls } = createFixture({
        projectName: 'Project B',
        previousProjectName: 'Project A',
    });

    const result = await service.handlePortalNoteProjectNameChange();

    assert.equal(result, 'created');
    assert.ok(contents.has('Project B.md'));
    assert.equal(calls.created.length, 1);
    assert.equal(calls.renamed.length, 0);
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
});

test('preserves the current Portal Note when the previous Portal Note is missing', async () => {
    const currentContent = '# Current note\n';
    const { service, contents, calls, stateCalls } = createFixture({
        projectName: 'Project B',
        previousProjectName: 'Project A',
        files: [{ path: 'Project B.md', content: currentContent }],
    });

    const result = await service.handlePortalNoteProjectNameChange();

    assert.equal(result, 'unchanged');
    assert.equal(calls.renamed.length, 0);
    assert.equal(calls.processed.length, 0);
    assert.equal(stateCalls.clearedPreviousProjectName, 1);
    assert.equal(contents.get('Project B.md'), currentContent);
});

test('reports a path occupied by a folder without creating or updating a note', async () => {
    const { service, calls } = createFixture({
        projectName: 'My Project',
        folders: ['My Project.md'],
    });

    await assert.rejects(
        service.syncPortalNote(service.buildCurrentPortalTree()),
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
    const record = makeFileRecord('Record000001');
    const { service, calls } = createFixture({
        records: [record],
        files: [{ path: 'My Project.md', content: '' }],
        formatFileReference: () => null,
    });

    await assert.rejects(
        service.syncPortalNote(service.buildCurrentPortalTree()),
        (error) => {
            assert.ok(error instanceof FilePilotError);
            assert.equal(error.code, 'FILE_REFERENCE_NOT_FOUND');
            return true;
        },
    );

    assert.deepEqual(calls.lookups, ['My Project.md']);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.processed.length, 0);
});


test('creates an annotated Portal Tree using summaries for files and managed folders', async () => {
    const folder = {
        ...makeFileRecord('Folder000001', { path: 'Docs' }),
        kind: 'folder',
    };
    const file = makeFileRecord('File00000001', { path: 'Docs/report.pdf' });
    const summaries = new Map([
        ['Folder000001', 'Folder description'],
        ['File00000001', 'File description'],
    ]);
    const calls = [];
    const fixture = createFixture({
        records: [file, folder],
        getFileSummary: async (record) => {
            calls.push(record.id);
            return summaries.get(record.id) ?? null;
        },
    });

    const result = await fixture.service.createPortalNote(fixture.service.buildCurrentPortalTree());
    const content = fixture.contents.get('My Project.md');

    assert.equal(result, true);
    assert.deepEqual(calls, ['File00000001', 'Folder000001']);
    assert.ok(content.includes('|||@Folder000001|||  # Folder description'));
    assert.ok(content.includes('|||@File00000001|||  # File description'));
});

test('refreshes changed annotations and removes cleared ones on full synchronization', async () => {
    const record = makeFileRecord('File00000001');
    let summary = 'Original summary';
    const fixture = createFixture({
        records: [record],
        files: [{ path: 'My Project.md', content: '' }],
        getFileSummary: async () => summary,
    });

    assert.equal(await fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree()), true);
    assert.ok(fixture.contents.get('My Project.md').includes(
        '|||@File00000001|||  # Original summary',
    ));

    summary = 'Changed summary';
    assert.equal(await fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree()), true);
    assert.ok(fixture.contents.get('My Project.md').includes(
        '|||@File00000001|||  # Changed summary',
    ));
    assert.ok(!fixture.contents.get('My Project.md').includes('Original summary'));

    assert.equal(await fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree()), false);

    summary = null;
    assert.equal(await fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree()), true);
    const content = fixture.contents.get('My Project.md');
    assert.ok(content.includes('|||@File00000001|||'));
    assert.ok(!content.includes('  # Changed summary'));
});

test('does not create or overwrite the Portal Note when Summary reading fails', async () => {
    const record = makeFileRecord('File00000001');
    const error = new Error('Shadow Note read failed');
    const existingContent = '## Directory Tree\n\n```file-pilot-tree\nOriginal/\n```\n';
    const fixture = createFixture({
        records: [record],
        files: [{ path: 'My Project.md', content: existingContent }],
        getFileSummary: async () => { throw error; },
    });

    await assert.rejects(fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree()), failure => failure === error);
    assert.equal(fixture.contents.get('My Project.md'), existingContent);
    assert.equal(fixture.calls.created.length, 0);
    assert.equal(fixture.calls.processed.length, 0);
    assert.equal(fixture.calls.renamed.length, 0);
});

test('does not update the Portal Note when any one of multiple Summary reads fails', async () => {
    const records = [
        makeFileRecord('File00000001', { path: 'a.txt' }),
        makeFileRecord('File00000002', { path: 'b.txt' }),
    ];
    const error = new Error('Cannot read second file');
    const fixture = createFixture({
        records,
        files: [{ path: 'My Project.md', content: '' }],
        getFileSummary: async (record) => {
            if (record.id === 'File00000002') throw error;
            return 'First summary';
        },
    });

    await assert.rejects(fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree()), failure => failure === error);
    assert.equal(fixture.calls.created.length, 0);
    assert.equal(fixture.calls.processed.length, 0);
});

test('deletes the current Portal Note through the vault file manager', async () => {
    const fixture = createFixture({
        projectName: 'My Project',
        files: [{ path: 'My Project.md', content: '# Portal Note' }],
    });

    const deleted = await fixture.service.deletePortalNote();

    assert.equal(deleted, true);
    assert.equal(fixture.contents.has('My Project.md'), false);
    assert.equal(fixture.calls.trashed.length, 1);
    assert.equal(fixture.calls.trashed[0].path, 'My Project.md');

    assert.equal(await fixture.service.deletePortalNote(), false);
    assert.equal(fixture.calls.trashed.length, 1);
});

test('does not modify user Markdown outside the tree when summaries change', async () => {
    const record = makeFileRecord('File00000001');
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

    await fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree());
    const updated = fixture.contents.get('My Project.md');

    assert.ok(updated.includes('|||@File00000001|||  # Latest summary'));
    assert.ok(updated.includes('Keep this text.'));
    assert.ok(updated.includes('User notes above fence.'));
    assert.ok(updated.includes('User notes below fence.'));
    assert.ok(updated.includes('## Personal\n\nKeep this section.'));
});


function summaryFixture(options = {}) {
    const file = makeFileRecord('File00000001', { path: 'a.pdf' });
    const folder = { ...makeFileRecord('Folder000001', { path: 'Docs' }), kind: 'folder' };
    const original = [
        '# User content', '', 'Keep this text.', '', '## Directory Tree', '',
        '~~~file-pilot-tree', 'Project/',
        '\u251c\u2500\u2500 |||@Folder000001|||  # Folder summary',
        '\u2514\u2500\u2500 |||@File00000001|||  # Old summary',
        '~~~', '', '## Personal', '', 'Keep this section.', '',
    ].join('\n');
    return {
        ...createFixture({
            records: [file, folder],
            files: [{ path: 'My Project.md', content: original }],
            ...options,
        }),
        original,
    };
}

test('updates only the target file annotation using the indexed ID', async () => {
    const fixture = summaryFixture({
        getFileSummary: async () => { throw new Error('Unexpected Summary read'); },
    });
    assert.equal(await fixture.service.updateFileSummaryAnnotation('File00000001', 'New summary'), true);
    assert.equal(fixture.contents.get('My Project.md'),
        fixture.original.replace('  # Old summary', '  # New summary'));
    assert.deepEqual(fixture.referenceCalls, ['File00000001']);
    assert.equal(fixture.calls.processed.length, 1);
    assert.equal(fixture.calls.created.length, 0);
    assert.equal(await fixture.service.updateFileSummaryAnnotation('File00000001', 'New summary'), false);
});

test('adds and removes managed folder annotations without changing its tree node', async () => {
    const fixture = summaryFixture();
    const reference = '|||@Folder000001|||';
    const cleared = fixture.original.replace(reference + '  # Folder summary', reference);
    assert.equal(await fixture.service.updateFileSummaryAnnotation('Folder000001', null), true);
    assert.equal(fixture.contents.get('My Project.md'), cleared);
    assert.equal(await fixture.service.updateFileSummaryAnnotation('Folder000001', 'New folder summary'), true);
    assert.equal(fixture.contents.get('My Project.md'),
        cleared.replace(reference, reference + '  # New folder summary'));
});

test('ignores unknown and incorrectly cased IDs without accessing the Portal Note', async () => {
    const fixture = summaryFixture();
    for (const id of ['Unknown00001', 'file00000001']) {
        assert.equal(await fixture.service.updateFileSummaryAnnotation(id, 'Ignored'), false);
    }
    assert.deepEqual(fixture.calls.lookups, []);
    assert.deepEqual(fixture.calls.processed, []);
    assert.equal(fixture.contents.get('My Project.md'), fixture.original);
});

test('does not create a missing Portal Note for a Summary update', async () => {
    const fixture = summaryFixture({ files: [] });
    assert.equal(await fixture.service.updateFileSummaryAnnotation('File00000001', 'New'), false);
    assert.deepEqual(fixture.calls.created, []);
    assert.deepEqual(fixture.calls.processed, []);
});

test('reports a folder occupying the Portal Note path during a Summary update', async () => {
    const fixture = summaryFixture({ files: [], folders: ['My Project.md'] });
    await assert.rejects(fixture.service.updateFileSummaryAnnotation('File00000001', 'New'),
        error => error.code === 'PORTAL_NOTE_PATH_OCCUPIED');
    assert.deepEqual(fixture.calls.processed, []);
});

test('does not insert a missing tree node or create a missing tree section', async () => {
    for (const content of ['# Personal\n\nKeep this.', '## Directory Tree\n\n~~~file-pilot-tree\nProject/\n~~~\n']) {
        const fixture = summaryFixture({ files: [{ path: 'My Project.md', content }] });
        assert.equal(await fixture.service.updateFileSummaryAnnotation('File00000001', 'New'), false);
        assert.equal(fixture.contents.get('My Project.md'), content);
    }
});

test('skips Summary updates while clearing data', async () => {
    const fixture = summaryFixture();
    fixture.stateService.isClearingData = true;
    assert.equal(await fixture.service.updateFileSummaryAnnotation('File00000001', 'Ignored'), false);
    assert.deepEqual(fixture.calls.lookups, []);
    assert.equal(fixture.contents.get('My Project.md'), fixture.original);
});

test('serializes full tree generation and later Summary updates', async () => {
    let releaseRead;
    let signalRead;
    const gate = new Promise(resolve => { releaseRead = resolve; });
    const started = new Promise(resolve => { signalRead = resolve; });
    const fixture = summaryFixture({
        getFileSummary: async record => {
            if (record.id === 'File00000001') {
                signalRead();
                await gate;
                return 'Old snapshot';
            }
            return 'Folder summary';
        },
    });
    const full = fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree());
    await started;
    const partial = fixture.service.updateFileSummaryAnnotation('File00000001', 'Latest summary');
    try {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(fixture.calls.processed.length, 0);
    } finally {
        releaseRead();
        await Promise.all([full, partial]);
    }
    assert.equal(fixture.calls.processed.length, 2);
    assert.ok(fixture.contents.get('My Project.md').includes('|||@File00000001|||  # Latest summary'));
    assert.ok(!fixture.contents.get('My Project.md').includes('Old snapshot'));
});

test('applies queued Summary updates in order and retains changes to other nodes', async () => {
    const fixture = summaryFixture();
    const results = await Promise.all([
        fixture.service.updateFileSummaryAnnotation('File00000001', 'First'),
        fixture.service.updateFileSummaryAnnotation('Folder000001', 'New folder'),
        fixture.service.updateFileSummaryAnnotation('File00000001', 'Last'),
    ]);
    assert.deepEqual(results, [true, true, true]);
    assert.equal(fixture.contents.get('My Project.md'), fixture.original
        .replace('  # Old summary', '  # Last')
        .replace('  # Folder summary', '  # New folder'));
});

test('skips a queued Summary update when clearing starts before execution', async () => {
    let releaseRead;
    const gate = new Promise(resolve => { releaseRead = resolve; });
    const fixture = summaryFixture({ getFileSummary: async () => gate });
    const full = fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree());
    const partial = fixture.service.updateFileSummaryAnnotation('File00000001', 'Ignored');
    fixture.stateService.isClearingData = true;
    releaseRead('Full summary');
    await full;
    assert.equal(await partial, false);
    assert.equal(fixture.calls.processed.length, 1);
    assert.ok(!fixture.contents.get('My Project.md').includes('Ignored'));
});

test('continues processing Summary updates after a full synchronization fails', async () => {
    const fixture = summaryFixture({
        getFileSummary: async () => { throw new Error('Summary read failed'); },
    });
    const full = fixture.service.syncPortalNote(fixture.service.buildCurrentPortalTree());
    const partial = fixture.service.updateFileSummaryAnnotation('File00000001', 'Recovered');
    await assert.rejects(full, /Summary read failed/);
    assert.equal(await partial, true);
    assert.equal(fixture.contents.get('My Project.md'),
        fixture.original.replace('  # Old summary', '  # Recovered'));
});

test('serializes Portal Note creation, Summary updates and deletion', async () => {
    const fixture = summaryFixture({ files: [] });
    const created = fixture.service.createPortalNote(fixture.service.buildCurrentPortalTree());
    const updated = fixture.service.updateFileSummaryAnnotation('File00000001', 'New');
    const deleted = fixture.service.deletePortalNote();
    assert.deepEqual(await Promise.all([created, updated, deleted]), [true, true, true]);
    assert.equal(fixture.calls.created.length, 1);
    assert.equal(fixture.calls.processed.length, 1);
    assert.equal(fixture.calls.trashed.length, 1);
    assert.equal(fixture.contents.has('My Project.md'), false);
});
