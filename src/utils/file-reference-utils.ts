
import { createHash } from "node:crypto";

const SHORT_KEY_LENGTH = 12;
export type ParsedFileReference =
	| { kind: "short"; key: string }
	| { kind: "full"; id: string };

const SHORT_REFERENCE_PATTERN =
	/^\|\|\|@([A-Za-z0-9_-]{12})\|\|\|$/;

const FULL_REFERENCE_PATTERN =
	/^\|\|\|!([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|\|\|$/i;
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
