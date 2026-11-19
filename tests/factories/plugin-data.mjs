export function makePluginData({
	rootPath = '',
	ignorePatterns = [],
	watchEnabled = true,
	hideShadowNotesFlag = true,
	projectName = '',
	previousProjectName = null,
	fileRecords = [], 
	version = 2,
} = {}) {
	return {
		settingData: {
			fileScope: {
				rootPath,
				ignorePatterns: [...ignorePatterns],
				watchEnabled,
			},
			projectName,
			previousProjectName,
			hideShadowNotesFlag,
		},
		pluginData: {
			version,
			fileRecords: structuredClone(fileRecords),
		},
	};
}
