
import type { FileRecord } from "../core/file-interface";
import type { FileItemOpenAction } from "../utils/file-item-gestures";
import { FileReferenceService } from "../core/file-reference-service";
import { getFullName } from "../utils/path-utils";
import { resolveFileItemAction } from "../utils/file-item-gestures";
import { parseFileReference } from "../utils/file-reference-utils";
import { logger } from "../utils/logger";
import { notifyFileActionError } from "./file-action-error-notifier";
import { t } from "../i18n";


// Locate candidate references without validating their content.
const REFERENCE_PATTERN =
	/(?<!\|)\|\|\|[^|\r\n]*\|\|\|(?!\|)/g;

type ExecuteAction = (
	action: FileItemOpenAction,
	record: FileRecord,
) => Promise<void>;

export class FileReferenceReadingRenderer {
	private readonly loggedUnresolvedReferences = new Set<string>();
	constructor(
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
		const matches = [...source.matchAll(REFERENCE_PATTERN)];
		if (
			matches.every(match =>
				parseFileReference(match[0]) === null
			)
		) {
			return;
		}

		const fragment = createFragment();
		let offset = 0;

		for (const match of matches) {
			const start = match.index;
			const raw = match[0];

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

		// Invalid syntax should remain ordinary text.
		if (result.kind === "invalid") {
			return document.createTextNode(raw);
		}

		const element = createSpan({
			cls: "file-pilot-reference",
		});


		if (result.kind !== "found") {
			switch (result.kind) {
				case "missing":
					element.textContent = t("fileReferenceNotFound");
					element.title = t("fileReferenceNotFoundHint");
					break;

				case "ambiguous":
					element.textContent = t("fileReferenceAmbiguous");
					element.title = t("fileReferenceAmbiguousHint");
					break;
			}

			element.classList.add(
				"file-pilot-reference-unresolved",
			);

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


		// Display the current file name.
		element.textContent = getFullName(result.record.path);

		const runAction = (action: FileItemOpenAction): void => {
			// Resolve again to avoid operating on stale records.
			const current = this.references.resolveFileReference(raw);

			if (current.kind !== "found") {
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
