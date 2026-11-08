import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeVault } from '../fakes/index.mjs';
import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const { ShadowNoteService } = await jiti.import('../../src/core/shadow-note-service.ts');

function setup(existingPaths = []) {
	const fake = createFakeVault(existingPaths);
	return { service: new ShadowNoteService({ vault: fake.vault }), ...fake };
}

test('uses the file name when no Shadow Note name conflicts', () => {
	const { service, lookedUpPaths } = setup();
	const path = service.getAvailableShadowNotePath('docs/report.pdf', 'file-1');
	assert.equal(path, 'ShadowNotes/report.pdf.md');
	assert.deepEqual(lookedUpPaths, ['ShadowNotes/report.pdf.md']);
});

test('adds parent folder names when the first candidate conflicts', () => {
	const { service, lookedUpPaths } = setup(['ShadowNotes/report.pdf.md']);
	const path = service.getAvailableShadowNotePath('docs/report.pdf', 'file-1');
	assert.equal(path, 'ShadowNotes/docs_report.pdf.md');
	assert.deepEqual(lookedUpPaths, [
		'ShadowNotes/report.pdf.md',
		'ShadowNotes/docs_report.pdf.md',
	]);
});

test('falls back to UUID-suffixed name when all parent candidates conflict', () => {
	const { service, lookedUpPaths } = setup([
		'ShadowNotes/report.pdf.md',
		'ShadowNotes/docs_report.pdf.md',
	]);
	const path = service.getAvailableShadowNotePath('docs/report.pdf', 'file-123');
	assert.equal(path, 'ShadowNotes/report.pdf-file-123.md');
	assert.deepEqual(lookedUpPaths, [
		'ShadowNotes/report.pdf.md',
		'ShadowNotes/docs_report.pdf.md',
	]);
});

test('generates Shadow Note paths for folder paths', () => {
    const { service } = setup();
    assert.equal(
        service.getAvailableShadowNotePath('Projects/Reports', 'folder-1'),
        'ShadowNotes/Reports.md',
    );
});

test('resolves folder path naming collisions using parent names', () => {
    const { service } = setup(['ShadowNotes/Reports.md']);
    assert.equal(
        service.getAvailableShadowNotePath('Projects/Reports', 'folder-1'),
        'ShadowNotes/Projects_Reports.md',
    );
});

test('retrieves the Shadow Note associated with a FileRecord', () => {
	const notePath = 'ShadowNotes/report.pdf.md';
	const { service } = setup([notePath]);
	assert.deepEqual(service.getShadowNote({ shadowNotePath: notePath }), {
		path: notePath,
	});
	assert.equal(service.getShadowNote({ shadowNotePath: 'ShadowNotes/missing.md' }), null);
});

test('creates the ShadowNotes folder with file-id and File Summary heading', async () => {
	const { service, createdFolders, createdFiles } = setup();
	await service.createShadowNote('ShadowNotes/report.pdf.md', 'file-123');
	assert.deepEqual(createdFolders, ['ShadowNotes']);
	assert.deepEqual(createdFiles, [{
		path: 'ShadowNotes/report.pdf.md',
		content: '---\nfile-id: file-123\n---\n\n## File Summary\n\n',
	}]);
});

function setupSummary({ exists = true, cache = null, content = '' } = {}) {
    const notePath = 'ShadowNotes/report.pdf.md';
    const reads = [];
    const app = {
        vault: {
            getFileByPath(path) {
                return exists && path === notePath ? { path } : null;
            },
            async cachedRead(note) {
                reads.push(note.path);
                return content;
            },
        },
        metadataCache: {
            getFileCache(note) {
                assert.equal(note.path, notePath);
                return cache;
            },
        },
    };
    return {
        service: new ShadowNoteService(app),
        record: { shadowNotePath: notePath },
        reads,
    };
}

test('getFileSummary returns null when the Shadow Note is missing', async () => {
    const { service, record, reads } = setupSummary({ exists: false });
    assert.equal(await service.getFileSummary(record), null);
    assert.deepEqual(reads, []);
});

test('getFileSummary reads Markdown without requiring heading metadata', async () => {
    const content = '## File Summary\n\nSummary without heading cache.\n';
    const { service, record, reads } = setupSummary({ cache: {}, content });
    assert.equal(await service.getFileSummary(record), 'Summary without heading cache.');
    assert.deepEqual(reads, [record.shadowNotePath]);
});

test('getFileSummary extracts the first Markdown paragraph without heading metadata', async () => {
    const { shadowNoteFixtures } = await import('../fixtures/shadow-notes.mjs');
    const fixture = shadowNoteFixtures.standard;
    const { service, record, reads } = setupSummary({
        cache: { headings: fixture.headings },
        content: fixture.content,
    });
    assert.equal(
        await service.getFileSummary(record),
        'This is a project report. It contains budget information.',
    );
    assert.deepEqual(reads, [record.shadowNotePath]);
});

test('getFileSummary returns null for an empty File Summary section', async () => {
    const { shadowNoteFixtures } = await import('../fixtures/shadow-notes.mjs');
    const fixture = shadowNoteFixtures.empty;
    const { service, record } = setupSummary({
        cache: { headings: fixture.headings },
        content: fixture.content,
    });
    assert.equal(await service.getFileSummary(record), null);
});

function setupSummaryWriter({
    exists = true,
    content = '## File Summary\n\nOld summary.\n',
    processError = null,
    beforeProcess = null,
} = {}) {
    const notePath = 'ShadowNotes/report.pdf.md';
    let currentContent = content;
    const processCalls = [];

    const app = {
        vault: {
            getFileByPath(path) {
                return exists && path === notePath ? { path } : null;
            },
            async process(note, updater) {
                assert.equal(note.path, notePath);
                processCalls.push(note.path);

                if (beforeProcess) {
                    currentContent = beforeProcess(currentContent);
                }

                const updatedContent = updater(currentContent);

                if (processError) {
                    throw processError;
                }

                currentContent = updatedContent;
                return updatedContent;
            },
            async cachedRead() {
                assert.fail('updateFileSummary must use Vault.process, not cachedRead');
            },
        },
    };

    return {
        service: new ShadowNoteService(app),
        record: { shadowNotePath: notePath },
        processCalls,
        getContent: () => currentContent,
    };
}

test('updateFileSummary replaces the first paragraph while preserving metadata and other sections', async () => {
    const original = [
        '---',
        'file-id: abc',
        '---',
        '',
        '## File Summary',
        '',
        'Old summary.',
        '',
        'Additional details.',
        '',
        '## Notes',
        '',
        'Keep this note.',
        '',
    ].join('\n');

    const ctx = setupSummaryWriter({ content: original });
    await ctx.service.updateFileSummary(ctx.record, 'New summary.');

    assert.equal(ctx.getContent(), original.replace('Old summary.', 'New summary.'));
    assert.deepEqual(ctx.processCalls, [ctx.record.shadowNotePath]);
});

test('updateFileSummary fills an existing empty File Summary section', async () => {
    const ctx = setupSummaryWriter({ content: '## File Summary\n\n' });

    await ctx.service.updateFileSummary(ctx.record, 'First summary.');

    assert.equal(ctx.getContent(), '## File Summary\n\nFirst summary.\n');
});

test('updateFileSummary restores a missing section immediately after frontmatter', async () => {
    const original = [
        '---',
        'file-id: abc',
        '---',
        '',
        '## Notes',
        '',
        'Keep this note.',
        '',
    ].join('\n');

    const ctx = setupSummaryWriter({ content: original });
    await ctx.service.updateFileSummary(ctx.record, 'New summary.');

    assert.equal(ctx.getContent(), [
        '---',
        'file-id: abc',
        '---',
        '',
        '## File Summary',
        '',
        'New summary.',
        '',
        '## Notes',
        '',
        'Keep this note.',
        '',
    ].join('\n'));
});

test('updateFileSummary does not create a missing section for blank input', async () => {
    const original = '## Notes\n\nKeep this note.\n';
    const ctx = setupSummaryWriter({ content: original });

    await ctx.service.updateFileSummary(ctx.record, ' \n ');

    assert.equal(ctx.getContent(), original);
    assert.equal(ctx.processCalls.length, 1);
});

test('updateFileSummary clears a summary containing only one paragraph', async () => {
    const ctx = setupSummaryWriter();

    await ctx.service.updateFileSummary(ctx.record, '');

    assert.equal(ctx.getContent(), '## File Summary\n\n');
});

test('updateFileSummary promotes the next paragraph when clearing the first', async () => {
    const original = [
        '## File Summary',
        '',
        'First paragraph.',
        '',
        'Second paragraph.',
        '',
        '## Notes',
        '',
        'Keep.',
        '',
    ].join('\n');

    const ctx = setupSummaryWriter({ content: original });
    await ctx.service.updateFileSummary(ctx.record, '');

    assert.equal(ctx.getContent(), [
        '## File Summary',
        '',
        'Second paragraph.',
        '',
        '## Notes',
        '',
        'Keep.',
        '',
    ].join('\n'));
});

test('updateFileSummary intentionally removes non-paragraph blocks preceding the first paragraph', async () => {
    const original = [
        '## File Summary',
        '',
        '> Blockquote before the summary.',
        '',
        'Old summary.',
        '',
        'Extra paragraph.',
        '',
        '## Notes',
        '',
        'Keep.',
        '',
    ].join('\n');

    const ctx = setupSummaryWriter({ content: original });
    await ctx.service.updateFileSummary(ctx.record, 'New summary.');

    assert.equal(ctx.getContent(), [
        '## File Summary',
        '',
        'New summary.',
        '',
        'Extra paragraph.',
        '',
        '## Notes',
        '',
        'Keep.',
        '',
    ].join('\n'));
});

test('updateFileSummary transforms the latest content provided by Vault.process', async () => {
    const ctx = setupSummaryWriter({
        content: '## File Summary\n\nOld summary.\n\n## Notes\n\nInitial note.\n',
        beforeProcess: content => content.replace('Initial note.', 'External update.'),
    });

    await ctx.service.updateFileSummary(ctx.record, 'New summary.');

    assert.equal(
        ctx.getContent(),
        '## File Summary\n\nNew summary.\n\n## Notes\n\nExternal update.\n',
    );
});

test('updateFileSummary preserves CRLF line endings', async () => {
    const original =
        '---\r\nfile-id: abc\r\n---\r\n\r\n' +
        '## File Summary\r\n\r\nOld summary.\r\n\r\n' +
        '## Notes\r\n\r\nKeep.\r\n';
    const ctx = setupSummaryWriter({ content: original });

    await ctx.service.updateFileSummary(ctx.record, 'New summary.');

    assert.equal(ctx.getContent(), original.replace('Old summary.', 'New summary.'));
});

test('updateFileSummary leaves unchanged content intact', async () => {
    const original = '## File Summary\n\nOld summary.\n\n## Notes\n\nKeep.\n';
    const ctx = setupSummaryWriter({ content: original });

    await ctx.service.updateFileSummary(ctx.record, 'Old summary.');

    assert.equal(ctx.getContent(), original);
    assert.equal(ctx.processCalls.length, 1);
});

test('updateFileSummary rejects missing Shadow Notes without writing', async () => {
    const ctx = setupSummaryWriter({ exists: false });

    await assert.rejects(
        () => ctx.service.updateFileSummary(ctx.record, 'New summary.'),
        error => error.code === 'SHADOW_NOTE_NOT_FOUND',
    );

    assert.deepEqual(ctx.processCalls, []);
});

test('updateFileSummary propagates Vault.process failures without committing changes', async () => {
    const failure = new Error('Write failed');
    const ctx = setupSummaryWriter({ processError: failure });
    const original = ctx.getContent();

    await assert.rejects(
        () => ctx.service.updateFileSummary(ctx.record, 'New summary.'),
        error => error === failure,
    );

    assert.equal(ctx.getContent(), original);
    assert.deepEqual(ctx.processCalls, [ctx.record.shadowNotePath]);
});
