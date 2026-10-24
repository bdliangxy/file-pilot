import { getFullName } from './path-utils';
import type { HeadingCache } from 'obsidian';

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
	headings: readonly HeadingCache[],
	headingName: string,
	headingLevel = 2,
): string | null {
	// Find the target heading.
	const target = headings.find(
		h =>
			h.level === headingLevel &&
			h.heading === headingName
	);

	if (!target) {
		return null;
	}

	// Find the next heading after the target.
	const next = headings.find(
		h =>
			h.position.start.offset >
			target.position.start.offset
	);

	const start = target.position.end.offset;
	const end = next?.position.start.offset ?? content.length;

	// Reject invalid source ranges.
	if (start > end || end > content.length) {
		return null;
	}

	// Extract the text between headings.
	const section = content.slice(start, end).trim();

	// Extract the first non-empty paragraph.
	const paragraph = section
		.split(/\r?\n[ \t]*\r?\n/, 1)[0]
		?.replace(/\r?\n/g, ' ')
		.trim();

	return paragraph || null;
}
