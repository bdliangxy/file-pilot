import { Plugin } from 'obsidian';
import { DataStore } from './data/data-store';
import type { PluginData } from './data/plugin-data';
import type { PluginSettings } from './data/settings/plugin-settings';
import { logger } from './utils/logger';

export default class FilePilotPlugin extends Plugin {
	pluginSettings!: PluginSettings;
	pluginData!: PluginData;

	private dataStore!: DataStore;


	async onload(): Promise<void> {
		this.dataStore = new DataStore({
			loadData: () => this.loadData(),
			saveData: (data) => this.saveData(data),
		});

		const data = await this.dataStore.load();
		this.pluginSettings = data.pluginSettings;
		this.pluginData = data.pluginData;
		logger.debug('Plugin loaded', {
			fileRecordCount: this.pluginData.fileRecords.length,
		});
	}

	onunload(): void {
		logger.debug('Plugin unloaded');
	}
}
