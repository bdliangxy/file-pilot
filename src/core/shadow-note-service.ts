import { App, TFile } from "obsidian";
import type { FileRecord } from "./file-interface";
import { getFullName } from "../utils/path-utils";
import {
	generateShadowNoteName,
	extractFirstParagraphFromHeading,
} from "../utils/shadow-note-utils";
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
		const fileName = generateShadowNoteName(
			relativePath,
			parentCount,
		);

		if (fileName === null) {
			const fallbackName = generateShadowNoteName(
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
			`---\nfile-id: ${fileId}\n---\n\n## File Summary\n\n`;

		await this.app.vault.create(
			shadowNotePath,
			content,
		);
	}

	async getFileSummary(
		record: FileRecord,
	): Promise<string | null> {
		const note = this.getShadowNote(record);

		if (!note) {
			return null;
		}

		const headings =
			this.app.metadataCache.getFileCache(note)?.headings;

		if (!headings) {
			return null;
		}

		const content = await this.app.vault.cachedRead(note);

		return extractFirstParagraphFromHeading(
			content,
			headings,
			'File Summary',
		);
	}

	async deleteAllShadowNotes(): Promise<void> {
		const folder = this.app.vault.getFolderByPath('ShadowNotes');

		if (!folder) {
			return;
		}

		const notes = this.app.vault.getMarkdownFiles()
			.filter(file => file.path.startsWith('ShadowNotes/'));

		for (const note of notes) {
			await this.app.fileManager.trashFile(note);
		}

		if (folder.children.length === 0) {
			await this.app.fileManager.trashFile(folder);
		}
	}
}
