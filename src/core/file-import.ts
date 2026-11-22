import type {
	FileRecord,
	ScannedFileInfo,
} from './file-interface';

import { randomBytes } from 'node:crypto';

import type { ShadowNoteService } from './shadow-note-service';


export async function importScannedFiles(
	scannedFiles: ScannedFileInfo[],
	shadowNoteService: ShadowNoteService,
	usedIds: Set<string>,
): Promise<FileRecord[]> {
	const fileRecords: FileRecord[] = [];
	for (const scannedFileInfo of scannedFiles) {
		let id: string;

		// Allocate a unique ID for the new FileRecord.
		do {
			id = randomBytes(9).toString('base64url');
		} while (usedIds.has(id));

		usedIds.add(id);
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
