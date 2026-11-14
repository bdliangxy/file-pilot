
import type {
	FileReferenceLookupResult,
} from "../core/file-reference-service";
import { getFullName } from "../utils/path-utils";
import { t } from "../i18n";

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

		case "ambiguous":
			return {
				text: t("fileReferenceAmbiguous"),
				unresolved: true,
				hint: t("fileReferenceAmbiguousHint"),
			};

		case "found": {
			const fileName = getFullName(result.record.path);

			return {
				text: result.record.status === "missing"
					? `${fileName} (${t("fileStatusMissing")})`
					: fileName,
				unresolved: false,
			};
		}
	}
}
