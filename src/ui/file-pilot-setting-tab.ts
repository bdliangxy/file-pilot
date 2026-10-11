import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	type TextComponent,
} from 'obsidian';

import type FilePilotPlugin from '../main';
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
					const fileScope = this.filePilot.pluginSettings.fileScope;

					let pathInput: TextComponent;

					setting
						.addText((text) => {
							pathInput = text;

							text
								.setPlaceholder(t('scanRootPlaceholder'))
								.setValue(fileScope.rootPath);
							text.inputEl.addEventListener('keydown', (event) => {
								if (event.key !== 'Enter' || event.isComposing) {
									return;
								}

								event.preventDefault();
								void this.saveRootPath(text.getValue()).then(() => {
									text.setValue(
										fileScope.rootPath
									);
								});

							});
						})
						.addButton((button) => {
							button
								.setButtonText(t('scanRootBrowse'))
								.onClick(async () => {
									try {
										const selectedPath =
											await pickFolder(fileScope.rootPath);

										if (selectedPath === undefined) {
											return;
										}
										await this.saveRootPath(selectedPath);
										pathInput.setValue(fileScope.rootPath);

									} catch {
										new Notice(t('scanRootBrowseFailed'));
									}
								});
						});
				},
			},
		];
	}

	private async saveRootPath(value: string): Promise<void> {
		const newPath = value.trim();
		const oldPath =
			this.filePilot.pluginSettings.fileScope.rootPath;

		if (newPath !== '' && !isAbsolute(newPath)) {
			new Notice(t('scanRootInvalid'));
			return;
		}

		if (newPath !== '') {
			try {
				const info = await stat(newPath);

				if (!info.isDirectory()) {
					new Notice(t('scanRootNotFound'));
					return;
				}
			} catch {
				new Notice(t('scanRootNotFound'));
				return;
			}
		}

		if (
			newPath !== oldPath &&
			this.filePilot.pluginData.fileRecords.length > 0
		) {
			new Notice(t('scanRootLocked'));
			return;
		}

		this.filePilot.pluginSettings.fileScope.rootPath = newPath;

		try {
			await this.filePilot.saveAllData();
			new Notice(t('scanRootSaved'));
		} catch {
			this.filePilot.pluginSettings.fileScope.rootPath = oldPath;
			new Notice(t('scanRootSaveFailed'));
		}
	}
}
