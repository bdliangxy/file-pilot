import type {
	FileRecord,
	ScannedFileInfo,
} from './file-interface';

import { randomUUID } from 'node:crypto';

import type { ShadowNoteService } from './shadow-note-service';


export async function importScannedFiles(
	scannedFiles: ScannedFileInfo[],
	shadowNoteService: ShadowNoteService,
): Promise<FileRecord[]> {
	const fileRecords: FileRecord[] = [];
	for (const scannedFileInfo of scannedFiles) {
		const id = randomUUID();
		const shadowNotePath =
			shadowNoteService
				.getAvailableShadowNotePath(
					scannedFileInfo.path,
					id,
				);


		const fileRecord: FileRecord = {
			...scannedFileInfo,
			id,
			status: 'available',
			shadowNotePath,
		};

		await shadowNoteService.createShadowNote(
			shadowNotePath,
			id,
		);

		fileRecords.push(fileRecord);
	}


	return fileRecords;
}
