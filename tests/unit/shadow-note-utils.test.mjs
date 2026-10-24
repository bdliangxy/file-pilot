import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

import { shadowNoteFixtures } from '../fixtures/shadow-notes.mjs';

const jiti = createJiti(import.meta.url);
const {
	generateShadowNoteName,
	extractFirstParagraphFromHeading,
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
	const { content, headings } = shadowNoteFixtures.standard;

	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'File Summary'),
		'This is a project report. It contains budget information.',
	);
});

test('returns null when the requested heading is absent', () => {
	const { content, headings } = shadowNoteFixtures.missing;

	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'File Summary'),
		null,
	);
});

test('returns null when the target section is empty', () => {
	const { content, headings } = shadowNoteFixtures.empty;

	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'File Summary'),
		null,
	);
});

test('does not take text from a following subheading', () => {
	const { content, headings } = shadowNoteFixtures.subheading;

	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'File Summary'),
		null,
	);
});

test('supports a custom heading name and level', () => {
	const { content, headings } = shadowNoteFixtures.customLevel;

	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'Description', 3),
		'This summary uses a custom heading.',
	);
	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'Description'),
		null,
	);
});

test('uses metadata headings rather than heading-like text in code fences', () => {
	const { content, headings } = shadowNoteFixtures.codeFence;

	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'File Summary'),
		'This is the actual summary.',
	);
});

test('supports CRLF line endings', () => {
	const { content, headings } = shadowNoteFixtures.crlf;

	assert.equal(
		extractFirstParagraphFromHeading(content, headings, 'File Summary'),
		'First line. Second line.',
	);
});

test('rejects source positions outside the Markdown document', () => {
	const { content, headings } = shadowNoteFixtures.standard;
	const target = headings.find(h => h.heading === 'File Summary');
	assert.ok(target);

	const invalidHeadings = [{
		...target,
		position: {
			...target.position,
			end: {
				...target.position.end,
				offset: content.length + 1,
			},
		},
	}];

	assert.equal(
		extractFirstParagraphFromHeading(content, invalidHeadings, 'File Summary'),
		null,
	);
});
