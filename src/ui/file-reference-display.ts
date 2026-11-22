
import type {
	FileReferenceLookupResult,
} from "../core/file-reference-service";
import { getFullName } from "../utils/path-utils";
import { t } from "../i18n";
import path from "node:path";

export interface FileReferenceDisplay {
	text: string;
	unresolved: boolean;
	hint?: string;
}

// Convert a reference lookup result into shared display information.
export function getFileReferenceDisplay(
	result: FileReferenceLookupResult,
): FileReferenceDisplay | null {
	switch (result.kind) {
		case "invalid":
			return null;

		case "missing":
			return {
				text: t("fileReferenceNotFound"),
				unresolved: true,
				hint: t("fileReferenceNotFoundHint"),
			};

		case "found": {

			const fileName = getFullName(result.record.path);
			const displayName = result.record.kind === "folder"
				? `${fileName}${path.sep}`
				: fileName;


			return {

				text: result.record.status === "missing"
					? `${displayName} (${t("fileStatusMissing")})`
					: displayName,
				unresolved: false,
			};
		}
	}
}
