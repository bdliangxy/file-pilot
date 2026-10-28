export function makePluginData({
	rootPath = '',
	ignorePatterns = [],
	watchEnabled = true,
	hideShadowNotesFlag = true,
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
			hideShadowNotesFlag,
		},
		pluginData: {
			version,
			fileRecords: structuredClone(fileRecords),
		},
	};
}
