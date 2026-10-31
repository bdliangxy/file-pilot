export function makePluginData({
	rootPath = '',
	ignorePatterns = [],
	watchEnabled = true,
	hideShadowNotesFlag = true,
	projectName = '',
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
			hideShadowNotesFlag,
		},
		pluginData: {
			version,
			fileRecords: structuredClone(fileRecords),
		},
	};
}
