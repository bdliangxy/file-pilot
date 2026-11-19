
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

export interface PortalNoteSyncResult {
	changed: boolean;
}

const PORTAL_TREE_HEADING = 'Directory Tree';

export class PortalNoteService {
	constructor(
		private readonly app: App,
		private readonly stateService: PluginStateService,
		private readonly referenceService: FileReferenceService,
	) { }

	async syncPortalNote(): Promise<PortalNoteSyncResult> {
		// Determine the Portal Note path.
		const projectName = this.stateService.getProjectName();
		const noteName = projectName || 'PORTAL NOTE';
		const notePath = `${noteName}.md`;

		// Build the tree using current FileRecords.
		const records = this.stateService.getFileRecords();
		const rootPath = this.stateService.getRootPath();

		const rootName = rootPath
			? path.win32.basename(rootPath.replace(/[\\/]+$/, ''))
			: projectName || 'Root';

		const tree = buildPortalTree(records, rootName);

		const treeText = renderPortalTree(
			tree,
			(id) => this.referenceService.formatFileReference(id),
		);

		const treeBlock = [
			'```file-pilot-tree',
			treeText,
			'```',
		].join('\n');

		const vault = this.app.vault;
		const existingEntry = vault.getAbstractFileByPath(notePath);

		// Initialize the Portal Note with the Directory Tree section.
		// Reuse the section updater to keep creation and subsequent updates consistent.
		if (existingEntry === null) {
			const content = updateMarkdownSection(
				'',
				PORTAL_TREE_HEADING,
				treeBlock,
				replacePortalTreeFence,
			);

			await vault.create(notePath, content);

			return {
				changed: true,
			};
		}

		if (!(existingEntry instanceof TFile)) {
			throw new FilePilotError(
				'PORTAL_NOTE_PATH_OCCUPIED',
				`Portal Note path is occupied: ${notePath}`,
			);
		}

		// Update only the managed tree fence.
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

		return {
			changed
		};
	}
}
