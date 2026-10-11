import { Plugin } from 'obsidian';
import { DataStore } from './data/data-store';
import type { PluginData } from './data/plugin-data';
import type { PluginSettings } from './data/settings/plugin-settings';
import { logger } from './utils/logger';
import { FilePilotSettingTab } from './ui/file-pilot-setting-tab';

export default class FilePilotPlugin extends Plugin {
	pluginSettings!: PluginSettings;
	pluginData!: PluginData;

	private dataStore!: DataStore;


	async onload(): Promise<void> {
		//When constructing a datastore, you need to pass in a DataAdapter.
		this.dataStore = new DataStore({
			loadData: () => this.loadData(),
			saveData: (data) => this.saveData(data),
		});

		const data = await this.dataStore.load();
		this.pluginSettings = data.pluginSettings;
		this.pluginData = data.pluginData;

		this.addSettingTab(
			new FilePilotSettingTab(this.app, this),
		);

		logger.debug('Plugin loaded', {
			fileRecordCount: this.pluginData.fileRecords.length,
		});
	}

	onunload(): void {
		logger.debug('Plugin unloaded');
	}

	async saveAllData() {
		await this.dataStore.save({
			pluginSettings: this.pluginSettings,
			pluginData: this.pluginData,
		});
	}
}
