import { getRelativeFilePath } from './path-utils';

export type IgnoreRuleCategory =
	| 'directories'
	| 'filenames'
	| 'extensions';

import type { Ignore } from 'ignore';
import type { FileRecord } from '../core/file-interface';

export const MAX_EXTENSION_LENGTH = 64;

export function inputIsValidExtension(extension: string): boolean {
	return (
		extension.length <= MAX_EXTENSION_LENGTH &&
		/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(extension)
	);
}

export function classifyIgnorePattern(
	pattern: string,
): IgnoreRuleCategory | null {
	// Skip empty lines, comments, and negation rules.
	if (
		pattern.trim() === '' ||
		pattern.startsWith('#') ||
		pattern.startsWith('!')
	) {
		return null;
	}

	// Remove supported literal escapes before detecting complex syntax.
	const simplifiedPattern = pattern.replace(
		/\\[\\*?!#[\] ]/g,
		'',
	);

	const hasSpecialSyntax =
		/[\\*?[\]]/.test(simplifiedPattern);

	// A trailing slash indicates a directory rule.
	if (pattern.endsWith('/') && !hasSpecialSyntax) {
		return 'directories';
	}

	// Recognize simple and compound extension patterns.
	if (
		/^\*\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(pattern)
	) {
		return 'extensions';
	}

	// Recognize simple name-based patterns.
	if (!hasSpecialSyntax && !pattern.endsWith('/')) {
		return 'filenames';
	}

	return null;
}

export function escapeGitignorePath(relativePath: string): string {
	return relativePath
		// Escape Gitignore metacharacters as literal characters.
		.replace(/[\\*?!#[\]]/g, '\\$&')
		// Preserve trailing spaces in filenames.
		.replace(/ +$/, (spaces) => '\\ '.repeat(spaces.length));
}

export function createSelectedIgnorePattern(
	rootPath: string,
	selectedPath: string,
	category: 'directories' | 'filenames',
): string {
	// Convert the absolute path to a normalized relative path.
	const relativePath = getRelativeFilePath(
		rootPath,
		selectedPath,
	);

	const escapedPath = escapeGitignorePath(relativePath);

	// Anchor the rule to the scan root.
	const prefix = '/';

	// Directory rules require a trailing slash.
	const suffix = category === 'directories' ? '/' : '';

	return `${prefix}${escapedPath}${suffix}`;
}

export type FileDisplayStatus =
	FileRecord['status'] | 'ignored';

export function getDisplayStatus(
	record: Pick<FileRecord, 'path' | 'status'>,
	matcher: Ignore,
): FileDisplayStatus {
	return matcher.ignores(record.path)
		? 'ignored'
		: record.status;
}
