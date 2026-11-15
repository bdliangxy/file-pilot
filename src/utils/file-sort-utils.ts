
import type { FileRecord } from "../core/file-interface";
import { getFullName } from "./path-utils";

export enum FileSortRule {
	NAME_PREFIX_FIRST = "name-prefix-first",
	PATH_ASC = "path-asc",
}

export interface FileSortContext {
	query?: string;
}

type FileComparator = (
	a: FileRecord,
	b: FileRecord,
	context: FileSortContext,
) => number;

const comparators: Record<FileSortRule, FileComparator> = {
	[FileSortRule.NAME_PREFIX_FIRST]: (a, b, context) => {
		const query = context.query?.trim().toLowerCase() ?? "";

		if (!query) return 0;

		const aMatches = getFullName(a.path)
			.toLowerCase().startsWith(query);
		const bMatches = getFullName(b.path)
			.toLowerCase().startsWith(query);

		return Number(bMatches) - Number(aMatches);
	},

	[FileSortRule.PATH_ASC]: (a, b) =>
		a.path.localeCompare(b.path),
};

export function sortFileRecords(
	records: readonly FileRecord[],
	rules: readonly FileSortRule[],
	context: FileSortContext = {},
): FileRecord[] {
	return [...records].sort((a, b) => {
		for (const rule of rules) {
			const result = comparators[rule](a, b, context);
			if (result !== 0) return result;
		}
		return 0;
	});
}
