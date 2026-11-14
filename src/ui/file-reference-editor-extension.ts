
import { editorLivePreviewField } from "obsidian";
import { syntaxTree } from "@codemirror/language";
import type {
	EditorState,
	Range,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";

import { FileReferenceService } from "../core/file-reference-service";
import { findFileReferenceMatches } from "../utils/file-reference-utils";
import {
	getFileReferenceDisplay,
	type FileReferenceDisplay,
} from "./file-reference-display";

// Check whether a reference is inside Markdown syntax
// that should not be replaced.
function isExcludedRange(
	state: EditorState,
	from: number,
	to: number,
): boolean {
	const tree = syntaxTree(state);

	for (const position of [from, to - 1]) {
		let node: ReturnType<typeof tree.resolveInner> | null =
			tree.resolveInner(position, 1);

		while (node) {
			const name = node.name.toLowerCase();

			if (
				name.includes("code") ||
				name.includes("link") ||
				name.includes("frontmatter") ||
				name.includes("yaml") ||
				name.includes("math") ||
				name.includes("html")
			) {
				return true;
			}

			node = node.parent;
		}
	}

	return false;
}

// Display-only widget for a resolved file reference.

class FileReferenceWidget extends WidgetType {
	constructor(
		private readonly display: FileReferenceDisplay,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return (
			other instanceof FileReferenceWidget &&
			this.display.text === other.display.text &&
			this.display.unresolved === other.display.unresolved &&
			this.display.hint === other.display.hint
		);
	}

	toDOM(): HTMLElement {
		const element = createSpan({
			cls: "file-pilot-reference",
		});

		element.textContent = this.display.text;

		if (this.display.unresolved) {
			element.classList.add(
				"file-pilot-reference-unresolved",
			);
		}

		if (this.display.hint !== undefined) {
			element.title = this.display.hint;
		}

		// Prevent direct editing of the displayed element.
		element.contentEditable = "false";
		element.spellcheck = false;

		return element;
	}
}


export function createFileReferenceEditorExtension(
	references: FileReferenceService,
) {

	function buildDecorations(
		view: EditorView,
	): DecorationSet {
		// Never replace source text in Source Mode.
		if (
			view.state.field(
				editorLivePreviewField,
				false,
			) !== true
		) {
			return Decoration.none;
		}

		const ranges: Range<Decoration>[] = [];
		const doc = view.state.doc;

		// Avoid scanning the same line more than once.
		const scannedLines = new Set<number>();

		for (const { from, to } of view.visibleRanges) {
			// Expand visible ranges to complete Markdown lines.
			const firstLine = doc.lineAt(from).number;
			const lastLine = doc.lineAt(
				Math.max(from, to - 1),
			).number;

			for (
				let lineNumber = firstLine;
				lineNumber <= lastLine;
				lineNumber++
			) {
				if (scannedLines.has(lineNumber)) {
					continue;
				}

				scannedLines.add(lineNumber);

				const line = doc.line(lineNumber);

				for (const match of findFileReferenceMatches(line.text)) {
					const { raw, start, end } = match;

					// Convert line-relative positions to document positions.
					const absoluteStart = line.from + start;
					const absoluteEnd = line.from + end;

					// Skip references outside the visible ranges.
					const isVisible = view.visibleRanges.some(
						range =>
							absoluteStart < range.to &&
							absoluteEnd > range.from,
					);

					if (!isVisible) {
						continue;
					}

					// Do not replace Markdown code or links.
					if (
						isExcludedRange(
							view.state,
							absoluteStart,
							absoluteEnd,
						)
					) {
						continue;
					}

					const result = references.resolveFileReference(raw);
					const display = getFileReferenceDisplay(result);

					if (display === null) {
						continue;
					}

					ranges.push(
						Decoration.replace({
							widget: new FileReferenceWidget(display),
						}).range(absoluteStart, absoluteEnd),
					);
				}
			}
		}

		return Decoration.set(ranges, true);
	}


	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view);
			}

			update(update: ViewUpdate): void {
				const previousMode =
					update.startState.field(
						editorLivePreviewField,
						false,
					);

				const currentMode =
					update.state.field(
						editorLivePreviewField,
						false,
					);

				if (
					update.docChanged ||
					update.viewportChanged ||
					previousMode !== currentMode ||
					syntaxTree(update.startState) !==
					syntaxTree(update.state)
				) {
					this.decorations = buildDecorations(
						update.view,
					);
				}
			}
		},
		{
			decorations: plugin => plugin.decorations,
		},
	);
}
