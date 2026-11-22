
import type { FileRecord } from "./file-interface";
import {
	parseFileReference,
} from "../utils/file-reference-utils";

// found:     The matching file was found.
// missing:   The reference format is valid, but no such record exists.
// invalid:   The reference syntax is invalid.
export type FileReferenceLookupResult =
	| { kind: "found"; record: FileRecord }
	| { kind: "missing" }
	| { kind: "invalid" };

export class FileReferenceService {
	// Look up FileRecords by their case-sensitive IDs.
	private idIndex = new Map<string, FileRecord>();

	private readonly indexChangedListeners = new Set<() => void>();

	// Subscribe to reference index changes.
	onIndexChanged(listener: () => void): () => void {
		this.indexChangedListeners.add(listener);

		// Return an unsubscribe function.
		return () => {
			this.indexChangedListeners.delete(listener);
		};
	}

	// Rebuild the index without silently overwriting duplicate IDs.
	rebuildReferenceIndex(records: readonly FileRecord[]): void {
		const nextIndex = new Map<string, FileRecord>();

		for (const record of records) {
			if (nextIndex.has(record.id)) {
				throw new Error(`Duplicate FileRecord ID: ${record.id}`);
			}

			nextIndex.set(record.id, record);
		}

		this.idIndex = nextIndex;

		for (const listener of this.indexChangedListeners) {
			listener();
		}
	}

	// Resolve a FileRecord by its stable ID.
	resolveFileId(id: string): FileRecord | undefined {
		return this.idIndex.get(id);
	}


	// Parse a reference and resolve its FileRecord.
	resolveFileReference(text: string): FileReferenceLookupResult {
		const reference = parseFileReference(text);

		if (reference === null) {
			return { kind: "invalid" };
		}

		const record = this.resolveFileId(reference.id);

		return record === undefined
			? { kind: "missing" }
			: { kind: "found", record };
	}


	// Format a reference for an indexed FileRecord.
	formatFileReference(id: string): string | null {
		if (!this.idIndex.has(id)) {
			return null;
		}

		return `|||@${id}|||`;
	}

}

