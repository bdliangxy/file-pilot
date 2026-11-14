
import type { App, HoverParent } from "obsidian";
import type { FileRecord } from "../core/file-interface";
import { FileReferenceService } from "../core/file-reference-service";
import type { FileItemOpenAction } from "../utils/file-item-gestures";
import { resolveFileItemAction } from "../utils/file-item-gestures";
import { notifyFileActionError } from "./file-action-error-notifier";
import type { FileReferenceDisplay } from "./file-reference-display";

export const FILE_REFERENCE_HOVER_SOURCE = "file-pilot";

export type ExecuteFileReferenceAction = (
	action: FileItemOpenAction,
	record: FileRecord,
) => Promise<void>;

interface FileReferenceElementOptions {
	app: App;
	references: FileReferenceService;
	executeAction: ExecuteFileReferenceAction;
	raw: string;
	display: FileReferenceDisplay;
	selected?: boolean;
}

// Create a shared interactive element for both
// Reading Mode and Live Preview.
export function createFileReferenceElement({
	app,
	references,
	executeAction,
	raw,
	display,
	selected = false,
}: FileReferenceElementOptions): HTMLElement {
	const element = createSpan({
		cls: "file-pilot-reference",
	});

	element.textContent = display.text;
	element.contentEditable = "false";
	element.spellcheck = false;

	if (display.unresolved) {
		element.classList.add(
			"file-pilot-reference-unresolved",
		);
	}

	if (display.hint !== undefined) {
		element.title = display.hint;
	}

	if (selected) {
		element.classList.add(
			"file-pilot-reference-selected",
		);
	}

	// Maintain a stable parent for the preview lifecycle.
	const hoverParent: HoverParent = {
		hoverPopover: null,
	};

	element.addEventListener("mouseover", (event) => {
		const current = references.resolveFileReference(raw);

		if (current.kind !== "found") {
			return;
		}

		const note = app.vault.getFileByPath(
			current.record.shadowNotePath,
		);

		if (!note) {
			return;
		}

		app.workspace.trigger("hover-link", {
			event,
			source: FILE_REFERENCE_HOVER_SOURCE,
			hoverParent,
			targetEl: element,
			linktext: note.path,
			sourcePath: "",
		});
	});

	const runAction = (action: FileItemOpenAction): void => {
		// Resolve again to avoid using stale FileRecords.
		const current = references.resolveFileReference(raw);

		if (current.kind !== "found") {
			return;
		}

		// A missing source only permits opening its Shadow Note.
		if (
			current.record.status === "missing" &&
			action !== "openShadowNote"
		) {
			return;
		}

		void executeAction(action, current.record)
			.catch((error: unknown) => {
				notifyFileActionError(
					error,
					action,
					current.record,
				);
			});
	};

	for (const type of ["click", "dblclick", "auxclick"] as const) {
		element.addEventListener(type, (event) => {
			const action = resolveFileItemAction(event);

			if (action === null || action === "editSummary") {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			runAction(action);
		});
	}

	return element;
}
