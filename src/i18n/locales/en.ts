const pluginName = 'File Pilot'
export const en = {
	// basic words
	pluginTitle: pluginName,
	pluginLoaded: `${pluginName} loaded`,
	filePilotRibbonTooltip: `Open ${pluginName} monitor panel`,

	// words in setting view
	scanRootName: 'project directory',
	scanRootDesc: `The local folder managed by ${pluginName}.`,
	scanRootPlaceholder: 'Enter the absolute path of the folder and press Enter to confirm.',
	scanRootBrowse: 'Browse',
	scanRootSave: 'Save',
	scanRootSelect: 'Select scan directory',
	// responses after selecting
	scanRootSaved: 'Scan directory saved',
	scanRootInvalid: 'Enter a valid absolute directory path',
	scanRootNotFound: 'The directory does not exist or is not accessible',
	scanRootLocked: 'Cannot change the scan root while file records exist',
	scanRootSaveFailed: 'Failed to save the directory',
	scanRootBrowseFailed: 'Folder picker is unavailable. Enter the path manually.',
	// file pilot view
	oneWayScan: 'One-way scan',
	scanRootNotConfigured: 'Please add a folder in the plugin settings page first',
	scanCompleted: 'Imported {count} files',
	scanFailed: 'Scan failed',
	scanning: 'scanning folder',

} as const;
