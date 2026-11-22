const pluginName = 'File Pilot'
const syncButtonName = 'One-way scan'
export const en = {
	// basic words
	pluginTitle: pluginName,
	pluginLoaded: `${pluginName} loaded`,
	filePilotRibbonTooltip: `Open ${pluginName} management panel`,
	restorDefault: `Restore defaults`,
	clear: `Clear`,
	import: `Import`,
	export: `Export`,

	// words in setting view
	scanRootName: `project directory`,
	scanRootDesc: `The local folder managed by ${pluginName}.`,
	scanRootPlaceholder: `Enter the absolute path of the folder,press Enter to save.`,
	scanRootBrowse: `Browse`,
	scanRootSave: `Save`,
	scanRootSelect: `Select scan directory`,
	settingsSave: `Save settings`,
	settingsSaved: `Settings saved`,
	settingsPartiallySaved: `Some settings were saved`,
	settingsSaveFailed: `Failed to save settings`,
	settingsInvalid: `Invalid settings`,
	ignorePatternsInvalid: `Invalid ignore pattern`,
	settingsUnchanged: `No settings were changed`,
	ignorePatternsName: `Ignore patterns`,
	ignorePatternsDesc: `Skip matching files and folders during scanning. Please refer to .gitignore syntax or switch modes and select manually.`,
	ignoreImportDialogTitle: `Import ignore rules`,
	ignoreExportDialogTitle: `Export ignore rules`,
	ignoreImportedDraft: `Rules imported. Save settings to apply them.`,
	ignoreImportFailed: `Failed to import ignore rules`,
	ignoreExported: `Ignore rules exported`,
	ignoreExportFailed: `Failed to export ignore rules`,
	ignoreViewAll: 'All ignore rules',
	ignoreViewDirectories: 'Ignore folders',
	ignoreViewFilenames: 'Ignore filenames',
	ignoreViewExtensions: 'Ignore extensions',
	ignoreDirectoriesDesc: 'View ignored folder rules.',
	ignoreFilenamesDesc: 'View rules matching specific filenames.',
	ignoreExtensionsDesc: 'View rules matching file extensions.',
	ignoreCategoryPlaceholder: 'There is no matching content currently.',
	ignoreRemoveRule: 'Remove ignore rule',
	ignoreRootRequired: 'Add and save the project directory before adding ignore rules.',
	ignoreSelectFolders: 'Select folders to ignore',
	ignoreSelectFiles: 'Select files to ignore',
	ignoreOutsideRoot: 'Only files and folders inside the project directory can be selected.',
	ignoreSelectionFailed: 'Failed to select files or folders.',
	ignoreExtensionInput: 'Enter an extension to ignore',
	ignoreExtensionInvalid:
		'Extensions must contain only letters, numbers, underscores, hyphens, and dots between segments.',
	ignoreExtensionDuplicate:
		'This extension already exists in the ignore rules.',
	projectNameName: 'Project name',
	projectNameDesc: 'Set the project name. Leave blank to use the default.',
	projectNamePlaceholder: 'Enter a project name (optional)',
	projectNameInvalid:
		'Project name must be at most 30 characters, contain no control characters or \\ / : * ? " < > |, and not end with a period',
	// responses after selecting directory
	scanRootSaved: `Scan directory saved`,
	scanRootInvalid: `Enter a valid absolute directory path`,
	scanRootNotFound: `The directory does not exist or is not accessible`,
	scanRootLocked:
		'Cannot change the project directory while managed records exist',
	scanRootSaveFailed: `Failed to save the directory`,
	scanRootBrowseFailed: `Folder picker is unavailable. Enter the path manually.`,
	// file pilot view
	sync: `${syncButtonName}`,
	scanRootNotConfigured: `Please add a folder in the plugin settings page first`,
	scanCompleted:
		'Imported {fileCount} files and {folderCount} folders',
	noNewImportedEntries:
		'No new files or folders imported',
	SameNameFile: `The Shadow Note for file {fileName} has a naming conflict. ${pluginName} has appended a file ID to the end. It is strongly recommended that you manually rename the file.`,
	scanFailed: `Scan failed`,
	scanning: `scanning folder`,
	syncAlreadyInProgress: `Sync already in progress`,
	managedEntryCount:
		'Managed: {fileCount} files, {folderCount} folders',
	emptyFileList:
		'No managed files or folders yet in project directory',
	fileStatusAvailable: 'Normal',
	fileStatusMissing: 'Missing',
	fileStatusIgnored: 'Ignored',
	hideShadowNotesName: 'Hide Shadow Notes',
	hideShadowNotesDesc:
		'Hide the ShadowNotes folder in the native file explorer without affecting the notes themselves.',
	clearAllData: 'Clear Data',
	clearAllDataSuccess: `Data cleared successfully`,
	clearAllDataFailed: 'Failed to clear data',
	clearInProgress: `Data clearing in progress`,
	fileSearchPlaceholder: 'Search files or paths...',
	filterStatusAll: 'All statuses',
	filterStatusLabel: 'Filter by status',
	noMatchingFiles: 'No matching files or folders',
	// File action feedback
	sourceFileNotFound: 'File or folder not found',
	shadowNoteNotFound: 'Shadow Note not found',
	sourceFileOpenFailed: 'Failed to open file',
	folderOpenFailed: 'Failed to open folder',
	shadowNoteOpenFailed: 'Failed to open Shadow Note',
	fileActionFailed: 'File operation failed',
	//about file summary
	fileSummaryPlaceholder: 'Add file summary...',
	fileSummaryEdit: 'Edit file summary',
	// File reference rendering
	fileReferenceNotFound: 'This file is not recorded',
	fileReferenceNotFoundHint: 'No managed file matches this reference.',
	fileReferenceCursorMoved: 'The file reference insertion position changed. Please try again',
	insertFileReferenceCommand: 'File reference',
	updatePortalNoteTreeCommand: 'Update directory tree',
	portalNoteUpdated: 'Directory tree updated',
	portalNoteUnchanged: 'Directory tree is already up to date',
	portalNoteUpdateFailed: 'Failed to update directory tree',
	portalNotePathOccupied:
		'Cannot create Portal Note: the target path is occupied by a folder.',
	portalNoteProjectNameChangeFailed:
		'Project name saved, but failed to rename or create Portal Note.',
	portalNoteNotFound:
		`Portal Note does not exist. Please click ${syncButtonName} first.`,
	portalNoteCreated: 'Portal Note created',
	portalNoteMultipleTreeBlocks:
		'Multiple file-pilot-tree code blocks were found in the Directory Tree section. Keep only one and try again.',
} as const;
