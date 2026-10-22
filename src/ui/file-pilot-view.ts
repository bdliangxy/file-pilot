import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';

import type FilePilotPlugin from '../main';
import { t } from '../i18n';
import { FilePilotError } from '../error';
import type { FileRecord } from '../core/file-interface';
import { getFullName } from '../utils/path-utils';

export const VIEW_TYPE = 'file-pilot-view';

export class FilePilotView extends ItemView {
	navigation = false;// Keep this view as a fixed panel rather than a navigable document view.
	private scanning = false;
	private rootSetting: Setting | null = null;

	private fileCountEl: HTMLDivElement | null = null;
	private fileListEl: HTMLDivElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly filePilot: FilePilotPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('pluginTitle');
	}

	getIcon(): string {
		return 'spline-pointer';
	}

	refreshRootPath(): void {
		this.rootSetting?.setDesc(
			this.filePilot.stateService.getRootPath()
			|| t('scanRootNotConfigured')
		);
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		// Create the overview section.
		const overviewSection = contentEl.createDiv({
			cls: 'file-pilot-overview',
		});

		const rootPath =
			this.filePilot.stateService.getRootPath();

		this.rootSetting = new Setting(overviewSection)
			.setName(t('scanRootName'))
			.setDesc(rootPath || t('scanRootNotConfigured'))
			.addButton((button) => {
				button
					.setButtonText(t('oneWayScan'))
					.setCta()
					.onClick(async () => {
						if (this.scanning) {
							return;
						}

						this.scanning = true;
						button.setDisabled(true);
						button.setButtonText(t('scanning'));

						try {
							const result = await this.filePilot.syncFiles();
							if (result.importedCount > 0) {
								new Notice(t('scanCompleted', { count: result.importedCount, }));
							} else {
								new Notice(t('noNewImportedFile'));
							}
							// Update the list after a successful scan.
							this.refreshFileList();

						} catch (error) {
							if (error instanceof FilePilotError) {
								switch (error.code) {
									case 'SYNC_IN_PROGRESS':
										new Notice(t('syncAlreadyInProgress'));
										return;

									case 'SCAN_ROOT_NOT_CONFIGURED':
										new Notice(t('scanRootNotConfigured'));
										return;
								}
							}
							console.error('File Pilot scan failed:', error);
							new Notice(t('scanFailed'));
						} finally {
							this.scanning = false;
							button.setDisabled(false);
							button.setButtonText(t('oneWayScan'));
						}
					});
			});
		// Create the managed file count.
		this.fileCountEl = overviewSection.createDiv({
			cls: 'file-pilot-managed-count',
		});

		// The search section will be inserted here in the future.

		// Create the files section.
		const filesSection = contentEl.createDiv({
			cls: 'file-pilot-files-section',
		});

		filesSection.createEl('h3', {
			text: t('fileListTitle'),
			cls: 'file-pilot-files-title',
		});

		// Create the file list container.
		this.fileListEl = filesSection.createDiv({
			cls: 'file-pilot-file-list',
		});

		// Render the initial file list.
		this.refreshFileList();
	}

	async onClose(): Promise<void> {
		this.rootSetting = null;
		this.fileCountEl = null;
		this.fileListEl = null;
		this.contentEl.empty();
	}

	private refreshFileList(): void {
		if (!this.fileCountEl || !this.fileListEl) {
			return;
		}

		// Read the current FileRecord snapshot.
		const records =
			this.filePilot.stateService.getFileRecords();

		// Update the total number of managed files.
		this.fileCountEl.setText(
			t('managedFileCount', {
				count: records.length,
			})
		);

		// Render the file list.
		this.renderFileList(records);
	}

	private renderFileList(records: FileRecord[]): void {
		const listEl = this.fileListEl;

		if (!listEl) {
			return;
		}

		// Clear previously rendered items.
		listEl.empty();

		if (records.length === 0) {
			listEl.createDiv({
				cls: 'file-pilot-file-empty',
				text: t('emptyFileList'),
			});
			return;
		}

		// Render file names.
		for (const record of records) {
			listEl.createDiv({
				cls: 'file-pilot-file-name',
				text: getFullName(record.path),
			});
		}
	}
}
