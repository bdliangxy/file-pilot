import type { FileScope } from "../core/file-interface";

export interface SettingData {
	fileScope: FileScope;
}

export const DEFAULT_SETTINGS: SettingData = {
	fileScope: {
		rootPath: "",
		ignorePatterns: [],
		watchEnabled: true,
	},
};
