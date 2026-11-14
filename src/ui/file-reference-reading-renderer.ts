import type { App } from "obsidian";
import { FileReferenceService } from "../core/file-reference-service";
import { findFileReferenceMatches } from "../utils/file-reference-utils";
import { logger } from "../utils/logger";
import { getFileReferenceDisplay } from "./file-reference-display";
import {
	createFileReferenceElement,
	type ExecuteFileReferenceAction,
} from "./file-reference-element";

// Preserve the existing public export.
export {
	FILE_REFERENCE_HOVER_SOURCE,
} from "./file-reference-element";

export class FileReferenceReadingRenderer {
	private readonly loggedUnresolvedReferences = new Set<string>();
	constructor(
		private readonly app: App,
		private readonly references: FileReferenceService,
		private readonly executeAction: ExecuteFileReferenceAction,
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

		if (display === null) {
			return document.createTextNode(raw);
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
		}

		return createFileReferenceElement({
			app: this.app,
			references: this.references,
			executeAction: this.executeAction,
			raw,
			display,
		});
	}

}
