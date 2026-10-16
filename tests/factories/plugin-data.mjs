export function makePluginData({
    rootPath = '',
    ignorePatterns = [],
    watchEnabled = true,
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
        },
        pluginData: {
            version,
            fileRecords: structuredClone(fileRecords),
        },
    };
}
