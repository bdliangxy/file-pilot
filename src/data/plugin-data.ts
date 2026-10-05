import type { FileRecord } from "../core/file-interface"

export interface PluginData {
	version: number; // data.json 数据结构版本，用于未来升级后的数据兼容
	fileRecords: FileRecord[];
}

export const DEFAULT_PLUGIN_DATA: PluginData = {
	version: 1,
	fileRecords: [],
};

