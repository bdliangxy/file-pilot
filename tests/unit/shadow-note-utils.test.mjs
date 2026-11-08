import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

import { shadowNoteFixtures } from '../fixtures/shadow-notes.mjs';

const jiti = createJiti(import.meta.url);
const {
	generateShadowNoteName,
	extractFirstParagraphFromHeading,
	updateMarkdownSection,
	insertMarkdownBlock,
	replaceFirstParagraph,
} = await jiti.import('../../src/utils/shadow-note-utils.ts');

test('generates Shadow Note names using parent folders', () => {
	const relativePath = 'projects/docs/report.pdf';

	assert.equal(generateShadowNoteName(relativePath, 0), 'report.pdf.md');
	assert.equal(generateShadowNoteName(relativePath, 1), 'docs_report.pdf.md');
	assert.equal(generateShadowNoteName(relativePath, 2), 'projects_docs_report.pdf.md');
	assert.equal(generateShadowNoteName(relativePath, 3), null);
});

test('generates a UUID-suffixed name when requested', () => {
	assert.equal(
		generateShadowNoteName('projects/docs/report.pdf', 3, 'file-123'),
		'report.pdf-file-123.md',
	);
});

test('extracts only the first paragraph and joins its lines', () => {
	const { content } = shadowNoteFixtures.standard;

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		'This is a project report. It contains budget information.',
	);
});

test('returns null when the requested heading is absent', () => {
	const { content } = shadowNoteFixtures.missing;

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		null,
	);
});

test('returns null when the target section is empty', () => {
	const { content } = shadowNoteFixtures.empty;

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		null,
	);
});

test('does not take text from a following subheading', () => {
	const { content } = shadowNoteFixtures.subheading;

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		null,
	);
});

test('supports a custom heading name and level', () => {
	const { content } = shadowNoteFixtures.customLevel;

	assert.equal(
		extractFirstParagraphFromHeading(content, 'Description', 3),
		'This summary uses a custom heading.',
	);
	assert.equal(
		extractFirstParagraphFromHeading(content, 'Description'),
		null,
	);
});

test('does not treat heading-like text inside a code fence as a Markdown heading', () => {
	const { content } = shadowNoteFixtures.codeFence;

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		'This is the actual summary.',
	);
});

test('supports CRLF line endings', () => {
	const { content } = shadowNoteFixtures.crlf;

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		'First line. Second line.',
	);
});

test('skips fenced code and extracts the first top-level paragraph', () => {
	const content = [
		'## File Summary',
		'',
		'```cpp',
		'int main() { return 0; }',
		'```',
		'',
		'This **C++** file contains `main()`.',
		'',
		'Another paragraph.',
		'',
		'## Notes',
		'',
		'Other details.',
	].join('\n');

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		'This C++ file contains main().',
	);
});

test('returns null if File Summary contains only fenced code', () => {
	const content = '## File Summary\n\n```ts\nconst x = 1;\n```\n';
	assert.equal(extractFirstParagraphFromHeading(content, 'File Summary'), null);
});

test('skips lists and blockquotes before a top-level paragraph', () => {
	const content = '## File Summary\n\n- One\n- Two\n\n> Quoted text\n\nActual summary.\n';
	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		'Actual summary.',
	);
});

test('stops at the next heading when preceding content is not a paragraph', () => {
	const content = [
		'## File Summary',
		'',
		'```js',
		'const example = true;',
		'```',
		'',
		'## Notes',
		'',
		'This belongs to Notes.',
	].join('\n');

	assert.equal(
		extractFirstParagraphFromHeading(content, 'File Summary'),
		null,
	);
});

test('updates only the requested Markdown section', () => {
    const original = '---\nfile-id: abc\n---\n\n## File Summary\n\nOld\n\n## Notes\n\nKeep\n';
    const updated = updateMarkdownSection(
        original,
        'File Summary',
        'New',
        (section, replacement) => section.replace('Old', replacement),
    );
    assert.equal(updated, original.replace('Old', 'New'));
});

test('updater receives the original section and can leave it unchanged', () => {
    const original = '## File Summary\n\nOriginal\n\n## Notes\n\nKeep\n';
    let received;
    const updated = updateMarkdownSection(original, 'File Summary', 'Original', section => {
        received = section;
        return section;
    });
    assert.equal(received, '\n\nOriginal\n\n');
    assert.equal(updated, original);
});

test('ignores matching heading text inside fenced code blocks', () => {
    const original = [
        '~~~md',
        '## File Summary',
        'Inside code',
        '~~~',
        '',
        '## File Summary',
        '',
        'Real summary',
        '',
    ].join('\n');
    const updated = updateMarkdownSection(
        original, 'File Summary', 'Updated', (section, replacement) => section.replace('Real summary', replacement),
    );
    assert.equal(updated, original.replace('Real summary', 'Updated'));
});

test('does not mistake a fenced-code heading for the next section boundary', () => {
    const original = [
        '## File Summary',
        '',
        'First paragraph',
        '',
        '~~~md',
        '## Notes',
        'Inside code',
        '~~~',
        '',
        'More content',
        '',
        '## Actual Notes',
        '',
        'Keep',
        '',
    ].join('\n');
    let captured;
    const updated = updateMarkdownSection(original, 'File Summary', 'Updated', (section, replacement) => {
        captured = section;
        return section.replace('First paragraph', replacement);
    });
    assert.ok(captured.includes('## Notes\nInside code'));
    assert.equal(updated, original.replace('First paragraph', 'Updated'));
});

test('matches headings by both text and depth', () => {
    const original = '# Overview\n\nRoot\n\n### Notes\n\nOld\n';
    const updated = updateMarkdownSection(
        original, 'Notes', 'New', (section, replacement) => section.replace('Old', replacement), 3,
    );
    assert.equal(updated, original.replace('Old', 'New'));
    assert.equal(updateMarkdownSection(original, 'Notes', '', () => '', 2), original);
});

test('updates only the first matching heading', () => {
    const original = '## Notes\n\nFirst\n\n## Notes\n\nSecond\n';
    const updated = updateMarkdownSection(
        original, 'Notes', 'New', (section, replacement) => section.replace('First', replacement),
    );
    assert.equal(updated, '## Notes\n\nNew\n\n## Notes\n\nSecond\n');
});

test('creates missing sections at the end by default', () => {
    const original = '# Overview\n\nExisting body\n';
    const updated = updateMarkdownSection(original, 'File Summary', 'New summary', (_, replacement) => replacement);
    assert.equal(updated, '# Overview\n\nExisting body\n\n## File Summary\n\nNew summary\n');
});

test('inserts missing section after YAML frontmatter when requested', () => {
    const original = '---\nfile-id: abc\n---\n\n# Overview\n\nExisting body\n';
    const updated = updateMarkdownSection(
        original, 'File Summary', 'New summary', (_, replacement) => '\n' + replacement, 2, 'top',
    );
    assert.equal(
        updated,
        '---\nfile-id: abc\n---\n\n## File Summary\n\nNew summary\n\n# Overview\n\nExisting body\n',
    );
});

test('missing section with blank replacement leaves input untouched', () => {
    const original = '# Overview\n\nKeep\n';
    assert.equal(updateMarkdownSection(original, 'Missing', '  \n', (_, replacement) => replacement), original);
});

test('handles CRLF line endings without converting existing content', () => {
    const original = '---\r\nfile-id: abc\r\n---\r\n\r\n## File Summary\r\n\r\nOld\r\n';
    const updated = updateMarkdownSection(
        original, 'File Summary', 'New', (section, replacement) => section.replace('Old', replacement),
    );
    assert.equal(updated, original.replace('Old', 'New'));
    const appended = updateMarkdownSection(original, 'Notes', 'Content', (_, replacement) => replacement);
    assert.ok(appended.endsWith('## Notes\r\n\r\nContent\r\n'));
});

test('validates heading depth and insert index', () => {
    assert.throws(() => updateMarkdownSection('', 'Notes', 'x', () => 'x', 0), RangeError);
    assert.throws(() => updateMarkdownSection('', 'Notes', 'x', () => 'x', 7), RangeError);
    assert.throws(() => updateMarkdownSection('', 'Notes', 'x', () => 'x', 2.5), RangeError);
    assert.throws(() => insertMarkdownBlock('abc', 'new', -1), RangeError);
    assert.throws(() => insertMarkdownBlock('abc', 'new', 4), RangeError);
    assert.throws(() => insertMarkdownBlock('abc', 'new', 1.5), RangeError);
});

test('insertMarkdownBlock adds spacing without deleting adjacent text', () => {
    assert.equal(insertMarkdownBlock('Before\nAfter', 'Middle', 7),
        'Before\n\nMiddle\n\nAfter');
    assert.equal(insertMarkdownBlock('Before\n\nAfter', 'Middle', 8),
        'Before\n\nMiddle\n\nAfter');
    assert.equal(insertMarkdownBlock('Body', '', 4), 'Body');
    assert.equal(insertMarkdownBlock('', 'New', 0), 'New\n');
});

test('replaceFirstParagraph replaces the first paragraph and retains later paragraphs', () => {
    const section = '\n\nOld summary.\n\nSecond paragraph.\n\n';
    assert.equal(
        replaceFirstParagraph(section, 'New summary.'),
        'New summary.\n\nSecond paragraph.\n\n',
    );
});

test('replaceFirstParagraph removes the first paragraph when replacement is blank', () => {
    const section = '\n\nFirst paragraph.\n\nSecond paragraph.\n';
    assert.equal(
        replaceFirstParagraph(section, '  '),
        '\n\nSecond paragraph.\n',
    );
});

test('replaceFirstParagraph replaces multiline paragraphs without losing subsequent text', () => {
    const section = '\n\nFirst line.\nSecond line.\n\nOther details.\n';
    assert.equal(
        replaceFirstParagraph(section, 'Replacement.'),
        'Replacement.\n\nOther details.\n',
    );
});

test('replaceFirstParagraph returns replacement when no paragraph exists', () => {
    assert.equal(replaceFirstParagraph('', 'New summary.'), 'New summary.');
    assert.equal(replaceFirstParagraph('\n\n', 'New summary.'), 'New summary.');
    assert.equal(replaceFirstParagraph('\n\n', ''), '');
});

test('replaceFirstParagraph normalizes input newlines using section style', () => {
    const section = '\r\n\r\nOld summary.\r\n\r\nSecond paragraph.\r\n';
    assert.equal(
        replaceFirstParagraph(section, ' First line.\nSecond line. '),
        'First line.\r\nSecond line.\r\n\r\nSecond paragraph.\r\n',
    );
});

test('updates an existing File Summary with replaceFirstParagraph', () => {
    const content = '---\nfile-id: abc\n---\n\n## File Summary\n\nOld\n\nExtra details\n\n## Notes\n\nKeep\n';
    const updated = updateMarkdownSection(
        content, 'File Summary', 'New', replaceFirstParagraph,
    );
    assert.equal(
        updated,
        '---\nfile-id: abc\n---\n\n## File Summary\n\nNew\n\nExtra details\n\n## Notes\n\nKeep\n',
    );
});

test('writes into an empty File Summary before the following heading', () => {
    const content = '## File Summary\n\n## Notes\n\nKeep\n';
    const updated = updateMarkdownSection(
        content, 'File Summary', 'New', replaceFirstParagraph,
    );
    assert.equal(updated, '## File Summary\n\nNew\n\n## Notes\n\nKeep\n');
});

test('removing the first summary promotes the second paragraph as agreed', () => {
    const content = '## File Summary\n\nOld\n\nSecond paragraph\n\n## Notes\n\nKeep\n';
    const updated = updateMarkdownSection(
        content, 'File Summary', '', replaceFirstParagraph,
    );
    assert.equal(updated, '## File Summary\n\nSecond paragraph\n\n## Notes\n\nKeep\n');
});

test('preserves CRLF when updating the only existing section', () => {
    const content = '## File Summary\r\n\r\nOld';
    const updated = updateMarkdownSection(
        content, 'File Summary', 'New', replaceFirstParagraph,
    );
    assert.equal(updated, '## File Summary\r\n\r\nNew\r\n');
});

test('creates File Summary at bottom with replaceFirstParagraph', () => {
    const content = '## Notes\n\nKeep';
    const updated = updateMarkdownSection(
        content, 'File Summary', 'New', replaceFirstParagraph,
    );
    assert.equal(updated, '## Notes\n\nKeep\n\n## File Summary\n\nNew\n');
});

test('does not change the document when the updater returns its original section', () => {
    const content = '## File Summary\n\nOriginal\n\n## Notes\n\nKeep\n';
    const updated = updateMarkdownSection(
        content, 'File Summary', 'Original', section => section,
    );
    assert.equal(updated, content);
});
