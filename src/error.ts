export type FilePilotErrorCode =
	| 'SYNC_IN_PROGRESS'
	| 'SCAN_ROOT_NOT_CONFIGURED'
	| 'SCAN_ROOT_LOCKED'
	| 'SCAN_ROOT_INVALID'
	| 'SCAN_ROOT_NOT_FOUND'
	| 'DATA_LOST'
	| 'CLEAR_IN_PROGRESS'
	| 'SHADOW_NOTE_NOT_FOUND'
	| 'FILE_OPEN_FAILED'
	| 'SOURCE_FILE_NOT_FOUND'
	| "FILE_REFERENCE_NOT_FOUND"
	| 'PORTAL_NOTE_PATH_OCCUPIED';

export class FilePilotError extends Error {
	constructor(
		public readonly code: FilePilotErrorCode,
		message: string = code,
	) {
		super(message);
		this.name = 'FilePilotError';
	}
}
