// Static Markdown documents and heading-cache snapshots used in Shadow Note tests.
// Offsets are derived from each document so changes to the text keep positions aligned.
function headingAt(content, heading, level = 2, occurrence = 'first') {
	const headingLine = `${'#'.repeat(level)} ${heading}`;
	const offset = occurrence === 'last'
		? content.lastIndexOf(headingLine)
		: content.indexOf(headingLine);

	if (offset < 0) {
		throw new Error(`Missing heading in fixture: ${headingLine}`);
	}

	const line = content.slice(0, offset).split(/\r?\n/).length - 1;
	return {
		heading,
		level,
		position: {
			start: { line, col: 0, offset },
			end: {
				line,
				col: headingLine.length,
				offset: offset + headingLine.length,
			},
		},
	};
}

const standardContent = [
	'---',
	'file-id: file-123',
	'---',
	'',
	'# Project',
	'',
	'## File Summary',
	'',
	'This is a project report.',
	'It contains budget information.',
	'',
	'This second paragraph should be ignored.',
	'',
	'## Notes',
	'Other information.',
].join('\n');

const emptyContent = [
	'## File Summary',
	'',
	'   ',
	'## Notes',
	'The notes are not a summary.',
].join('\n');

const subheadingContent = [
	'## File Summary',
	'',
	'### Details',
	'This belongs to the subheading, not the summary.',
	'',
	'## Notes',
	'Other information.',
].join('\n');

const missingContent = [
	'## Notes',
	'This document has no summary.',
].join('\n');

const customLevelContent = [
	'## Document',
	'',
	'### Description',
	'',
	'This summary uses a custom heading.',
	'',
	'### Details',
	'Other details.',
].join('\n');

const codeFenceContent = [
	'## Notes',
	'',
	'```md',
	'## File Summary',
	'This is only an example inside a code block.',
	'```',
	'',
	'## File Summary',
	'',
	'This is the actual summary.',
].join('\n');

const crlfContent = [
	'## File Summary',
	'',
	'First line.',
	'Second line.',
	'',
	'Second paragraph.',
].join('\r\n');

export const shadowNoteFixtures = {
	standard: {
		content: standardContent,
		headings: [
			headingAt(standardContent, 'Project', 1),
			headingAt(standardContent, 'File Summary'),
			headingAt(standardContent, 'Notes'),
		],
	},
	empty: {
		content: emptyContent,
		headings: [
			headingAt(emptyContent, 'File Summary'),
			headingAt(emptyContent, 'Notes'),
		],
	},
	subheading: {
		content: subheadingContent,
		headings: [
			headingAt(subheadingContent, 'File Summary'),
			headingAt(subheadingContent, 'Details', 3),
			headingAt(subheadingContent, 'Notes'),
		],
	},
	missing: {
		content: missingContent,
		headings: [headingAt(missingContent, 'Notes')],
	},
	customLevel: {
		content: customLevelContent,
		headings: [
			headingAt(customLevelContent, 'Document'),
			headingAt(customLevelContent, 'Description', 3),
			headingAt(customLevelContent, 'Details', 3),
		],
	},
	codeFence: {
		content: codeFenceContent,
		// Obsidian's MetadataCache does not treat headings inside code fences as real headings.
		headings: [
			headingAt(codeFenceContent, 'Notes'),
			headingAt(codeFenceContent, 'File Summary', 2, 'last'),
		],
	},
	crlf: {
		content: crlfContent,
		headings: [headingAt(crlfContent, 'File Summary')],
	},
};
