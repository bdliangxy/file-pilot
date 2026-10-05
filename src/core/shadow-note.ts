import { App, TFile } from "obsidian";
import type { FileRecord } from "./file-interface";

export class ShadowNoteService {
	constructor(private app: App) { }

	getShadowNote(
		fileRecord: FileRecord
	): TFile | null {
		return this.app.vault.getFileByPath(
			fileRecord.shadowNotePath
		);
	}
}
