
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
		// Determine the current and previous Portal Note paths.
		const projectName = this.stateService.getProjectName();
		const noteName = projectName || 'PORTAL NOTE';
		const notePath = `${noteName}.md`;

		const previousProjectName =
			this.stateService.getPreviousProjectName();
		const previousNotePath =
			previousProjectName === null
				? null
				: `${previousProjectName || 'PORTAL NOTE'}.md`;

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

		let existingEntry = vault.getAbstractFileByPath(notePath);
		let renamed = false;

		// Locate and rename the previous Portal Note when necessary.
		if (
			previousNotePath !== null &&
			previousNotePath !== notePath
		) {
			const previousEntry =
				vault.getAbstractFileByPath(previousNotePath);

			if (
				previousEntry instanceof TFile &&
				existingEntry === null
			) {
				await vault.rename(previousEntry, notePath);

				existingEntry = previousEntry;
				renamed = true;
			}
		}

		// Create a new Portal Note when neither the current nor
		// the previous Portal Note exists.
		if (existingEntry === null) {
			const content = updateMarkdownSection(
				'',
				PORTAL_TREE_HEADING,
				treeBlock,
				replacePortalTreeFence,
			);

			await vault.create(notePath, content);

			if (previousProjectName !== null) {
				await this.stateService.clearPreviousProjectName();
			}

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
		// Renaming also counts as a change.
		let changed = renamed;

		await vault.process(existingEntry, (content) => {
			const updatedContent = updateMarkdownSection(
				content,
				PORTAL_TREE_HEADING,
				treeBlock,
				replacePortalTreeFence,
			);

			changed = updatedContent !== content || changed;

			return updatedContent;
		});

		// Clear the previous name only after successful synchronization.
		if (previousProjectName !== null) {
			await this.stateService.clearPreviousProjectName();
		}

		return {
			changed,
		};
	}

}
