import { getFullName } from './path-utils';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { toString } from 'mdast-util-to-string';
import { formatPortalTreeSummary } from './portal-tree-utils';
import { FilePilotError } from '../error';

const markdownParser = unified()
	.use(remarkParse)
	.use(remarkFrontmatter);

export function generateShadowNoteName(
	relativePath: string,
	parentCount: number,
	id?: string,
): string | null {
	if (id !== undefined) {
		return `${getFullName(relativePath)}-${id}.md`;
	}

	const parts = relativePath.split('/');

	if (parentCount >= parts.length) {
		return null;
	}

	const name = parts
		.slice(-(parentCount + 1))
		.join('_');

	return `${name}.md`;
}

/**
 * Find the unique File Pilot tree code block in a Markdown section.
 */
function findPortalTreeBlock(section: string) {
	const nodes = markdownParser.parse(section).children;

	const treeBlocks = nodes.filter(
		node =>
			node.type === 'code' &&
			node.lang === 'file-pilot-tree',
	);

	// Never guess which block to select.
	if (treeBlocks.length > 1) {
		throw new FilePilotError(
			'PORTAL_NOTE_MULTIPLE_TREE_BLOCKS',
			'Multiple File Pilot tree code blocks found',
		);
	}

	return treeBlocks[0];
}

export function extractFirstParagraphFromHeading(
	content: string,
	headingName: string,
	headingLevel = 2,
): string | null {
	// Parse the Markdown document into an AST.
	const nodes = markdownParser.parse(content).children;

	// Find the target heading.
	const targetIndex = nodes.findIndex(
		node =>
			node.type === 'heading' &&
			node.depth === headingLevel &&
			toString(node) === headingName
	);

	if (targetIndex === -1) {
		return null;
	}

	// Search for the first paragraph within the section.
	for (let i = targetIndex + 1; i < nodes.length; i++) {
		const node = nodes[i];
		if (!node) {
			continue;
		}
		// Stop at the next heading or thematic break.
		if (
			node.type === 'heading' ||
			node.type === 'thematicBreak'
		) {
			break;
		}

		// Skip code blocks, lists, blockquotes, and other nodes.
		if (node.type !== 'paragraph') {
			continue;
		}

		// Extract plain text from the paragraph.
		const paragraph = toString(node)
			.replace(/\s+/g, ' ')
			.trim();

		if (paragraph) {
			return paragraph;
		}
	}

	return null;
}


/**
 * Updates the content of a Markdown section.
 *
 * The updater receives the raw content between headings,
 * including its surrounding line breaks.
 *
 * Creates the heading if it does not exist and the
 * updated content is non-empty.
 */
export function updateMarkdownSection(
	content: string,
	headingName: string,
	newParagraph: string,
	updater: (oldSection: string, newParagraph: string) => string,
	headingLevel = 2,
	insertPosition: 'top' | 'bottom' = 'bottom',
): string {
	if (
		!Number.isInteger(headingLevel) ||
		headingLevel < 1 ||
		headingLevel > 6
	) {
		throw new RangeError('Invalid heading level');
	}

	const eol = content.includes('\r\n') ? '\r\n' : '\n';
	const marker = '#'.repeat(headingLevel);

	// Parse headings from the current Markdown content.
	const headings = markdownParser
		.parse(content)
		.children
		.filter(node => node.type === 'heading');

	// Find the first heading match the name and level.
	const targetHeading = headings.find(
		node =>
			node.depth === headingLevel &&
			toString(node) === headingName,
	);

	// Create a new section when the heading is missing.
	if (!targetHeading) {
		const sectionBody = updater('', newParagraph);

		if (!sectionBody.trim()) {
			return content;
		}
		const newBlock =
			`${marker} ${headingName}` +
			eol + eol +
			//If the updater provides a newline character at the beginning, discard it.
			sectionBody.replace(/^(?:\r?\n)*/, '');
		let insertIndex = content.length;

		if (insertPosition === 'top') {
			const frontmatterPattern =
				/^(?:\uFEFF)?---[ \t]*\r?\n(?:[^\r\n]*\r?\n)*?---[ \t]*(?:\r?\n|$)/;

			const frontmatter = frontmatterPattern.exec(content);

			insertIndex = frontmatter
				? frontmatter[0].length
				: 0;
		}
		return insertMarkdownBlock(
			content,
			newBlock,
			insertIndex,
		);
	}

	const sectionStart = targetHeading.position?.end.offset;

	if (sectionStart === undefined) {
		throw new Error('Missing target heading position');
	}

	// Find the next actual Markdown heading.
	const nextHeading = headings.find(
		node =>
			(node.position?.start.offset ?? -1) > sectionStart,
	);

	const sectionEnd =
		nextHeading?.position?.start.offset ?? content.length;

	if (sectionStart > sectionEnd) {
		throw new Error('Invalid Markdown section range');
	}

	const oldSection = content.slice(
		sectionStart,
		sectionEnd,
	);

	const newSection = updater(oldSection, newParagraph);

	// Avoid modifying the document when nothing has changed.
	if (newSection === oldSection) {
		return content;
	}

	// Remove the old section body.
	const remainingContent =
		content.slice(0, sectionStart) +
		content.slice(sectionEnd);

	// Insert the updated body and normalize adjacent line breaks.
	return insertMarkdownBlock(
		remainingContent,
		newSection || eol + eol,
		sectionStart,
	).replace(/\r\n|\r|\n/g, eol);
}


/**
 * Inserts a Markdown block at the specified position.
 *
 * Ensures at least one blank line between adjacent
 * non-empty blocks without removing existing whitespace.
 */
export function insertMarkdownBlock(
	content: string,
	block: string,
	insertIndex: number,
): string {
	if (
		!Number.isInteger(insertIndex) ||
		insertIndex < 0 ||
		insertIndex > content.length
	) {
		throw new RangeError('Invalid insert index');
	}

	if (!block) {
		return content;
	}

	const eol = content.includes('\r\n') ? '\r\n' : '\n';

	const countNewlines = (text: string): number =>
		(text.match(/\r\n|\n/g) ?? []).length;

	// Join two blocks with at least one blank line.
	const joinBlocks = (
		left: string,
		right: string,
	): string => {
		if (!left || !right) {
			return left + right;
		}

		const trailing =
			left.match(/(?:(?:\r\n|\n)[ \t]*)*$/)?.[0] ?? '';

		const leading =
			right.match(/^(?:[ \t]*(?:\r\n|\n))*/)?.[0] ?? '';

		const existingNewlines =
			countNewlines(trailing) +
			countNewlines(leading);

		const missingNewlines =
			Math.max(0, 2 - existingNewlines);

		return (
			left +
			eol.repeat(missingNewlines) +
			right
		);
	};

	const before = content.slice(0, insertIndex);
	const after = content.slice(insertIndex);

	const result = joinBlocks(
		joinBlocks(before, block),
		after,
	);

	// Ensure a final line break when appending.
	if (!after && !result.endsWith('\n')) {
		return result + eol;
	}

	return result;
}


/**
 * Replaces the first Markdown paragraph with new text.
 *
 * Preserves all content following the first paragraph.
 * When no paragraph exists, inserts one at the beginning.
 * An empty replacement removes the first paragraph.
 */
export function replaceFirstParagraph(
	content: string,
	newParagraph: string,
): string {
	const eol = content.includes('\r\n') ? '\r\n' : '\n';

	const replacement = newParagraph
		.trim()
		.replace(/\r\n|\r|\n/g, eol);

	// Locate the first paragraph or thematic break.
	const firstNode = markdownParser
		.parse(content)
		.children
		.find(node =>
			node.type === 'paragraph' ||
			node.type === 'thematicBreak'
		);

	// Insert a new summary before the thematic break.
	if (firstNode?.type === 'thematicBreak') {
		return replacement
			? insertMarkdownBlock(content, replacement, 0)
			: content;
	}

	const paragraph = firstNode;

	if (paragraph) {
		const end = paragraph.position?.end.offset;

		if (end === undefined) {
			throw new Error('Missing paragraph position');
		}

		return (
			replacement +
			content.slice(end)
		);
	}

	return (replacement);
}


/**
 * Replace the File Pilot tree code fence within a Markdown section.
 * Preserve all content outside the target code fence.
 */
export function replacePortalTreeFence(
	oldSection: string,
	newTreeBlock: string,
): string {
	const target = findPortalTreeBlock(oldSection);

	// Insert a tree block when the section has none.
	if (!target) {
		return insertMarkdownBlock(
			oldSection,
			newTreeBlock,
			0,
		);
	}

	const start = target.position?.start.offset;
	const end = target.position?.end.offset;

	if (start === undefined || end === undefined) {
		throw new Error('Missing tree code block position');
	}

	// Replace only the code fence, preserving surrounding text.
	return (
		oldSection.slice(0, start) +
		newTreeBlock +
		oldSection.slice(end)
	);
}

export function updatePortalTreeSummary(
	content: string,
	headingName: string,
	reference: string,
	summary: string | null,
): string {
	const nodes = markdownParser.parse(content).children;

	// Find the target Directory Tree heading.
	const heading = nodes.find(
		node =>
			node.type === 'heading' &&
			node.depth === 2 &&
			toString(node) === headingName,
	);

	if (!heading) {
		return content;
	}

	const sectionStart = heading.position?.end.offset;

	if (sectionStart === undefined) {
		throw new Error('Missing target heading position');
	}

	// Find the end of the target section.
	const nextHeading = nodes.find(
		node =>
			node.type === 'heading' &&
			(node.position?.start.offset ?? -1) > sectionStart,
	);

	const sectionEnd =
		nextHeading?.position?.start.offset ?? content.length;

	if (sectionStart > sectionEnd) {
		throw new Error('Invalid Markdown section range');
	}

	// Extract the target section.
	const section = content.slice(sectionStart, sectionEnd);

	// Find the unique managed tree block.
	const treeBlock = findPortalTreeBlock(section);

	if (!treeBlock) {
		return content;
	}

	const start = treeBlock.position?.start.offset;
	const end = treeBlock.position?.end.offset;

	if (start === undefined || end === undefined) {
		throw new Error('Missing tree code block position');
	}

	const block = section.slice(start, end);

	// Preserve original line endings.
	const parts = block.split(/(\r\n|\n|\r)/);

	let targetIndex = -1;
	let targetPrefix = '';

	for (let i = 0; i < parts.length; i += 2) {
		const line = parts[i] ?? '';

		const match =
			/^((?:│ {3}| {4})*(?:├── |└── ))(.*)$/.exec(line);

		if (!match) {
			continue;
		}

		const prefix = match[1];
		const label = match[2];

		if (
			prefix === undefined ||
			label === undefined
		) {
			continue;
		}

		if (
			label !== reference &&
			!label.startsWith(`${reference}  # `)
		) {
			continue;
		}

		if (targetIndex !== -1) {
			throw new Error(
				`Duplicate Portal Tree reference: ${reference}`,
			);
		}

		targetIndex = i;
		targetPrefix = prefix;
	}

	if (targetIndex === -1) {
		return content;
	}

	// Apply the same length limit as full tree rendering.
	const formattedSummary = formatPortalTreeSummary(summary);

	const annotation = formattedSummary !== null
		? `  # ${formattedSummary}`
		: '';

	const updatedLine =
		`${targetPrefix}${reference}${annotation}`;

	if (parts[targetIndex] === updatedLine) {
		return content;
	}

	parts[targetIndex] = updatedLine;

	const updatedBlock = parts.join('');

	const updatedSection =
		section.slice(0, start) +
		updatedBlock +
		section.slice(end);

	return (
		content.slice(0, sectionStart) +
		updatedSection +
		content.slice(sectionEnd)
	);
}
