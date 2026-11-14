
import type { FileRecord } from "../core/file-interface";
import type { FileItemOpenAction } from "../utils/file-item-gestures";
import { FileReferenceService } from "../core/file-reference-service";
import { resolveFileItemAction } from "../utils/file-item-gestures";
import { findFileReferenceMatches } from "../utils/file-reference-utils";
import { logger } from "../utils/logger";
import { notifyFileActionError } from "./file-action-error-notifier";
import { getFileReferenceDisplay } from "./file-reference-display";
import type { App, HoverParent } from "obsidian";

export const FILE_REFERENCE_HOVER_SOURCE = "file-pilot";

type ExecuteAction = (
	action: FileItemOpenAction,
	record: FileRecord,
) => Promise<void>;

export class FileReferenceReadingRenderer {
	private readonly loggedUnresolvedReferences = new Set<string>();
	constructor(
		private readonly app: App,
		private readonly references: FileReferenceService,
		private readonly executeAction: ExecuteAction,
	) { }

	render(container: HTMLElement): void {
		const walker = document.createTreeWalker(
			container,
			NodeFilter.SHOW_TEXT,
		);

		const textNodes: Text[] = [];

		while (walker.nextNode()) {
			const node = walker.currentNode as Text;

			// Skip code, links, and already rendered references.
			if (
				node.parentElement?.closest(
					"pre, code, a, .file-pilot-reference",
				)
			) {
				continue;
			}

			if (node.data.includes("|||")) {
				textNodes.push(node);
			}
		}

		for (const node of textNodes) {
			this.renderTextNode(node);
		}
	}

	private renderTextNode(node: Text): void {
		const source = node.data;
		const matches = findFileReferenceMatches(source);
		if (matches.length === 0) {
			return;
		}

		const fragment = createFragment();
		let offset = 0;

		for (const match of matches) {
			const start = match.start;
			const raw = match.raw;

			// Preserve ordinary text before the reference.
			fragment.append(source.slice(offset, start));

			// Convert the candidate into a DOM node.
			fragment.append(this.createReferenceNode(raw));

			offset = start + raw.length;
		}

		// Preserve ordinary text after the last reference.
		fragment.append(source.slice(offset));

		node.replaceWith(fragment);
	}

	private createReferenceNode(raw: string): Node {
		const result = this.references.resolveFileReference(raw);
		const display = getFileReferenceDisplay(result);

		// Keep invalid references as plain text.
		if (display === null) {
			return document.createTextNode(raw);
		}

		const element = createSpan({
			cls: "file-pilot-reference",
		});

		element.textContent = display.text;

		if (display.hint !== undefined) {
			element.title = display.hint;
		}

		if (display.unresolved) {
			element.classList.add(
				"file-pilot-reference-unresolved",
			);
		}

		if (result.kind !== "found") {
			const logKey = `${result.kind}:${raw}`;

			if (!this.loggedUnresolvedReferences.has(logKey)) {
				this.loggedUnresolvedReferences.add(logKey);

				logger.debug("File reference unresolved", {
					kind: result.kind,
					reference: raw,
				});
			}

			return element;
		}

		// Keep a stable hover parent for this reference element.
		const hoverParent: HoverParent = {
			hoverPopover: null,
		};

		// Preview the associated Shadow Note on hover.
		element.addEventListener("mouseover", (event: MouseEvent) => {
			// Resolve again to avoid using stale records.
			const current = this.references.resolveFileReference(raw);

			if (current.kind !== "found") {
				return;
			}

			const note = this.app.vault.getFileByPath(
				current.record.shadowNotePath,
			);

			if (!note) {
				return;
			}

			// Delegate the preview lifecycle to Obsidian.
			this.app.workspace.trigger("hover-link", {
				event,
				source: FILE_REFERENCE_HOVER_SOURCE,
				hoverParent,
				targetEl: element,
				linktext: note.path,
				sourcePath: "",
			});
		});

		const runAction = (action: FileItemOpenAction): void => {
			// Resolve again to avoid operating on stale records.
			const current = this.references.resolveFileReference(raw);

			if (current.kind !== "found") {
				return;
			}

			// Missing files only support opening their Shadow Notes.
			if (
				current.record.status === "missing" &&
				action !== "openShadowNote"
			) {
				return;
			}

			void this.executeAction(action, current.record)
				.catch((error: unknown) => {
					notifyFileActionError(
						error,
						action,
						current.record,
					);
				});
		};

		// Reuse existing file item mouse gestures.
		for (const type of ["click", "dblclick", "auxclick"] as const) {
			element.addEventListener(type, event => {
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
}
