
export type ParsedFileReference = {
	id: string;
}

// Match a reference containing a 12-character FileRecord ID.
const FILE_REFERENCE_PATTERN =
	/^\|\|\|@([A-Za-z0-9_-]{12})\|\|\|$/;

// Find reference candidates in text, excluding extra pipes and line breaks.
// Candidates must be validated by parseFileReference().
const REFERENCE_CANDIDATE_PATTERN =
	/(?<!\|)\|\|\|[^|\r\n]*\|\|\|(?!\|)/g;

// Parse a reference and preserve the ID's case.
export function parseFileReference(
	text: string,
): ParsedFileReference | null {
	const match = FILE_REFERENCE_PATTERN.exec(text.trim());

	if (match?.[1] === undefined) {
		return null;
	}

	return { id: match[1] };
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
