import type { FileScope } from "../../core/file-interface";

export interface PluginSettings {
	fileScope: FileScope;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	fileScope: {
		rootPath: "",
		ignorePatterns: [],
		watchEnabled: true,
	},
};
