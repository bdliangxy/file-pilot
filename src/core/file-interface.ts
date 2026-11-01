export interface FileScope {
	rootPath: string;	// Physical directory managed by this scope.

	ignorePatterns: string[]; // Ignore patterns used to exclude unwanted content.

	watchEnabled: boolean; // Users can temporarily disable live watching during frequent file operations and re-enable it afterward.
}
interface ScannedEntryBase {
	path: string;// Path relative to the FileScope root.
	nativeIdentity?: string;// Auxiliary identity information provided by the file system.
	baseName: string;// File name without the path or extension or directory name.
	mtimeMs: number;// File or directory modification time in milliseconds.
}

export type ScannedFileInfo =
	| (ScannedEntryBase & {
		kind: 'file';
		extension: string | null;// File extension without the leading dot.
		size: number;// File size in bytes.
	})
	| (ScannedEntryBase & {
		kind: 'folder';
	});

export type FileStatus = 'available' | 'missing';

export type FileRecord = ScannedFileInfo & {
	id: string;	// Stable primary key used for internal plugin references.
	status: FileStatus;
	shadowNotePath: string; // Path relative to the vault root.
}


