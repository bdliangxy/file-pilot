
import { App, TFile } from 'obsidian';
import path from 'node:path';

import { PluginStateService } from '../data/plugin-state-service';
import { FileReferenceService } from './file-reference-service';

import {
	buildPortalTree,
	renderPortalTree,
} from '../utils/portal-tree-utils';

import {
	updateMarkdownSection,
	replacePortalTreeFence,
} from '../utils/shadow-note-utils';

import { FilePilotError } from '../error';

import { ShadowNoteService } from './shadow-note-service';

const PORTAL_TREE_HEADING = 'Directory Tree';

export class PortalNoteService {
	constructor(
		private readonly app: App,
		private readonly stateService: PluginStateService,
		private readonly referenceService: FileReferenceService,
		private readonly shadowNoteService: ShadowNoteService,
	) { }

	/**
	 * Generate the complete managed Portal Tree code block.
	 */
	private async buildPortalTreeBlock(): Promise<string> {
		const records = this.stateService.getFileRecords();
		const rootPath = this.stateService.getRootPath();
		const projectName = this.stateService.getProjectName();

		const rootName = rootPath
			? path.win32.basename(rootPath)
			: projectName || 'Root';

		const tree = buildPortalTree(records, rootName);
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
	 * Create a Portal Note only when the target file does not exist.
	 */
	async createPortalNote(): Promise<boolean> {
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

		if (this.stateService.getFileRecords().length > 0) {
			const treeBlock = await this.buildPortalTreeBlock();

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
	 */
	async handlePortalNoteProjectNameChange(): Promise<
		'created' | 'renamed' | 'unchanged'
	> {
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
			const created = await this.createPortalNote();
			result = created ? 'created' : 'unchanged';
		}

		await this.stateService.clearPreviousProjectName();

		return result;
	}

	/**
	 * Update only the directory tree in an existing Portal Note.
	 */
	async syncPortalNote(): Promise<boolean> {
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

		const treeBlock = await this.buildPortalTreeBlock();

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
	}

	/**
 * Delete the current Portal Note.
 */
	async deletePortalNote(): Promise<boolean> {
		const projectName = this.stateService.getProjectName();
		const notePath = `${projectName || 'PORTAL NOTE'}.md`;

		const entry = this.app.vault.getAbstractFileByPath(notePath);

		if (!(entry instanceof TFile)) {
			return false;
		}

		await this.app.fileManager.trashFile(entry);

		return true;
	}

}
