import { getFullName } from './path-utils';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { toString } from 'mdast-util-to-string';

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
		// Stop at the next heading.
		if (node.type === 'heading') {
			break;
		}

		// Skip code blocks, lists, blockquotes, and other nodes.
		if (node.type !== 'paragraph') {
			continue;
		}

		// Extract plain text from the paragraph.
		const paragraph = toString(node)
			.replace(/\r?\n/g, ' ')
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

	// Locate the first Markdown paragraph.
	const paragraph = markdownParser
		.parse(content)
		.children
		.find(node => node.type === 'paragraph');

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

