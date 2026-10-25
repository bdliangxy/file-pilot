import {
	ItemView,
	Notice,
	Setting,
	WorkspaceLeaf,
	type EventRef,
} from 'obsidian';

import type FilePilotPlugin from '../main';
import { t } from '../i18n';
import { FilePilotError } from '../error';
import type { FileRecord } from '../core/file-interface';
import {
	getFullName,
	getAbsoluteFilePath,
} from '../utils/path-utils';
import { formatFileSize } from '../utils/file-utils';
import ignore from 'ignore';

import {
	getDisplayStatus,
	type FileDisplayStatus,
} from '../utils/ignore-rule-utils';

export const VIEW_TYPE = 'file-pilot-view';
interface FileItemState {
	record: FileRecord;
	secondaryEl: HTMLDivElement;
	absolutePath: string;
	summaryUpdateVersion: number;//an asynchronous request version number, used to ensure that only the most recently triggered refresh is allowed to modify the UI
}

export class FilePilotView extends ItemView {
	navigation = false;// Keep this view as a fixed panel rather than a navigable document view.
	private scanning = false;
	private rootSetting: Setting | null = null;

	private fileCountEl: HTMLDivElement | null = null;
	private filesSectionEl: HTMLDivElement | null = null;
	// Maps Shadow Note paths to their corresponding File Item UI elements.
	private readonly mapNotePathItemState =
		new Map<string, FileItemState>();
	// Holds the MetadataCache event reference for automatic summary updates.
	private summaryChangeRef: EventRef | null = null;

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
		contentEl.addClass('file-pilot-view-content');
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

		// Create the scrollable files section.
		this.filesSectionEl = contentEl.createDiv({
			cls: 'file-pilot-files-section',
		});

		// Listen for updates to indexed Shadow Notes.
		if (!this.summaryChangeRef) {
			this.summaryChangeRef =
				this.app.metadataCache.on('changed', (file) => {
					const item = this.mapNotePathItemState.get(file.path);

					if (!item) {
						return;
					}

					void this.updateFileSummary(item);
				});
		}

		// Render the initial file list.
		this.refreshFileList();
	}

	async onClose(): Promise<void> {
		if (this.summaryChangeRef) {
			this.app.metadataCache.offref(
				this.summaryChangeRef,
			);
			this.summaryChangeRef = null;
		}

		this.mapNotePathItemState.clear();
		this.rootSetting = null;
		this.fileCountEl = null;
		this.filesSectionEl = null;
		this.contentEl.removeClass('file-pilot-view-content');
		this.contentEl.empty();
	}

	refreshFileList(): void {
		if (!this.fileCountEl || !this.filesSectionEl) {
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
		const listEl = this.filesSectionEl;

		if (!listEl) {
			return;
		}
		const previousScrollTop = listEl.scrollTop;

		// Discard references to previously rendered items.
		this.mapNotePathItemState.clear();

		// Clear previously rendered items.
		listEl.empty();

		if (records.length === 0) {
			listEl.createDiv({
				cls: 'file-pilot-file-empty',
				text: t('emptyFileList'),
			});
			return;
		}
		const rootPath = this.filePilot.stateService.getRootPath();
		const matcher = ignore().add(
			this.filePilot.stateService.getIgnorePatterns(),
		);

		// // Render file items.
		for (const record of records) {
			const displayStatus = getDisplayStatus(
				record,
				matcher,
			);
			this.renderFileItem(
				listEl,
				record,
				rootPath,
				displayStatus,
			);
		}
		listEl.scrollTop = previousScrollTop;
	}


	private renderFileItem(
		listEl: HTMLDivElement,
		record: FileRecord,
		rootPath: string,
		displayStatus: FileDisplayStatus,
	): void {
		const absolutePath = getAbsoluteFilePath(
			rootPath,
			record.path,
		);

		// Create the main file item container.
		const itemEl = listEl.createDiv({
			cls: 'file-pilot-file-item',
		});

		// Left: name and secondary text.
		const infoEl = itemEl.createDiv({
			cls: 'file-pilot-file-info',
		});

		infoEl.createDiv({
			cls: 'file-pilot-file-name',
			text: getFullName(record.path),
		});

		const secondaryEl = infoEl.createDiv({
			cls: 'file-pilot-file-secondary file-pilot-file-path',
			text: absolutePath,
		});

		const fileItemState: FileItemState = {
			record,
			secondaryEl,
			absolutePath,
			summaryUpdateVersion: 0,
		};

		this.mapNotePathItemState.set(
			record.shadowNotePath,
			fileItemState,
		);

		void this.updateFileSummary(fileItemState);

		// Right: file size and status.
		const metaEl = itemEl.createDiv({
			cls: 'file-pilot-file-meta',
		});

		metaEl.createDiv({
			cls: 'file-pilot-file-size',
			text: formatFileSize(record.size),
		});

		const statusText =
			displayStatus === 'ignored'
				? t('fileStatusIgnored')
				: displayStatus === 'available'
					? t('fileStatusAvailable')
					: t('fileStatusMissing');

		metaEl.createDiv({
			cls: `file-pilot-file-status file-pilot-status-${displayStatus}`,
			text: statusText,
		});
	}

	private async updateFileSummary(
		item: FileItemState,
	): Promise<void> {
		const summaryUpdateVersion = ++item.summaryUpdateVersion;

		try {
			const summary =
				await this.filePilot.shadowNoteService
					.getFileSummary(item.record);

			// Ignore outdated asynchronous results.
			if (
				summaryUpdateVersion !== item.summaryUpdateVersion ||
				!item.secondaryEl.isConnected ||
				this.mapNotePathItemState.get(
					item.record.shadowNotePath
				) !== item
			) {
				return;
			}

			if (summary) {
				item.secondaryEl.removeClass(
					'file-pilot-file-path',
				);
				item.secondaryEl.addClass(
					'file-pilot-file-summary',
				);
				item.secondaryEl.setText(summary);
			} else {
				item.secondaryEl.removeClass(
					'file-pilot-file-summary',
				);
				item.secondaryEl.addClass(
					'file-pilot-file-path',
				);
				item.secondaryEl.setText(
					item.absolutePath,
				);
			}
		} catch (error) {
			console.error(
				'File Pilot failed to update file summary:',
				item.record.shadowNotePath,
				error,
			);
		}
	}

}
