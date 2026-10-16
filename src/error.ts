export type FilePilotErrorCode =
	| 'SYNC_IN_PROGRESS'
	| 'SCAN_ROOT_NOT_CONFIGURED'
	| 'SCAN_ROOT_LOCKED'
	| 'SCAN_ROOT_INVALID'
	| 'SCAN_ROOT_NOT_FOUND'
	| 'DATA_LOST';

export class FilePilotError extends Error {
	constructor(
		public readonly code: FilePilotErrorCode,
		message: string = code,
	) {
		super(message);
		this.name = 'FilePilotError';
	}
}
