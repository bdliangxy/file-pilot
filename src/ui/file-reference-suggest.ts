
import {
	EditorSuggest,
	type App,
	type Editor,
	type EditorPosition,
	type EditorSuggestContext,
	type EditorSuggestTriggerInfo,
	type TFile,
} from "obsidian";

import type { FileRecord } from "../core/file-interface";
import { FileReferenceService } from "../core/file-reference-service";
import {
	generateShortKey,
	findFileReferenceMatches,
} from "../utils/file-reference-utils";
import { searchFileRecords } from "../utils/file-search-utils";
import {
	sortFileRecords,
	FileSortRule,
} from "../utils/file-sort-utils";
import { getFullName } from "../utils/path-utils";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

const TRIGGER = "|||";
const MAX_SUGGESTIONS = 15;
const COMMAND_PENDING_TIMEOUT_MS = 2000;

export function isInsideCode(
	editor: Editor,
	cursor: EditorPosition,
): boolean {
	const cm = (editor as Editor & { cm?: EditorView }).cm;
	if (!cm) return false;

	const offset = editor.posToOffset(cursor);
	const tree = syntaxTree(cm.state);
	let node: ReturnType<typeof tree.resolveInner> | null =
		tree.resolveInner(Math.max(0, offset - 1), -1);

	while (node) {
		if (node.name.toLowerCase().includes("code")) {
			return true;
		}
		node = node.parent;
	}

	return false;
}

export class FileReferenceSuggest extends EditorSuggest<FileRecord> {
	private commandEditor: Editor | null = null;
	private commandPending = false;
	private commandRetryQueued = false;

	//Identifies which request/generation the current command belongs to.
	private commandGeneration = 0;

	//Indicates whether the initial explicit trigger of openFromCommand() is currently being executed.
	private commandStarting = false;
	private commandTimeout: number | null = null;
	constructor(
		app: App,
		private readonly references: FileReferenceService,
		private readonly getRecords: () => FileRecord[],
	) {
		super(app);
		this.limit = MAX_SUGGESTIONS;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		const beforeCursor = editor
			.getLine(cursor.line)
			.slice(0, cursor.ch);

		const triggerIndex = beforeCursor.lastIndexOf(TRIGGER);

		if (triggerIndex === -1) {
			if (!this.commandPending && this.commandEditor === editor) {
				this.close();
			}
			return null;
		}

		// Disable suggestions inside code blocks.
		if (isInsideCode(editor, cursor)) {
			if (this.commandEditor === editor) {
				this.close();
			}
			return null;
		}

		// Do not start inside an already completed reference.
		const completedReference = findFileReferenceMatches(beforeCursor)
			.some(match => match.end === beforeCursor.length);

		if (completedReference) {
			return null;
		}

		// Do not trigger from four or more consecutive pipes.
		if (
			(triggerIndex > 0 && beforeCursor[triggerIndex - 1] === "|") ||
			beforeCursor[triggerIndex + TRIGGER.length] === "|"
		) {
			return null;
		}

		const query = beforeCursor.slice(
			triggerIndex + TRIGGER.length,
		);

		// Search text cannot contain another pipe or a newline.
		if (query.includes("|") || query.includes("\n")) {
			return null;
		}

		// Retry the explicit trigger if the command has not opened suggestions.
		if (this.commandPending && !this.commandRetryQueued) {
			this.commandRetryQueued = true;

			// Associate the retry with the current command.
			const generation = this.commandGeneration;

			window.requestAnimationFrame(() => {
				// Ignore callbacks belonging to an outdated command.
				if (generation !== this.commandGeneration) return;

				this.commandRetryQueued = false;

				// The first trigger may already have succeeded.
				if (!this.commandPending) return;

				// Consume the pending request before retrying to prevent recursion.
				this.commandPending = false;
				this.commandEditor = editor;

				const internal = this as unknown as {
					trigger?: (
						editor: Editor,
						file: TFile | null,
						explicit: boolean,
					) => void;
				};

				internal.trigger?.(editor, _file, true);
			});
		}

		return {
			start: {
				line: cursor.line,
				ch: triggerIndex,
			},
			end: cursor,
			query,
		};
	}

	getSuggestions(
		context: EditorSuggestContext,
	): FileRecord[] {
		this.commandPending = false;
		this.clearCommandTimeout();
		const records = this.getRecords();
		const query = context.query.trim();

		const matches = searchFileRecords(records, { query });

		// Sort results using shared file sorting rules.
		const sorted = sortFileRecords(
			matches,
			[
				FileSortRule.NAME_PREFIX_FIRST,
				FileSortRule.PATH_ASC,
			],
			{ query },
		);

		return sorted.slice(0, MAX_SUGGESTIONS);
	}

	renderSuggestion(
		record: FileRecord,
		el: HTMLElement,
	): void {
		el.addClass("file-pilot-suggestion");


		el.createDiv({
			cls: record.kind === "folder"
				? "file-pilot-suggestion-name file-pilot-folder-name"
				: "file-pilot-suggestion-name",
			text: getFullName(record.path),
		});


		el.createDiv({
			cls: "file-pilot-suggestion-path",
			text: record.path,
		});

		if (record.status === "missing") {
			el.createDiv({
				cls: "file-pilot-suggestion-status",
				text: "Missing",
			});
		}
	}

	selectSuggestion(
		record: FileRecord,
		_evt: MouseEvent | KeyboardEvent,
	): void {
		const context = this.context;

		if (!context) {
			return;
		}

		// Resolve the latest FileRecord before insertion.
		const current = this.references.resolveFileId(record.id);

		if (!current) {
			return;
		}

		const key = generateShortKey(current.id);
		const lookup = this.references.resolveShortKey(key);

		// Fall back to the full ID if the short key is ambiguous.
		const reference =
			lookup.kind === "found" &&
				lookup.record.id === current.id
				? `|||@${key}|||`
				: `|||!${current.id}|||`;

		// Replace only the trigger and its search query.
		context.editor.replaceRange(
			reference,
			context.start,
			context.end,
		);

		this.close();
	}

	// Explicitly trigger suggestions after a command.
	openFromCommand(
		editor: Editor,
		file: TFile | null,
	): void {
		const internal = this as unknown as {
			trigger?: (
				editor: Editor,
				file: TFile | null,
				explicit: boolean,
			) => void;
		};


		this.clearCommandTimeout();
		this.commandGeneration++;
		this.commandRetryQueued = false;
		this.commandEditor = editor;
		this.commandPending = true;

		this.commandStarting = true;

		try {
			internal.trigger?.(editor, file, true);
		} finally {
			this.commandStarting = false;
		}

		if (this.commandPending) {
			const generation = this.commandGeneration;
			this.commandTimeout = window.setTimeout(() => {
				if (generation !== this.commandGeneration || !this.commandPending) return;

				// Expire a command that never reached suggestions.
				this.commandGeneration++;
				this.commandPending = false;
				this.commandRetryQueued = false;
				this.commandEditor = null;
				this.commandTimeout = null;
			}, COMMAND_PENDING_TIMEOUT_MS);
		}
	}


	private clearCommandTimeout(): void {
		if (this.commandTimeout !== null) {
			window.clearTimeout(this.commandTimeout);
			this.commandTimeout = null;
		}
	}

	override close(): void {
		if (!this.commandStarting) {
			this.clearCommandTimeout();
			// Invalidate pending retries when the command is closed.
			this.commandGeneration++;
			this.commandPending = false;
			this.commandRetryQueued = false;
			this.commandEditor = null;
		}

		super.close();
	}

}
