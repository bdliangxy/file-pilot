import { App, TFile } from "obsidian";
import type { FileRecord } from "./file-interface";
import { getShadowNoteFileName, getFullName } from "../utils/path-utils";
import { Notice } from 'obsidian';
import { t } from '../i18n';


export class ShadowNoteService {
	constructor(private app: App) { }

	getShadowNote(
		fileRecord: FileRecord
	): TFile | null {
		return this.app.vault.getFileByPath(
			fileRecord.shadowNotePath
		);
	}

	getAvailableShadowNotePath(
		relativePath: string,
		fileId: string,
		parentCount = 0,
	): string {
		const fileName = getShadowNoteFileName(
			relativePath,
			parentCount,
		);

		if (fileName === null) {
			const fallbackName = getShadowNoteFileName(
				relativePath,
				parentCount,
				fileId,
			);
			const sameNamefile = getFullName(relativePath);
			new Notice(t('SameNameFile', { fileName: sameNamefile }));
			return `ShadowNotes/${fallbackName}`;
		}

		const candidatePath = `ShadowNotes/${fileName}`;

		if (
			this.app.vault.getAbstractFileByPath(
				candidatePath,
			) === null
		) {
			return candidatePath;
		}

		return this.getAvailableShadowNotePath(
			relativePath,
			fileId,
			parentCount + 1,
		);
	}

	async createShadowNote(
		shadowNotePath: string,
		fileId: string,
	): Promise<void> {
		if (
			this.app.vault.getFolderByPath(
				'ShadowNotes',
			) === null
		) {
			await this.app.vault.createFolder(
				'ShadowNotes',
			);
		}

		const content =
			`---\nfile-id: ${fileId}\n---\n`;

		await this.app.vault.create(
			shadowNotePath,
			content,
		);
	}
}
