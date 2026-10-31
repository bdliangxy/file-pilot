import { DEFAULT_SETTINGS, type SettingData, MAX_PROJECT_NAME_LENGTH } from './setting-data';
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
	projectName?: string;
	ignorePatterns?: string[];
	hideShadowNotesFlag?: boolean;
}

export interface SettingsUpdateResult {
	updated: (keyof SettingsChanges)[];
	errors: Partial<Record<keyof SettingsChanges, Error>>;
}

export class PluginStateService {
	private data: Data | null = null;
	private clearInProgress = false;
	private mutationQueue: Promise<void> = Promise.resolve();
	constructor(private readonly dataAdapter: DataAdapter) { }
	get isClearingData(): boolean {
		return this.clearInProgress;
	}
	beginClearing(): void {
		if (this.clearInProgress) {
			throw new FilePilotError(
				'CLEAR_IN_PROGRESS',
				'Data clearing already in progress',
			);
		}

		this.clearInProgress = true;
	}
	endClearing(): void {
		this.clearInProgress = false;
	}
	// Responsible for serializing data modifications;
	// new tasks are always queued after the previous task.
	private enqueueMutation<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		const task = this.mutationQueue.then(operation);

		this.mutationQueue = task.then(
			() => undefined,
			() => undefined,
		);

		return task;
	}
	// Responsible for admission control of regular modifications.
	// As long as clearing is in progress, reject any new regular data modifications.
	// This check is executed synchronously before the task enters the queue, so it does not need to wait for the previous task to finish.
	private enqueueRegularMutation<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		if (this.clearInProgress) {
			return Promise.reject(
				new FilePilotError(
					'CLEAR_IN_PROGRESS',
					'Cannot modify data while clearing',
				),
			);
		}

		return this.enqueueMutation(operation);
	}
	// Once clearing starts, new tasks are first blocked from entering,
	// and then it waits for all already-accepted tasks to finish.
	// Therefore, there is no situation where notes are being deleted during clearing
	// while earlier settings modifications are still being asynchronously written to `data.json`.
	async waitForPendingMutations(): Promise<void> {
		await this.mutationQueue;
	}
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
	getProjectName(): string {
		return this.getData().settingData.projectName;
	}
	getHideShadowNotesFlag(): boolean {
		return this.getData().settingData.hideShadowNotesFlag;
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

		return this.enqueueRegularMutation(async () => {
			const nextData = structuredClone(this.getData());

			const fileRecords = nextData.pluginData.fileRecords;

			const existingIds = new Set(
				fileRecords.map(record => record.id),
			);

			const existingPaths = new Set(
				fileRecords.map(record => record.path),
			);

			for (const record of records) {
				if (existingIds.has(record.id)) {
					throw new Error('Duplicate FileRecord ID');
				}

				if (existingPaths.has(record.path)) {
					throw new Error('Duplicate FileRecord path');
				}

				existingIds.add(record.id);
				existingPaths.add(record.path);
			}

			fileRecords.push(...structuredClone(records));

			await this.save(nextData);
		});
	}
	async removeFileRecord(id: string): Promise<void> {
		return this.enqueueRegularMutation(async () => {
			const nextData = structuredClone(this.getData());

			const records = nextData.pluginData.fileRecords;

			const index = records.findIndex(
				record => record.id === id,
			);

			if (index === -1) {
				return;
			}

			records.splice(index, 1);

			await this.save(nextData);
		});
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
		return this.enqueueRegularMutation(async () => {
			const currentData = this.getData();
			const nextData = structuredClone(currentData);

			const result: SettingsUpdateResult = {
				updated: [],
				errors: {},
			};
			// validate and handle rootpath scanning
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
			// Validate and update the project name.
			if (changes.projectName !== undefined) {
				const newName = changes.projectName.trim();

				const hasControlCharacters = Array.from(newName).some(
					(char) => {
						const code = char.codePointAt(0)!;
						return code < 32 || code === 127;
					},
				);

				if (
					Array.from(newName).length > MAX_PROJECT_NAME_LENGTH ||
					hasControlCharacters
				) {
					result.errors.projectName =
						new Error('Invalid project name');
				} else if (
					newName !== (currentData.settingData.projectName)
				) {
					nextData.settingData.projectName = newName;
					result.updated.push('projectName');
				}
			}
			// validate and handle Ignore rule
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

			// Update ShadowNotes visibility preference.
			if (changes.hideShadowNotesFlag !== undefined) {
				const hidden = changes.hideShadowNotesFlag;

				if (
					hidden !==
					currentData.settingData.hideShadowNotesFlag
				) {
					nextData.settingData.hideShadowNotesFlag = hidden;
					result.updated.push('hideShadowNotesFlag');
				}
			}

			if (result.updated.length === 0) {
				return result;
			}

			await this.save(nextData);

			return result;
		});
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

	async resetAllData(): Promise<void> {
		if (!this.clearInProgress) {
			throw new Error(
				'Data reset requires an active clearing operation',
			);
		}

		return this.enqueueMutation(async () => {
			const defaultData = structuredClone(DEFAULT_DATA);

			await this.save(defaultData);
		});
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


