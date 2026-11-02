
import type { Ignore } from 'ignore';
import type { FileRecord } from '../core/file-interface';

import {
	getDisplayStatus,
	type FileDisplayStatus,
} from './ignore-rule-utils';

export interface FileFilterCriteria {
	status: FileDisplayStatus | 'all';
}

export function filterFileRecords(
	records: readonly FileRecord[],
	matcher: Ignore,
	criteria: FileFilterCriteria,
): FileRecord[] {
	// Return all records when no status filter is selected.
	if (criteria.status === 'all') {
		return [...records];
	}

	return records.filter(record =>
		getDisplayStatus(record, matcher) === criteria.status
	);
}
