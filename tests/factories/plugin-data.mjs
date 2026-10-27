export function makePluginData({
    rootPath = '',
    ignorePatterns = [],
    watchEnabled = true,
    hideShadowNotesInExplorer = true,
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
            hideShadowNotesInExplorer,
        },
        pluginData: {
            version,
            fileRecords: structuredClone(fileRecords),
        },
    };
}
