
import { createHash } from "node:crypto";

const SHORT_KEY_LENGTH = 12;
export type ParsedFileReference =
	| { kind: "short"; key: string }
	| { kind: "full"; id: string };

// Validate a complete short reference with a 12-character key.
const SHORT_REFERENCE_PATTERN =
	/^\|\|\|@([A-Za-z0-9_-]{12})\|\|\|$/;

// Validate a complete full reference containing a UUID.
const FULL_REFERENCE_PATTERN =
	/^\|\|\|!([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|\|\|$/i;

// Find reference candidates in text, excluding extra pipes and line breaks.
// Candidates must be validated by parseFileReference().
const REFERENCE_CANDIDATE_PATTERN =
	/(?<!\|)\|\|\|[^|\r\n]*\|\|\|(?!\|)/g;
export function generateShortKey(id: string): string {
	// convert long id to short key
	const normalizedId = id.toLowerCase();

	return createHash("sha256")
		.update(normalizedId, "utf8")
		.digest("base64url")
		.slice(0, SHORT_KEY_LENGTH);
}

export function parseFileReference(
	text: string,
): ParsedFileReference | null {
	const normalizedText = text.trim();
	const shortMatch = SHORT_REFERENCE_PATTERN.exec(normalizedText);

	if (shortMatch?.[1] !== undefined) {
		return {
			kind: "short",
			key: shortMatch[1],
		};
	}

	const fullMatch = FULL_REFERENCE_PATTERN.exec(normalizedText);

	if (fullMatch?.[1] !== undefined) {
		return {
			kind: "full",
			id: fullMatch[1].toLowerCase(),
		};
	}

	return null;
}

export interface FileReferenceMatch {
	raw: string;
	start: number;
	end: number;
}

export function findFileReferenceMatches(
	text: string,
): FileReferenceMatch[] {
	const results: FileReferenceMatch[] = [];

	for (const match of text.matchAll(REFERENCE_CANDIDATE_PATTERN)) {
		const raw = match[0];

		if (parseFileReference(raw) === null) {
			continue;
		}

		const start = match.index;

		results.push({
			raw,
			start,
			end: start + raw.length,
		});
	}

	return results;
}
