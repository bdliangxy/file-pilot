import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	type TextComponent,
} from 'obsidian';

import type FilePilotPlugin from '../main';
import { FilePilotError } from '../error';
import { t } from '../i18n';
import { pickFolder } from './folder-picker';

export class FilePilotSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly filePilot: FilePilotPlugin,
	) {
		super(app, filePilot);
	}

	getSettingDefinitions() {
		return [
			{
				name: t('scanRootName'),
				desc: t('scanRootDesc'),

				render: (setting: Setting) => {

					let pathInput: TextComponent;

					setting
						.addText((text) => {
							text.inputEl.addClass('file-pilot-path-input');
							pathInput = text;

							text
								.setPlaceholder(t('scanRootPlaceholder'))
								.setValue(this.filePilot.stateService.getRootPath());
							text.inputEl.addEventListener('keydown', (event) => {
								if (event.key !== 'Enter' || event.isComposing) {
									return;
								}

								event.preventDefault();
								void this.handleRootPathChange(text.getValue()).then(() => {
									text.setValue(
										this.filePilot.stateService.getRootPath(),
									);
								});

							});
						})
						.addButton((button) => {
							button
								.setButtonText(t('scanRootBrowse'))
								.onClick(async () => {
									let selectedPath: string | undefined;
									try {
										selectedPath = await pickFolder(
											this.filePilot.stateService.getRootPath()
										);
									} catch {
										new Notice(t('scanRootBrowseFailed'));
										return;
									}

									if (selectedPath === undefined) {
										return;
									}

									await this.handleRootPathChange(selectedPath);
									pathInput.setValue(
										this.filePilot.stateService.getRootPath(),
									);
								});
						});
				},
			},
		];
	}

	private async handleRootPathChange(value: string): Promise<void> {
		try {
			await this.filePilot.stateService.setRootPath(value);
			new Notice(t('scanRootSaved'));
		} catch (error) {
			if (error instanceof FilePilotError) {
				switch (error.code) {
					case 'SCAN_ROOT_LOCKED':
						new Notice(t('scanRootLocked'));
						return;

					case 'SCAN_ROOT_INVALID':
						new Notice(t('scanRootInvalid'));
						return;

					case 'SCAN_ROOT_NOT_FOUND':
						new Notice(t('scanRootNotFound'));
						return;
				}
			}

			console.error('Failed to save scan root:', error);
			new Notice(t('scanRootSaveFailed'));
		}
	}
}
