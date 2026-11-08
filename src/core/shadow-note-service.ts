import { App, TFile } from "obsidian";
import type { FileRecord } from "./file-interface";
import { getFullName } from "../utils/path-utils";
import {
	generateShadowNoteName,
	extractFirstParagraphFromHeading,
	updateMarkdownSection,
	replaceFirstParagraph,
} from "../utils/shadow-note-utils";
import { Notice } from 'obsidian';
import { t } from '../i18n';
import { FilePilotError } from '../error';


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
		const content = await this.app.vault.cachedRead(note);

		return extractFirstParagraphFromHeading(
			content,
			'File Summary',
		);
	}

	/**
	 * Updates the File Summary section of a Shadow Note.
	 *
	 * Throws if the Shadow Note is missing or the write fails.
	 */
	async updateFileSummary(
		record: FileRecord,
		summary: string,
	): Promise<void> {
		const note = this.getShadowNote(record);

		if (!note) {
			throw new FilePilotError(
				'SHADOW_NOTE_NOT_FOUND',
				`Shadow Note not found: ${record.shadowNotePath}`,
			);
		}

		await this.app.vault.process(
			note,
			(content) => updateMarkdownSection(
				content,
				'File Summary',
				summary,
				replaceFirstParagraph,
				2,
				'top',
			),
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
