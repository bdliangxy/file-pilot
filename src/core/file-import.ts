import type {
	FileRecord,
	ScannedFileInfo,
} from './file-interface';

import { randomUUID } from 'node:crypto';

import { ShadowNoteService } from './shadow-note';

function getFallbackShadowNotePath(
	baseName: string,
	fileId: string,
): string {
	return `ShadowNotes/${baseName}-${fileId}.md`;
}


export async function importScannedFiles(
	scannedFiles: ScannedFileInfo[],
	shadowNoteService: ShadowNoteService,
): Promise<FileRecord[]> {
	const fileRecords: FileRecord[] = [];
	for (const scannedFileInfo of scannedFiles) {
		const id = randomUUID();
		let shadowNotePath: string;
		try {
			shadowNotePath =
				shadowNoteService
					.getAvailableShadowNotePath(
						scannedFileInfo.path,
					);
		} catch {
			shadowNotePath =
				getFallbackShadowNotePath(
					scannedFileInfo.baseName,
					id,
				);
		}


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
