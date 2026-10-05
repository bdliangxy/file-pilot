import { DEFAULT_SETTINGS, type PluginSettings } from './settings/plugin-settings';
import { DEFAULT_PLUGIN_DATA, type PluginData } from './plugin-data';

// Represents the complete structure stored in Obsidian's data.json.
interface Data {
	pluginSettings: PluginSettings;
	pluginData: PluginData;
}

const DEFAULT_DATA: Data = {
	pluginSettings: DEFAULT_SETTINGS,
	pluginData: DEFAULT_PLUGIN_DATA,
};

export interface DataAdapter {
	loadData(): Promise<unknown>;
	saveData(data: Data): Promise<void>;
}

export class DataStore {
	constructor(private readonly dataAdapter: DataAdapter) { }

	async load(): Promise<Data> {
		const storedData = await this.dataAdapter.loadData();
		if (isData(storedData)) {
			return storedData;
		}

		const defaultData = structuredClone(DEFAULT_DATA);
		await this.save(defaultData);
		return defaultData;
	}

	async save(data: Data): Promise<void> {
		await this.dataAdapter.saveData(data);
	}
}

function isData(value: unknown): value is Data {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	if (!("pluginSettings" in value)) {
		return false;
	}

	if (!("pluginData" in value)) {
		return false;
	}

	return true;
}


