import { DEFAULT_SETTINGS, type SettingData } from './setting-data';
import { DEFAULT_PLUGIN_DATA, type PluginData } from './plugin-data';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { FileScope, FileRecord } from '../core/file-interface';
import { FilePilotError } from '../error';
// Represents the complete structure stored in Obsidian's data.json.
interface Data {
	settingData: SettingData;
	pluginData: PluginData;
}

const DEFAULT_DATA: Data = {
	settingData: DEFAULT_SETTINGS,
	pluginData: DEFAULT_PLUGIN_DATA,
};

export interface DataAdapter {
	loadData(): Promise<unknown>;
	saveData(data: Data): Promise<void>;
}

export class PluginStateService {
	private data: Data | null = null;
	constructor(private readonly dataAdapter: DataAdapter) { }
	// If the data meets the requirements after running load(),
	// return the loaded data; otherwise, load the default value.
	async load(): Promise<void> {
		const storedData = await this.dataAdapter.loadData();
		if (isData(storedData)) {
			this.data = structuredClone(storedData);
			return;
		}

		const defaultData = structuredClone(DEFAULT_DATA);
		await this.save(defaultData);
	}
	getFileScope(): FileScope {
		return structuredClone(this.getData().settingData.fileScope);
	}
	getRootPath(): string {
		return this.getData().settingData.fileScope.rootPath;
	}

	getFileRecordCount(): number {
		return this.getData().pluginData.fileRecords.length;
	}
	async addFileRecords(records: FileRecord[]): Promise<void> {
		if (records.length === 0) {
			return;
		}

		// two cloned copies aims to keep the in-memory state unchanged if persistence fails.
		const nextData = structuredClone(this.getData());

		nextData.pluginData.fileRecords.push(
			...structuredClone(records),
		);

		await this.save(nextData);
	}

	async setRootPath(rootPath: string): Promise<void> {
		const currentData = this.getData();
		const newPath = rootPath.trim();

		if (newPath === currentData.settingData.fileScope.rootPath) {
			return;
		}

		// Prevent changing the scan root after importing files.
		if (currentData.pluginData.fileRecords.length > 0) {
			throw new FilePilotError(
				'SCAN_ROOT_LOCKED',
				'Scan root cannot be changed after files have been imported',
			);
		}

		// Validate the root path.
		if (newPath !== '' && !isAbsolute(newPath)) {
			throw new FilePilotError(
				'SCAN_ROOT_INVALID',
				'Scan root must be an absolute path',
			);
		}
		if (newPath !== '') {
			let isDirectory: boolean;

			try {
				const info = await stat(newPath);
				isDirectory = info.isDirectory();
			} catch {
				throw new FilePilotError(
					'SCAN_ROOT_NOT_FOUND',
					'Scan root directory does not exist or is inaccessible',
				);
			}

			if (!isDirectory) {
				throw new FilePilotError(
					'SCAN_ROOT_NOT_FOUND',
					'Scan root path is not a directory',
				);
			}
		}
		const nextData = structuredClone(currentData);

		nextData.settingData.fileScope.rootPath = newPath;

		await this.save(nextData);
	}

	private async save(data: Data): Promise<void> {
		await this.dataAdapter.saveData(data);
		this.data = data;
	}

	private getData(): Data {
		if (this.data === null) {
			throw new Error('Plugin state has not been loaded');
		}

		return this.data;
	}
}

function isData(value: unknown): value is Data {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	if (!("settingData" in value)) {
		return false;
	}

	if (!("pluginData" in value)) {
		return false;
	}

	return true;
}


