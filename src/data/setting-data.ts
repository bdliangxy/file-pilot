import type { FileScope } from "../core/file-interface";

export interface SettingData {
	fileScope: FileScope;
}

export const DEFAULT_IGNORE_PATTERNS = [
	'# ===== System-generated cache and metadata =====',
	'Thumbs.db',
	'ehthumbs.db',
	'desktop.ini',

	'# ===== Office software temporary files =====',
	'~$*',
	'*.tmp',
] as const;

export const DEFAULT_SETTINGS: SettingData = {
	fileScope: {
		rootPath: "",
		ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
		watchEnabled: true,
	},
};
