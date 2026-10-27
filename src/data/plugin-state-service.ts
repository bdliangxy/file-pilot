import { DEFAULT_SETTINGS, type SettingData } from './setting-data';
import { DEFAULT_PLUGIN_DATA, type PluginData } from './plugin-data';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { FileScope, FileRecord } from '../core/file-interface';
import { FilePilotError } from '../error';
import ignore from 'ignore';
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

export interface SettingsChanges {
	rootPath?: string;
	ignorePatterns?: string[];
	hideShadowNotesInExplorer?: boolean;
}

export interface SettingsUpdateResult {
	updated: (keyof SettingsChanges)[];
	errors: Partial<Record<keyof SettingsChanges, Error>>;
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
	getFileRecords(): FileRecord[] {
		return structuredClone(
			this.getData().pluginData.fileRecords
		);
	}
	getRootPath(): string {
		return this.getData().settingData.fileScope.rootPath;
	}
	getHideShadowNotesInExplorer(): boolean {
		return this.getData().settingData.hideShadowNotesInExplorer;
	}

	getIgnorePatterns(): string[] {
		return structuredClone(
			this.getData().settingData.fileScope.ignorePatterns,
		);
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

		const fileRecords = nextData.pluginData.fileRecords;
		// Build indexes from existing records.
		const existingIds = new Set(
			fileRecords.map(record => record.id)
		);
		const existingPaths = new Set(
			fileRecords.map(record => record.path)
		);

		for (const record of records) {
			if (existingIds.has(record.id)) {
				throw new Error("Duplicate FileRecord ID");
			}

			if (existingPaths.has(record.path)) {
				throw new Error("Duplicate FileRecord path");
			}

			existingIds.add(record.id);
			existingPaths.add(record.path);
		}

		fileRecords.push(...structuredClone(records));

		await this.save(nextData);
	}
	async removeFileRecord(id: string): Promise<void> {
		const nextData = structuredClone(this.getData());
		const records = nextData.pluginData.fileRecords;

		const index = records.findIndex(
			record => record.id === id
		);

		if (index === -1) {
			return;
		}

		records.splice(index, 1);

		await this.save(nextData);
	}

	private async validateRootPath(
		rootPath: string,
		currentData: Data,
	): Promise<void> {
		// Prevent changing the scan root after importing files.
		if (currentData.pluginData.fileRecords.length > 0) {
			throw new FilePilotError(
				'SCAN_ROOT_LOCKED',
				'Scan root cannot be changed after files have been imported',
			);
		}
		// Validate the root path.
		if (rootPath !== '' && !isAbsolute(rootPath)) {
			throw new FilePilotError(
				'SCAN_ROOT_INVALID',
				'Scan root must be an absolute path',
			);
		}

		if (rootPath !== '') {
			let isDirectory: boolean;

			try {
				const info = await stat(rootPath);
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
	}

	async updateSettings(
		changes: SettingsChanges,
	): Promise<SettingsUpdateResult> {
		const currentData = this.getData();
		const nextData = structuredClone(currentData);

		const result: SettingsUpdateResult = {
			updated: [],
			errors: {},
		};

		// 1. validate and handle rootpath scanning
		if (changes.rootPath !== undefined) {
			const newPath = changes.rootPath.trim();

			if (newPath !== currentData.settingData.fileScope.rootPath) {
				try {
					await this.validateRootPath(
						newPath,
						currentData,
					);

					nextData.settingData.fileScope.rootPath = newPath;
					result.updated.push('rootPath');
				} catch (error) {
					if (!(error instanceof FilePilotError)) {
						throw error;
					}

					result.errors.rootPath = error;
				}
			}
		}

		// 2. validate and handle Ignore rule
		if (changes.ignorePatterns !== undefined) {
			// Remove empty lines, but preserve other pattern characters.
			const nextPatterns = changes.ignorePatterns.filter(
				(pattern) => pattern.trim().length > 0,
			);

			try {
				// Validate with the same parser used by FileScanner.
				ignore().add(nextPatterns);


				const previous =
					currentData.settingData.fileScope.ignorePatterns;

				const unchanged =
					previous.length === nextPatterns.length
					&& previous.every(
						(pattern, index) => pattern === nextPatterns[index],
					);

				if (!unchanged) {
					nextData.settingData.fileScope.ignorePatterns = nextPatterns;
					result.updated.push('ignorePatterns');
				}
			} catch (error) {
				result.errors.ignorePatterns =
					error instanceof Error
						? error
						: new Error(String(error));
			}
		}

		// 3. Update ShadowNotes visibility preference.
		if (changes.hideShadowNotesInExplorer !== undefined) {
			const hidden = changes.hideShadowNotesInExplorer;

			if (
				hidden !==
				currentData.settingData.hideShadowNotesInExplorer
			) {
				nextData.settingData.hideShadowNotesInExplorer = hidden;
				result.updated.push('hideShadowNotesInExplorer');
			}
		}

		if (result.updated.length === 0) {
			return result;
		}

		await this.save(nextData);

		return result;
	}


	private async save(data: Data): Promise<void> {
		await this.dataAdapter.saveData(data);
		this.data = data;
	}

	private getData(): Data {
		if (this.data === null) {
			throw new FilePilotError('DATA_LOST', 'Plugin data has lost');
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


