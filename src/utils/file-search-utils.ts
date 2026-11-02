
import type { FileRecord } from '../core/file-interface';
import { unifyPathFormat } from './path-utils';

export interface FileSearchCriteria {
	query: string;
}

export function searchFileRecords(
	records: readonly FileRecord[],
	criteria: FileSearchCriteria,
): FileRecord[] {
	// Normalize the search query.
	const query = unifyPathFormat(
		criteria.query.trim(),
	).toLowerCase();

	// An empty query matches all records.
	if (query === '') {
		return [...records];
	}

	// Match against the relative file path.
	return records.filter(record =>
		record.path.toLowerCase().includes(query)
	);
}
