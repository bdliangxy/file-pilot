
import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { App } from 'obsidian';

import type { FileRecord } from './file-interface';
import type { FileItemOpenAction } from '../utils/file-item-gestures';
import { getAbsoluteFilePath } from '../utils/path-utils';
import { FilePilotError } from '../error';

/**
 * Opens a native file or directory.
 * Returns an empty string on success.
 */
export type OpenNativePath = (
	absolutePath: string,
) => Promise<string>;

/**
 * Executes actions on managed files and their Shadow Notes.
 */
export class FileActionService {
	constructor(
		private readonly app: App,
		private readonly getRootPath: () => string,
		private readonly openNativePath: OpenNativePath,
	) { }

	/**
	 * Dispatches a file opening action.
	 */
	async execute(
		action: FileItemOpenAction,
		record: FileRecord,
	): Promise<void> {
		switch (action) {
			case 'openSource':
				await this.openNativeRecord(record, false);
				return;

			case 'openContainingFolder':
				await this.openNativeRecord(record, true);
				return;

			case 'openShadowNote':
				await this.openShadowNote(record);
				return;
		}
	}

	/**
	 * Opens the associated Shadow Note in a new Obsidian tab.
	 */
	private async openShadowNote(
		record: FileRecord,
	): Promise<void> {
		const note = this.app.vault.getFileByPath(
			record.shadowNotePath,
		);

		if (!note) {
			throw new FilePilotError(
				'SHADOW_NOTE_NOT_FOUND',
				`Shadow Note not found:${record.shadowNotePath}`,
			);
		}

		try {
			await this.app.workspace
				.getLeaf('tab')
				.openFile(note);
		} catch (error) {
			console.error('Failed to open Shadow Note:', error);

			throw new FilePilotError(
				'FILE_OPEN_FAILED',
				`Failed to open Shadow Note "${record.shadowNotePath}": ${String(error)}`,
			);
		}
	}

	/**
	 * Opens a native file, directory, or its parent directory.
	 */
	private async openNativeRecord(
		record: FileRecord,
		openParentFolder: boolean,
	): Promise<void> {
		const sourcePath = getAbsoluteFilePath(
			this.getRootPath(),
			record.path,
		);
		// Determine which native path should be opened.
		const targetPath = openParentFolder
			? path.dirname(sourcePath)
			: sourcePath;

		// Check whether the target still exists.
		try {
			await stat(targetPath);
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				(
					error.code === 'ENOENT' ||
					error.code === 'ENOTDIR'
				)
			) {
				throw new FilePilotError(
					'SOURCE_FILE_NOT_FOUND',
					`File or directory not found: ${targetPath}`,
				);
			}

			throw error;
		}

		// Ask the operating system to open the target.
		let errorMessage: string;

		try {
			errorMessage = await this.openNativePath(targetPath);
		} catch (error) {
			console.error(`Failed to open: ${targetPath}`, error);

			throw new FilePilotError(
				'FILE_OPEN_FAILED',
				`Failed to open "${targetPath}": ${String(error)}`,
			);
		}

		if (errorMessage) {
			throw new FilePilotError(
				'FILE_OPEN_FAILED',
				`Failed to open "${targetPath}": ${errorMessage}`,
			);
		}
	}
}
