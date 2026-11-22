import type { App } from "obsidian";
import { editorLivePreviewField } from "obsidian";
import { syntaxTree } from "@codemirror/language";
import {
	EditorState,
	StateEffect,
	type Range,
	type Transaction,
	type TransactionSpec,
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
import {
	createFileReferenceElement,
	type ExecuteFileReferenceAction,
} from "./file-reference-element";
import {
	getFilePilotTreeBodyLines,
} from "../utils/file-pilot-tree-fence";

// Signal that the FileRecord reference index has changed.
const refreshFileReferences = StateEffect.define<void>();


// Cache parsed fence lines by immutable CodeMirror document.
const treeFenceCache =
	new WeakMap<object, ReadonlySet<number>>();

function isInsideFilePilotTree(
	state: EditorState,
	from: number,
	to: number,
): boolean {
	const doc = state.doc;
	let bodyLines = treeFenceCache.get(doc);

	if (bodyLines === undefined) {
		bodyLines = getFilePilotTreeBodyLines(
			doc.lineAt(doc.length).number,
			index => doc.line(index + 1).text,
		);

		treeFenceCache.set(doc, bodyLines);
	}

	const firstLine = doc.lineAt(from).number - 1;
	const lastLine = doc.lineAt(to - 1).number - 1;

	return (
		bodyLines.has(firstLine) &&
		bodyLines.has(lastLine)
	);
}



// Check whether a reference is inside Markdown syntax
// that should not be replaced.
function isExcludedRange(
	state: EditorState,
	from: number,
	to: number,
): boolean {
	const tree = syntaxTree(state);
	const allowCode = isInsideFilePilotTree(state, from, to);

	for (const position of [from, to - 1]) {
		let node: ReturnType<typeof tree.resolveInner> | null =
			tree.resolveInner(position, 1);

		while (node) {
			const name = node.name.toLowerCase();

			if (
				(name.includes("code") && !allowCode) ||
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

interface ReferenceRange {
	from: number;
	to: number;
}

// Find a reference whose interior contains the position.
function findReferenceAt(
	state: EditorState,
	position: number,
): ReferenceRange | null {
	if (position <= 0 || position >= state.doc.length) {
		return null;
	}

	const line = state.doc.lineAt(position);

	if (!line.text.includes("|||")) {
		return null;
	}

	for (const match of findFileReferenceMatches(line.text)) {
		const from = line.from + match.start;
		const to = line.from + match.end;

		if (from < position && position < to) {
			if (!isExcludedRange(state, from, to)) {
				return { from, to };
			}
		}
	}

	return null;
}

// Expand partial reference edits into atomic edits.
function protectReferenceChanges(
	tr: Transaction,
): TransactionSpec | readonly TransactionSpec[] {
	const state = tr.startState;

	// Apply atomic reference protection only to user editing operations.
	// Programmatic document updates and history operations must remain unchanged.
	if (
		!tr.docChanged ||
		state.field(editorLivePreviewField, false) !== true ||
		(!tr.isUserEvent("input") && !tr.isUserEvent("delete"))
	) {
		return tr;
	}

	const extraDeletions: {
		from: number;
		to: number;
	}[] = [];

	const handledReferences = new Set<string>();
	let reject = false;

	tr.changes.iterChanges((fromA, toA) => {
		if (reject) return;

		const startRef = findReferenceAt(state, fromA);

		// Reject pure insertion inside a reference.
		if (fromA === toA) {
			if (startRef !== null) {
				reject = true;
			}
			return;
		}

		const endRef = findReferenceAt(state, toA);

		// Avoid conflicting edits to the same reference.
		const affected = new Map<string, ReferenceRange>();

		for (const ref of [startRef, endRef]) {
			if (ref !== null) {
				affected.set(`${ref.from}:${ref.to}`, ref);
			}
		}

		for (const key of affected.keys()) {
			if (handledReferences.has(key)) {
				reject = true;
				return;
			}

			handledReferences.add(key);
		}

		// Remove the surviving prefix of a reference.
		if (startRef !== null) {
			const from = tr.changes.mapPos(
				startRef.from, 1
			);
			const to = tr.changes.mapPos(
				fromA, -1
			);

			if (from < to) {
				extraDeletions.push({ from, to });
			}
		}

		// Remove the surviving suffix of a reference.
		if (endRef !== null) {
			const from = tr.changes.mapPos(
				toA, 1
			);
			const to = tr.changes.mapPos(
				endRef.to, -1
			);

			if (from < to) {
				extraDeletions.push({ from, to });
			}
		}
	});

	// Cancel unsupported conflicting modifications.
	if (reject) {
		return {};
	}

	if (extraDeletions.length === 0) {
		return tr;
	}

	// Merge overlapping supplemental deletions.
	extraDeletions.sort((a, b) => a.from - b.from);

	const merged: typeof extraDeletions = [];

	for (const range of extraDeletions) {
		const previous = merged[merged.length - 1];

		if (previous && range.from <= previous.to) {
			previous.to = Math.max(previous.to, range.to);
		} else {
			merged.push({ ...range });
		}
	}

	return [
		tr,
		{
			changes: merged,
			sequential: true,
		},
	];
}

// Display-only widget for a resolved file reference.


class FileReferenceWidget extends WidgetType {
	constructor(
		private readonly raw: string,
		private readonly display: FileReferenceDisplay,
		private readonly selected: boolean,
		private readonly app: App,
		private readonly references: FileReferenceService,
		private readonly executeAction: ExecuteFileReferenceAction,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return (
			other instanceof FileReferenceWidget &&
			this.raw === other.raw &&
			this.display.text === other.display.text &&
			this.display.unresolved === other.display.unresolved &&
			this.display.hint === other.display.hint &&
			this.selected === other.selected
		);
	}

	toDOM(): HTMLElement {
		return createFileReferenceElement({
			app: this.app,
			references: this.references,
			executeAction: this.executeAction,
			raw: this.raw,
			display: this.display,
			selected: this.selected,
		});
	}
}



export function createFileReferenceEditorExtension(
	references: FileReferenceService,
	app: App,
	executeAction: ExecuteFileReferenceAction,
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

					const selected = view.state.selection.ranges.some(
						range =>
							!range.empty &&
							range.from <= absoluteStart &&
							range.to >= absoluteEnd,
					);

					ranges.push(
						Decoration.replace({
							widget: new FileReferenceWidget(
								raw,
								display,
								selected,
								app,
								references,
								executeAction,
							),
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

			private unsubscribe: () => void;
			private disposed = false;
			private refreshQueued = false;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view);

				this.unsubscribe = references.onIndexChanged(() => {
					if (this.disposed || this.refreshQueued) {
						return;
					}

					this.refreshQueued = true;

					// Defer dispatch until the current update finishes.
					queueMicrotask(() => {
						this.refreshQueued = false;

						if (this.disposed) {
							return;
						}

						view.dispatch({
							effects: refreshFileReferences.of(undefined),
						});
					});
				});
			}

			destroy(): void {
				this.disposed = true;
				this.unsubscribe();
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


				const indexChanged = update.transactions?.some(
					transaction =>
						transaction.effects.some(
							effect => effect.is(refreshFileReferences),
						),
				) ?? false;

				if (
					update.docChanged ||
					update.viewportChanged ||
					update.selectionSet ||
					previousMode !== currentMode ||
					syntaxTree(update.startState) !==
					syntaxTree(update.state) ||
					indexChanged
				) {
					this.decorations = buildDecorations(update.view);
				}

			}
		},
		{
			decorations: plugin => plugin.decorations,

			provide: plugin => [
				EditorView.atomicRanges.of(
					view =>
						view.plugin(plugin)?.decorations
						?? Decoration.none
				),

				EditorState.transactionFilter.of(
					protectReferenceChanges
				),
			],
		},
	);
}
