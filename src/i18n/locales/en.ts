const pluginName = 'File Pilot'
export const en = {
	// basic words
	pluginTitle: pluginName,
	pluginLoaded: `${pluginName} loaded`,
	filePilotRibbonTooltip: `Open ${pluginName} monitor panel`,

	// words in setting view
	scanRootName: `project directory`,
	scanRootDesc: `The local folder managed by ${pluginName}.`,
	scanRootPlaceholder: `Enter the absolute path of the folder`,
	scanRootBrowse: `Browse`,
	scanRootSave: `Save`,
	scanRootSelect: `Select scan directory`,
	settingsSave: 'Save settings',
	settingsSaved: `Settings saved`,
	settingsPartiallySaved: `Some settings were saved`,
	settingsSaveFailed: `Failed to save settings`,
	settingsInvalid: `Invalid settings`,
	ignorePatternsInvalid: `Invalid ignore pattern`,
	settingsUnchanged: 'No settings were changed',
	// responses after selecting directory
	scanRootSaved: `Scan directory saved`,
	scanRootInvalid: `Enter a valid absolute directory path`,
	scanRootNotFound: `The directory does not exist or is not accessible`,
	scanRootLocked: `Cannot change the scan root while file records exist`,
	scanRootSaveFailed: `Failed to save the directory`,
	scanRootBrowseFailed: `Folder picker is unavailable. Enter the path manually.`,
	// file pilot view
	oneWayScan: `One-way scan`,
	scanRootNotConfigured: `Please add a folder in the plugin settings page first`,
	scanCompleted: `Imported {count} files`,
	SameNameFile: `The Shadow Note for file {fileName} has a naming conflict. ${pluginName} has appended a UUID to the end. It is strongly recommended that you manually rename the file.`,
	scanFailed: `Scan failed`,
	scanning: `scanning folder`,
	syncAlreadyInProgress: `Sync already in progress`,

} as const;
