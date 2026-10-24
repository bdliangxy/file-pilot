import { Plugin } from 'obsidian';
import { PluginStateService } from './data/plugin-state-service';
import { logger } from './utils/logger';
import { FilePilotSettingTab } from './ui/file-pilot-setting-tab';
import { t } from './i18n/index';
import { FileScanner } from './core/file-scanner';
import { ShadowNoteService } from './core/shadow-note';
import { FilePilotView, VIEW_TYPE } from './ui/file-pilot-view';
import { FileSyncService } from './core/file-sync';
import type { SyncResult } from './core/file-sync';

export default class FilePilotPlugin extends Plugin {
	//he state service owns and persists all plugin data.
	public readonly stateService = new PluginStateService({
		loadData: () => this.loadData(),
		saveData: (data) => this.saveData(data),
	});
	private fileSyncService!: FileSyncService;
	public shadowNoteService!: ShadowNoteService;


	async onload(): Promise<void> {

		// Load persisted plugin data.
		await this.stateService.load();

		this.shadowNoteService = new ShadowNoteService(this.app);
		// Initialize file synchronization.
		this.fileSyncService = new FileSyncService(
			new FileScanner(),
			this.shadowNoteService,
			(records) => this.stateService.addFileRecords(records),
			() => this.stateService.getFileRecords(),
		);

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

}
