import { FileScanner } from './file-scanner';
import { ShadowNoteService } from './shadow-note';
import { importScannedFiles } from './file-import';

import type { FileScope, FileRecord } from './file-interface';

export interface SyncResult {
	importedCount: number;
}

export class FileSyncService {
	private syncInProgress = false;

	constructor(
		private readonly fileScanner: FileScanner,
		private readonly shadowNoteService: ShadowNoteService,
		private readonly addFileRecords: (record: FileRecord[]) => Promise<void>,
	) { }

	async syncFiles(
		fileScope: FileScope,
	): Promise<SyncResult> {
		if (this.syncInProgress) {
			throw new Error('Sync already in progress');
		}

		if (!fileScope.rootPath.trim()) {
			throw new Error('Scan root is not configured');
		}

		this.syncInProgress = true;

		try {
			const scannedFiles =
				await this.fileScanner.scan(fileScope);

			const newRecords = await importScannedFiles(
				scannedFiles,
				this.shadowNoteService,
			);

			await this.addFileRecords(newRecords);

			return {
				importedCount: newRecords.length,
			};
		} finally {
			this.syncInProgress = false;
		}
	}
}
