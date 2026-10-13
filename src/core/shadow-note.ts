import { App, TFile } from "obsidian";
import type { FileRecord } from "./file-interface";
import { getShadowNoteFileName } from "../utils/path-utils";



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
		parentCount = 0,
	): string {
		const fileName = getShadowNoteFileName(
			relativePath,
			parentCount,
		);

		if (fileName === null) {
			throw new Error(
				`Unable to assign a Shadow Note path for ${relativePath}: all candidate names are already taken.

`,
			);
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
