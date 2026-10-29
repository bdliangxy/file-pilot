import { Plugin } from 'obsidian';
import { PluginStateService } from './data/plugin-state-service';
import { logger } from './utils/logger';
import { FilePilotSettingTab } from './ui/file-pilot-setting-tab';
import { t } from './i18n/index';
import { FileScanner } from './core/file-scanner';
import { ShadowNoteService } from './core/shadow-note-service';
import { FilePilotView, VIEW_TYPE } from './ui/file-pilot-view';
import { FileSyncService } from './core/file-sync';
import type { SyncResult } from './core/file-sync';
import { ShadowNoteWatcher } from './core/shadow-note-watcher';
import { setShadowNotesHidden } from './ui/obsidian-ui';
import { FilePilotError } from './error';

export default class FilePilotPlugin extends Plugin {
	//he state service owns and persists all plugin data.
	public readonly stateService = new PluginStateService({
		loadData: () => this.loadData(),
		saveData: (data) => this.saveData(data),
	});
	private fileSyncService!: FileSyncService;
	public shadowNoteService!: ShadowNoteService;
	public shadowNoteWatcher!: ShadowNoteWatcher;
	private clearInProgress = false;

	async onload(): Promise<void> {

		// Load persisted plugin data.
		await this.stateService.load();
		// Apply ShadowNotes visibility settings.
		this.applyShadowNotesVisibility();
		this.shadowNoteService = new ShadowNoteService(this.app);
		// Initialize file synchronization.
		this.fileSyncService = new FileSyncService(
			new FileScanner(),
			this.shadowNoteService,
			(records) => this.stateService.addFileRecords(records),
			() => this.stateService.getFileRecords(),
		);

		// Initialize the Shadow Note watcher.
		this.shadowNoteWatcher = new ShadowNoteWatcher(
			this.app.vault,
			this.app.metadataCache,
			this.stateService,
			() => this.refreshViewFileList(),
		);

		this.addChild(this.shadowNoteWatcher);

		// Register settings.
		this.addSettingTab(
			new FilePilotSettingTab(this.app, this),
		);

		// Register the File Pilot view.
		this.registerView(
			VIEW_TYPE,
			(leaf) => new FilePilotView(leaf, this),
		);

		// Add the ribbon icon.
		this.addRibbonIcon(
			'spline-pointer',
			t('filePilotRibbonTooltip'),
			() => {
				void this.activateFilePilotView();
			},
		);

		logger.debug('Plugin loaded', {
			fileRecordCount: this.stateService.getFileRecordCount(),
		});
	}

	onunload(): void {
		setShadowNotesHidden(false);
		logger.debug('Plugin unloaded');
	}
	private async activateFilePilotView(): Promise<void> {
		const workspace = this.app.workspace;

		const existingLeaf =
			workspace.getLeavesOfType(VIEW_TYPE)[0];

		if (existingLeaf) {
			await workspace.revealLeaf(existingLeaf);
			return;
		}
		await workspace.ensureSideLeaf(
			VIEW_TYPE,
			'right',
			{
				active: true,
				reveal: true,
			},
		);
	}

	async syncFiles(): Promise<SyncResult> {
		if (this.clearInProgress) {
			throw new FilePilotError(
				'CLEAR_IN_PROGRESS',
				'Cannot scan while clearing data',
			);
		}
		return this.fileSyncService.syncFiles(
			this.stateService.getFileScope(),
		);
	}

	refreshViewRootPath(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);

		for (const leaf of leaves) {
			if (leaf.view instanceof FilePilotView) {
				leaf.view.refreshRootPath();
			}
		}
	}

	refreshViewFileList(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);

		for (const leaf of leaves) {
			if (leaf.view instanceof FilePilotView) {
				leaf.view.refreshFileList();
			}
		}
	}

	applyShadowNotesVisibility(): void {
		setShadowNotesHidden(
			this.stateService.getHideShadowNotesFlag()
		);
	}

	async clearUserData(): Promise<void> {
		if (this.clearInProgress) {
			throw new FilePilotError(
				'CLEAR_IN_PROGRESS',
				'Data clearing already in progress',
			);
		}

		if (this.fileSyncService.isSyncInProgress) {
			throw new FilePilotError(
				'SYNC_IN_PROGRESS',
				'Cannot clear data while scanning',
			);
		}
		this.clearInProgress = true;
		try {
			await this.shadowNoteService.deleteAllShadowNotes();

			await this.shadowNoteWatcher.waitForPendingDeletions();

			await this.stateService.resetAllData();

			this.refreshViewRootPath();
			this.refreshViewFileList();
			this.applyShadowNotesVisibility();
		} finally {
			this.clearInProgress = false;
		}

	}

}
