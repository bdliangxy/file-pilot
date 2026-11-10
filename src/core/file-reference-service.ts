
import type { FileRecord } from "./file-interface";
import {
	generateShortKey,
	parseFileReference,
} from "../utils/file-reference-utils";

// found:     The matching file was found.
// missing:   The reference format is valid, but no such record exists.
// ambiguous: The short key is ambiguous (collision).
export type ShortKeyLookupResult =
	| { kind: "found"; record: FileRecord }
	| { kind: "missing" }
	| { kind: "ambiguous" };

// invalid:   The reference syntax is invalid.
export type FileReferenceLookupResult =
	| ShortKeyLookupResult
	| { kind: "invalid" };

export class FileReferenceService {
	// keyIndex: Look up FileRecord by short key and handle collisions.
	private keyIndex = new Map<string, FileRecord | null>();
	// idIndex: Look up FileRecord by full UUID.
	private idIndex = new Map<string, FileRecord>();

	// Rebuild the in-memory index from current FileRecords.
	rebuildReferenceIndex(records: readonly FileRecord[]): void {
		const nextKeyIndex = new Map<string, FileRecord | null>();
		const nextIdIndex = new Map<string, FileRecord>();

		for (const record of records) {
			const key = generateShortKey(record.id);

			// Build the UUID lookup index.
			nextIdIndex.set(record.id.toLowerCase(), record);

			// Build the short-key lookup index.
			if (nextKeyIndex.has(key)) {
				nextKeyIndex.set(key, null);
			} else {
				nextKeyIndex.set(key, record);
			}
		}

		this.keyIndex = nextKeyIndex;
		this.idIndex = nextIdIndex;
	}


	// Resolve a short key without selecting an ambiguous record.
	resolveShortKey(key: string): ShortKeyLookupResult {
		const record = this.keyIndex.get(key);

		if (record === undefined) {
			return { kind: "missing" };
		}

		if (record === null) {
			return { kind: "ambiguous" };
		}

		return {
			kind: "found",
			record,
		};
	}

	resolveFileId(id: string): FileRecord | undefined {
		return this.idIndex.get(id.toLowerCase());
	}


	resolveFileReference(text: string): FileReferenceLookupResult {
		const reference = parseFileReference(text);

		if (reference === null) {
			return { kind: "invalid" };
		}

		switch (reference.kind) {
			case "short":
				return this.resolveShortKey(reference.key);

			case "full": {
				const record = this.resolveFileId(reference.id);

				return record === undefined
					? { kind: "missing" }
					: { kind: "found", record };
			}
		}
	}


}

