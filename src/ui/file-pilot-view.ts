import {
	type App,
	ItemView,
	Notice,
	Setting,
	setIcon,
	WorkspaceLeaf,
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
import ignore, { type Ignore } from 'ignore';

import {
	getDisplayStatus,
	type FileDisplayStatus,
} from '../utils/ignore-rule-utils';
import {
	searchFileRecords,
	type FileSearchCriteria,
} from '../utils/file-search-utils';

import {
	filterFileRecords,
	type FileFilterCriteria,
} from '../utils/file-filter-utils';

import {
	resolveFileItemAction,
	type FileItemRegion,
	type FileItemOpenAction,
} from '../utils/file-item-gestures';

export const VIEW_TYPE = 'file-pilot-view';
interface FileItemState {
	record: FileRecord;
	secondaryEl: HTMLDivElement;
	absolutePath: string;
	/**
	 * an asynchronous request version number,
	 * used to ensure that only the most recently triggered
	 * refresh is allowed to modify the UI
	 */
	summaryUpdateVersion: number;

	isEditing: boolean;
	isSaving: boolean;
	originalSummary: string;
	draft: string;
	inputEl: HTMLInputElement | null;
}

export class FilePilotView extends ItemView {
	navigation = false;// Keep this view as a fixed panel rather than a navigable document view.
	private scanning = false;
	private rootSetting: Setting | null = null;

	private fileCountEl: HTMLDivElement | null = null;
	private filesSectionEl: HTMLDivElement | null = null;

	private searchCriteria: FileSearchCriteria = {
		query: '',
	};

	private filterCriteria: FileFilterCriteria = {
		status: 'all',
	};
	// Maps Shadow Note paths to their corresponding File Item UI elements.
	private readonly mapNotePathItemState =
		new Map<string, FileItemState>();
	// Unsubscribes from Shadow Note content change notifications.
	private unsubscribeNoteChanged: (() => void) | null = null;

	private showFileActionError(
		error: unknown,
		action: FileItemOpenAction,
		record: FileRecord,
	): void {
		console.error(
			'File item action failed:',
			action,
			record.path,
			error,
		);

		let message = t('fileActionFailed');

		if (error instanceof FilePilotError) {
			switch (error.code) {
				case 'SOURCE_FILE_NOT_FOUND':
					message = t('sourceFileNotFound');
					break;

				case 'SHADOW_NOTE_NOT_FOUND':
					message = t('shadowNoteNotFound');
					break;

				case 'FILE_OPEN_FAILED':
					if (action === 'openShadowNote') {
						message = t('shadowNoteOpenFailed');
					} else if (
						action === 'openContainingFolder' ||
						record.kind === 'folder'
					) {
						message = t('folderOpenFailed');
					} else {
						message = t('sourceFileOpenFailed');
					}
					break;
			}
		}

		new Notice(message);
	}


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

	refreshProjectName(): void {
		this.rootSetting?.setName(
			this.filePilot.stateService.getProjectName()
			|| t('scanRootName')
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

		const rootSetting = new Setting(overviewSection)
			.setName(
				this.filePilot.stateService.getProjectName()
				|| t('scanRootName')
			)
			.setDesc(rootPath || t('scanRootNotConfigured'))
		// Group the settings button and project title.
		const titleRowEl = rootSetting.infoEl.createDiv({
			cls: 'file-pilot-overview-title-row',
		});

		// Move the title row before the description.
		rootSetting.nameEl.before(titleRowEl);

		const settingsButton = titleRowEl.createEl('button', {
			// cls: 'file-pilot-overview-settings-button',
			cls: 'clickable-icon file-pilot-overview-settings-button',
			attr: {
				type: 'button',
				'aria-label': 'Open file pilot settings',
			},
		});

		setIcon(settingsButton, 'settings');

		settingsButton.addEventListener('click', () => {
			void this.openPluginSettings();
		});

		// Move the existing title into the title row.
		titleRowEl.appendChild(rootSetting.nameEl);
		rootSetting.addButton((button) => {
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
							new Notice(t('scanCompleted', {
								fileCount: result.importedFileCount,
								folderCount: result.importedFolderCount,
							}));
						} else {
							new Notice(t('noNewImportedEntries'));
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

								case 'CLEAR_IN_PROGRESS':
									new Notice(t('clearInProgress'));
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

		this.rootSetting = rootSetting;
		// Create the managed file count.
		this.fileCountEl = overviewSection.createDiv({
			cls: 'file-pilot-managed-count',
		});

		// Search section.
		const searchSection = contentEl.createDiv({
			cls: 'file-pilot-search-section',
		});

		new Setting(searchSection)
			.addSearch(search => {
				search
					.setPlaceholder(t('fileSearchPlaceholder'))
					.setValue(this.searchCriteria.query)
					.onChange(value => {
						this.searchCriteria.query = value;
						this.refreshQueryResults();
					});
			});

		// Filter section.
		const filterSection = contentEl.createDiv({
			cls: 'file-pilot-filter-section',
		});

		const filterSetting = new Setting(filterSection);

		filterSetting.addDropdown(dropdown => {
			dropdown
				.addOption('all', t('filterStatusAll'))
				.addOption('available', t('fileStatusAvailable'))
				.addOption('missing', t('fileStatusMissing'))
				.addOption('ignored', t('fileStatusIgnored'))
				.setValue(this.filterCriteria.status)
				.onChange(value => {
					this.filterCriteria.status =
						value as FileFilterCriteria['status'];

					this.refreshQueryResults();
				});

			dropdown.selectEl.setAttribute(
				'aria-label',
				t('filterStatusLabel'),
			);
		});

		// Future filters can be added to filterSetting.

		// Create the scrollable files section.
		this.filesSectionEl = contentEl.createDiv({
			cls: 'file-pilot-files-section',
		});

		// Subscribe to Shadow Note content changes.
		if (!this.unsubscribeNoteChanged) {
			this.unsubscribeNoteChanged =
				this.filePilot.shadowNoteWatcher.onNoteChanged(
					(notePath) => {
						const item =
							this.mapNotePathItemState.get(notePath);

						if (!item) {
							return;
						}

						void this.updateFileSummary(item);
					},
				);
		}

		// Render the initial file list.
		this.refreshFileList();
	}

	async onClose(): Promise<void> {
		this.unsubscribeNoteChanged?.();
		this.unsubscribeNoteChanged = null;

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

		// Count managed files and folders separately.
		const fileCount = records.filter(
			record => record.kind === 'file'
		).length;

		const folderCount =
			records.length - fileCount;

		// Update the managed entry count.
		this.fileCountEl.setText(
			t('managedEntryCount', {
				fileCount,
				folderCount,
			})
		);

		// Build the ignore matcher for the current refresh.
		const matcher = ignore().add(
			this.filePilot.stateService.getIgnorePatterns(),
		);

		// Create a temporary result set from all records.
		let draft: FileRecord[] = records;

		// Apply the enabled filter.
		if (this.filterCriteria.status !== 'all') {
			draft = filterFileRecords(
				draft,
				matcher,
				this.filterCriteria,
			);
		}

		// Apply the enabled search.
		if (this.searchCriteria.query.trim() !== '') {
			draft = searchFileRecords(
				draft,
				this.searchCriteria,
			);
		}

		// Render the resulting records.
		this.renderFileList(
			draft,
			matcher,
			records.length > 0,
		);

	}

	private renderFileList(
		records: FileRecord[],
		matcher: Ignore,
		hasSourceRecords: boolean,
	): void {
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
				text: hasSourceRecords
					? t('noMatchingFiles')
					: t('emptyFileList'),
			});
			return;
		}
		const rootPath = this.filePilot.stateService.getRootPath();

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
			cls: record.kind === 'folder'
				? 'file-pilot-file-name file-pilot-folder-name'
				: 'file-pilot-file-name',
			text: getFullName(record.path),
		});

		// Create a shared interactive region for the text and edit icon.
		const secondaryWrapEl = infoEl.createDiv({
			cls: 'file-pilot-file-secondary-wrap',
		});

		const secondaryEl = secondaryWrapEl.createDiv({
			cls: 'file-pilot-file-secondary file-pilot-file-path',
			text: absolutePath,
		});

		// Create an accessible button for editing File Summary.
		const editButtonEl = secondaryWrapEl.createEl('button', {
			cls: 'file-pilot-summary-edit-button',
			attr: {
				type: 'button',
				'aria-label': t('fileSummaryEdit'),
				title: t('fileSummaryEdit'),
			},
		});

		setIcon(editButtonEl, 'pencil');

		const fileItemState: FileItemState = {
			record,
			secondaryEl,
			absolutePath,
			summaryUpdateVersion: 0,
			isEditing: false,
			isSaving: false,
			originalSummary: '',
			draft: '',
			inputEl: null,
		};

		this.mapNotePathItemState.set(
			record.shadowNotePath,
			fileItemState,
		);

		// Single-click the pencil to edit File Summary.
		editButtonEl.addEventListener('click', event => {
			// Preserve existing Ctrl/Alt item shortcuts.
			if (event.ctrlKey || event.altKey) {
				return;
			}

			event.stopPropagation();

			void this.startSummaryEdit(fileItemState);
		});

		// Prevent a double-click on the button from reaching the item.
		editButtonEl.addEventListener('dblclick', event => {
			event.stopPropagation();
		});

		void this.updateFileSummary(fileItemState);

		// Right: file size and status.
		const metaEl = itemEl.createDiv({
			cls: 'file-pilot-file-meta',
		});

		metaEl.createDiv({
			cls: 'file-pilot-file-size',
			text: record.kind === 'file'
				? formatFileSize(record.size)
				: '—',
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

		// Handle file item mouse gestures.
		const handleGesture = (event: MouseEvent): void => {
			// Ignore the second click generated by a double-click.
			if (event.type === 'click' && event.detail > 1) {
				return;
			}

			const region: FileItemRegion =
				secondaryWrapEl.contains(event.target as Node)
					? 'secondary'
					: 'item';

			const action = resolveFileItemAction(event, region);

			if (!action) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (action === 'editSummary') {
				void this.startSummaryEdit(fileItemState);
				return;
			}

			void this.filePilot
				.executeFileItemAction(action, record)
				.catch((error: unknown) => {
					this.showFileActionError(error, action, record);
				});
		};

		itemEl.addEventListener('click', handleGesture);
		itemEl.addEventListener('dblclick', handleGesture);
	}

	private async updateFileSummary(
		item: FileItemState,
	): Promise<void> {
		if (item.isEditing) {
			return;
		}
		const summaryUpdateVersion = ++item.summaryUpdateVersion;

		try {
			const summary =
				await this.filePilot.shadowNoteService
					.getFileSummary(item.record);

			// Ignore outdated asynchronous results.
			if (
				item.isEditing ||
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

	private async openPluginSettings(): Promise<void> {
		const settings = (this.app as App & {
			setting: {
				open(): Promise<void> | void;
				openTabById(id: string): void;
			};
		}).setting;

		await settings.open();
		settings.openTabById(this.filePilot.manifest.id);
	}

	private refreshQueryResults(): void {
		// Reset the scroll position when query conditions change.
		if (this.filesSectionEl) {
			this.filesSectionEl.scrollTop = 0;
		}

		this.refreshFileList();
	}

	private async startSummaryEdit(
		item: FileItemState,
	): Promise<void> {
		if (item.isEditing) {
			return;
		}

		// Enter editing mode before starting the asynchronous read.
		item.isEditing = true;

		// Invalidate any pending summary display updates.
		++item.summaryUpdateVersion;

		try {
			const summary =
				await this.filePilot.shadowNoteService
					.getFileSummary(item.record);

			// The item may have been removed while awaiting the read.
			if (
				!item.isEditing ||
				!item.secondaryEl.isConnected ||
				this.mapNotePathItemState.get(
					item.record.shadowNotePath,
				) !== item
			) {
				return;
			}

			item.originalSummary = summary ?? '';
			item.draft = item.originalSummary;

			const secondaryEl = item.secondaryEl;

			secondaryEl.empty();
			secondaryEl.removeClass(
				'file-pilot-file-path',
				'file-pilot-file-summary',
			);
			secondaryEl.addClass('file-pilot-file-editing');

			const inputEl = secondaryEl.createEl('input', {
				cls: 'file-pilot-summary-editor',
				attr: {
					type: 'text',
					placeholder: t('fileSummaryPlaceholder'),
					'aria-label': t('fileSummaryPlaceholder'),
				},
			});

			item.inputEl = inputEl;
			inputEl.value = item.draft;

			inputEl.addEventListener('input', () => {
				item.draft = inputEl.value;
			});

			// Keep text selection and modifier-clicks inside the editor.
			inputEl.addEventListener('click', event => {
				event.stopPropagation();
			});

			inputEl.addEventListener('dblclick', event => {
				event.stopPropagation();
			});

			inputEl.addEventListener('keydown', event => {
				// Do not treat IME confirmation as an Enter submission.
				if (event.isComposing) {
					return;
				}

				if (event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();

					void this.commitSummaryEdit(item);
					return;
				}

				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();

					this.cancelSummaryEdit(item);
				}
			});

			inputEl.addEventListener('blur', () => {
				void this.commitSummaryEdit(item);
			});

			inputEl.focus();
			inputEl.select();
		} catch (error) {
			item.isEditing = false;

			console.error(
				'Failed to start File Summary editing:',
				item.record.shadowNotePath,
				error,
			);

			new Notice(t('fileActionFailed'));
		}
	}


	private cancelSummaryEdit(item: FileItemState): void {
		if (!item.isEditing || item.isSaving) {
			return;
		}

		this.finishSummaryEdit(
			item,
			item.originalSummary,
		);
	}

	private finishSummaryEdit(
		item: FileItemState,
		summary: string,
	): void {
		item.isEditing = false;
		item.isSaving = false;
		item.inputEl = null;
		item.draft = '';

		const secondaryEl = item.secondaryEl;

		secondaryEl.removeClass('file-pilot-file-editing');

		if (summary) {
			secondaryEl.removeClass('file-pilot-file-path');
			secondaryEl.addClass('file-pilot-file-summary');
			secondaryEl.setText(summary);
		} else {
			secondaryEl.removeClass('file-pilot-file-summary');
			secondaryEl.addClass('file-pilot-file-path');
			secondaryEl.setText(item.absolutePath);
		}

		// Reconcile the display with the latest Shadow Note content.
		void this.updateFileSummary(item);
	}


	private async commitSummaryEdit(
		item: FileItemState,
	): Promise<void> {
		if (!item.isEditing || item.isSaving) {
			return;
		}

		const inputEl = item.inputEl;

		if (!inputEl) {
			return;
		}

		const newSummary = inputEl.value.trim();
		item.draft = newSummary;

		// Avoid unnecessary writes when nothing has changed.
		if (newSummary === item.originalSummary.trim()) {
			this.finishSummaryEdit(
				item,
				item.originalSummary,
			);
			return;
		}

		// Lock the editor while the write is in progress.
		item.isSaving = true;
		inputEl.readOnly = true;

		try {
			await this.filePilot.shadowNoteService
				.updateFileSummary(
					item.record,
					newSummary,
				);

			this.finishSummaryEdit(item, newSummary);

		} catch (error) {
			item.isSaving = false;
			inputEl.readOnly = false;

			console.error(
				'Failed to save File Summary:',
				item.record.shadowNotePath,
				error,
			);

			new Notice(t('fileActionFailed'));
		}
	}


}
