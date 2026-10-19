import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';

import type FilePilotPlugin from '../main';
import { t } from '../i18n';
import { FilePilotError } from '../error';

export const VIEW_TYPE = 'file-pilot-view';

export class FilePilotView extends ItemView {
	navigation = false;
	private scanning = false;
	private rootSetting: Setting | null = null;

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
		const scanRow = contentEl.createDiv();

		const rootPath =
			this.filePilot.stateService.getRootPath();

		this.rootSetting = new Setting(scanRow)
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
	}

	async onClose(): Promise<void> {
		this.rootSetting = null;
		this.contentEl.empty();
	}
}
