import type { FileRecord } from "../core/file-interface"

export interface PluginData {
	version: number; // Schema version of data.json for compatibility with future upgrades.
	fileRecords: FileRecord[];
}

export const DEFAULT_PLUGIN_DATA: PluginData = {
	version: 1,
	fileRecords: [],
};

