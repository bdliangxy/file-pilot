
import { Notice } from "obsidian";
import type { FileRecord } from "../core/file-interface";
import { FilePilotError } from "../error";
import { t } from "../i18n";
import type { FileItemOpenAction } from "../utils/file-item-gestures";

/**
 * Report a failed file action and show a localized notice.
 */
export function notifyFileActionError(
	error: unknown,
	action: FileItemOpenAction,
	record: FileRecord,
): void {
	console.error(
		"File item action failed:",
		action,
		record.path,
		error,
	);

	let message = t("fileActionFailed");

	if (error instanceof FilePilotError) {
		switch (error.code) {
			case "SOURCE_FILE_NOT_FOUND":
				message = t("sourceFileNotFound");
				break;

			case "SHADOW_NOTE_NOT_FOUND":
				message = t("shadowNoteNotFound");
				break;

			case "FILE_OPEN_FAILED":
				if (action === "openShadowNote") {
					message = t("shadowNoteOpenFailed");
				} else if (
					action === "openContainingFolder" ||
					record.kind === "folder"
				) {
					message = t("folderOpenFailed");
				} else {
					message = t("sourceFileOpenFailed");
				}
				break;
		}
	}

	new Notice(message);
}
