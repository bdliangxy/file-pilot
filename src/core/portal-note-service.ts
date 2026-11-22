
import { App, TFile } from 'obsidian';
import path from 'node:path';

import { PluginStateService } from '../data/plugin-state-service';
import { FileReferenceService } from './file-reference-service';

import {
	buildPortalTree,
	renderPortalTree,
	type PortalTreeNode,
} from '../utils/portal-tree-utils';

import {
	updateMarkdownSection,
	replacePortalTreeFence,
	updatePortalTreeSummary,
} from '../utils/shadow-note-utils';

import { FilePilotError } from '../error';

import { ShadowNoteService } from './shadow-note-service';

const PORTAL_TREE_HEADING = 'Directory Tree';

export class PortalNoteService {
	private operationQueue: Promise<void> = Promise.resolve();
	constructor(
		private readonly app: App,
		private readonly stateService: PluginStateService,
		private readonly referenceService: FileReferenceService,
		private readonly shadowNoteService: ShadowNoteService,
	) { }

	/**
	 * Serialize Portal Note operations to prevent concurrent
	 * updates from overwriting each other.
	 *
	 * A failed operation does not block subsequent operations.
	 */
	private enqueueOperation<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		const result = this.operationQueue.then(operation);

		// Keep the queue fulfilled after each operation,
		// regardless of whether the operation succeeds or fails.
		this.operationQueue = result.then(
			() => undefined,
			() => undefined,
		);

		return result;
	}


	/**
	 * Build a fresh Portal Tree from the current FileRecords.
	 */
	buildCurrentPortalTree(): PortalTreeNode {
		const records = this.stateService.getFileRecords();
		const rootPath = this.stateService.getRootPath();
		const projectName = this.stateService.getProjectName();

		const rootName = rootPath
			? path.win32.basename(rootPath)
			: projectName || 'Root';

		return buildPortalTree(records, rootName);
	}


	/**
	 * Render the supplied Portal Tree and its File Summaries.
	 */
	private async buildPortalTreeBlock(
		tree: PortalTreeNode,
	): Promise<string> {
		const records = this.stateService.getFileRecords();
		const summariesById = new Map<string, string | null>();

		await Promise.all(
			records.map(async (record) => {
				const summary =
					await this.shadowNoteService.getFileSummary(record);

				summariesById.set(record.id, summary);
			}),
		);

		const treeText = renderPortalTree(
			tree,
			(id) => this.referenceService.formatFileReference(id),
			summariesById,
		);

		return [
			'```file-pilot-tree',
			treeText,
			'```',
		].join('\n');
	}

	/**
	 * Create a Portal Note through the shared operation queue.
	 */
	createPortalNote(
		tree: PortalTreeNode,
	): Promise<boolean> {
		return this.enqueueOperation(
			() => this.createPortalNoteInternal(tree),
		);
	}

	/**
	 * Create a Portal Note only when the target file does not exist.
	 */
	private async createPortalNoteInternal(
		tree: PortalTreeNode,
	): Promise<boolean> {
		const projectName = this.stateService.getProjectName();
		const notePath = `${projectName || 'PORTAL NOTE'}.md`;

		const vault = this.app.vault;
		const existingEntry = vault.getAbstractFileByPath(notePath);

		if (existingEntry instanceof TFile) {
			return false;
		}

		if (existingEntry !== null) {
			throw new FilePilotError(
				'PORTAL_NOTE_PATH_OCCUPIED',
				`Portal Note path is occupied: ${notePath}`,
			);
		}

		let content = '';

		if (tree.children.length > 0) {
			const treeBlock = await this.buildPortalTreeBlock(tree);

			content = updateMarkdownSection(
				'',
				PORTAL_TREE_HEADING,
				treeBlock,
				replacePortalTreeFence,
			);
		}

		await vault.create(notePath, content);

		return true;
	}


	/**
	 * Handle an existing Portal Note after the project name changes.
	 * Serialize the operation with other Portal Note operations.
	 */
	handlePortalNoteProjectNameChange(): Promise<
		'created' | 'renamed' | 'unchanged'
	> {
		return this.enqueueOperation(async () => {
			const previousProjectName =
				this.stateService.getPreviousProjectName();

			if (previousProjectName === null) {
				return 'unchanged';
			}

			const projectName = this.stateService.getProjectName();

			const notePath = `${projectName || 'PORTAL NOTE'}.md`;
			const previousNotePath =
				`${previousProjectName || 'PORTAL NOTE'}.md`;

			const vault = this.app.vault;
			const existingEntry = vault.getAbstractFileByPath(notePath);

			// Preserve the current Portal Note when it already exists.
			if (existingEntry instanceof TFile) {
				await this.stateService.clearPreviousProjectName();
				return 'unchanged';
			}

			if (existingEntry !== null) {
				throw new FilePilotError(
					'PORTAL_NOTE_PATH_OCCUPIED',
					`Portal Note path is occupied: ${notePath}`,
				);
			}

			const previousEntry =
				previousNotePath !== notePath
					? vault.getAbstractFileByPath(previousNotePath)
					: null;

			let result: 'created' | 'renamed' | 'unchanged';

			if (previousEntry instanceof TFile) {
				await vault.rename(previousEntry, notePath);
				result = 'renamed';
			} else {
				// Call the internal method to avoid nested queue operations.
				const tree = this.buildCurrentPortalTree();
				const created = await this.createPortalNoteInternal(tree);
				result = created ? 'created' : 'unchanged';
			}

			await this.stateService.clearPreviousProjectName();

			return result;
		});
	}



	/**
	 * Rebuild the complete directory tree and its Summary annotations
	 * in an existing Portal Note.
	 *
	 * Serialize the entire read-build-write operation to prevent
	 * overwriting concurrent Summary annotation updates.
	 */
	syncPortalNote(
		tree: PortalTreeNode,
	): Promise<boolean> {
		return this.enqueueOperation(async () => {
			const projectName = this.stateService.getProjectName();
			const notePath = `${projectName || 'PORTAL NOTE'}.md`;

			const vault = this.app.vault;
			const existingEntry = vault.getAbstractFileByPath(notePath);

			if (existingEntry === null) {
				throw new FilePilotError(
					'PORTAL_NOTE_NOT_FOUND',
					`Portal Note does not exist: ${notePath}`,
				);
			}

			if (!(existingEntry instanceof TFile)) {
				throw new FilePilotError(
					'PORTAL_NOTE_PATH_OCCUPIED',
					`Portal Note path is occupied: ${notePath}`,
				);
			}

			const treeBlock = await this.buildPortalTreeBlock(tree);

			let changed = false;

			await vault.process(existingEntry, (content) => {
				const updatedContent = updateMarkdownSection(
					content,
					PORTAL_TREE_HEADING,
					treeBlock,
					replacePortalTreeFence,
				);

				changed = updatedContent !== content;

				return updatedContent;
			});

			return changed;
		});
	}



	/**
	 * Delete the current Portal Note after previously queued
	 * Portal Note operations have completed.
	 */
	deletePortalNote(): Promise<boolean> {
		return this.enqueueOperation(async () => {
			const projectName = this.stateService.getProjectName();
			const notePath = `${projectName || 'PORTAL NOTE'}.md`;

			const entry = this.app.vault.getAbstractFileByPath(notePath);

			if (!(entry instanceof TFile)) {
				return false;
			}

			await this.app.fileManager.trashFile(entry);

			return true;
		});
	}

	/**
	 * Update the Summary annotation of a single managed tree node
	 * in the existing Portal Note.
	 *
	 * The update is serialized with other Portal Note operations.
	 * It does not scan files, rebuild the directory tree,
	 * or create a missing Portal Note.
	 *
	 * Returns true only when the Markdown content changes.
	 */
	async updateFileSummaryAnnotation(
		fileId: string,
		summary: string | null,
	): Promise<boolean> {
		if (this.stateService.isClearingData) {
			return false;
		}

		return this.enqueueOperation(async () => {
			// The plugin state may have changed while waiting.
			if (this.stateService.isClearingData) {
				return false;
			}

			// Resolve the reference using the current FileRecord index.
			const reference =
				this.referenceService.formatFileReference(fileId);

			if (reference === null) {
				return false;
			}

			const projectName = this.stateService.getProjectName();
			const notePath = `${projectName || 'PORTAL NOTE'}.md`;

			const vault = this.app.vault;
			const existingEntry =
				vault.getAbstractFileByPath(notePath);

			// Do not create a missing Portal Note.
			if (existingEntry === null) {
				return false;
			}

			if (!(existingEntry instanceof TFile)) {
				throw new FilePilotError(
					'PORTAL_NOTE_PATH_OCCUPIED',
					`Portal Note path is occupied: ${notePath}`,
				);
			}

			let changed = false;

			await vault.process(existingEntry, (content) => {
				if (this.stateService.isClearingData) {
					return content;
				}

				const updatedContent = updatePortalTreeSummary(
					content,
					PORTAL_TREE_HEADING,
					reference,
					summary,
				);

				changed = updatedContent !== content;

				return updatedContent;
			});

			return changed;
		});
	}


}
