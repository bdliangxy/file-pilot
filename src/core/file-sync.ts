import type { FileScanner } from './file-scanner';
import type { ShadowNoteService } from './shadow-note-service';
import { importScannedFiles } from './file-import';

import type { FileScope, FileRecord } from './file-interface';
import { FilePilotError } from '../error';

export interface SyncResult {
	importedCount: number;
}

export class FileSyncService {
	private syncInProgress = false;

	constructor(
		private readonly fileScanner: FileScanner,
		private readonly shadowNoteService: ShadowNoteService,
		private readonly addFileRecords: (record: FileRecord[]) => Promise<void>,
		private readonly getFileRecords: () => FileRecord[],
	) { }

	async syncFiles(
		fileScope: FileScope,
	): Promise<SyncResult> {
		if (this.syncInProgress) {
			throw new FilePilotError(
				'SYNC_IN_PROGRESS',
				'Sync already in progress',
			);
		}

		if (!fileScope.rootPath.trim()) {
			throw new FilePilotError(
				'SCAN_ROOT_NOT_CONFIGURED',
				'Scan root is not configured',
			);
		}

		this.syncInProgress = true;

		try {
			const scannedFiles =
				await this.fileScanner.scan(fileScope);
			const existingRecords = this.getFileRecords();
			const knownPaths = new Set(
				existingRecords.map(record => record.path)
			);

			const filesToImport = scannedFiles.filter(file => {
				if (knownPaths.has(file.path)) {
					return false;
				}

				knownPaths.add(file.path);
				return true;
			});

			const newRecords = await importScannedFiles(
				filesToImport,
				this.shadowNoteService,
			);

			if (newRecords.length > 0) {
				await this.addFileRecords(newRecords);
			}


			return {
				importedCount: newRecords.length,
			};
		} finally {
			this.syncInProgress = false;
		}
	}

	get isSyncInProgress(): boolean {
		return this.syncInProgress;
	}
}
