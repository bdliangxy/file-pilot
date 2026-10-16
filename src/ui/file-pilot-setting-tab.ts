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
import type {
	SettingsChanges,
	SettingsUpdateResult,
} from '../data/plugin-state-service';

type SettingsSaveFeedback =
	| {
		type: 'result';
		result: SettingsUpdateResult;
	}
	| {
		type: 'failure';
		error: unknown;
	};


export class FilePilotSettingTab extends PluginSettingTab {
	private rootPathInput?: TextComponent;

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

					setting
						.addText((text) => {
							text.inputEl.addClass('file-pilot-path-input');
							this.rootPathInput = text;

							text
								.setPlaceholder(t('scanRootPlaceholder'))
								.setValue(this.filePilot.stateService.getRootPath());
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
									this.rootPathInput?.setValue(selectedPath);
								});
						});
				},
			},

			{
				// name: t('settingsSave'),
				render: (setting: Setting) => {
					setting.addButton((button) => {
						button
							.setButtonText(t('settingsSave'))
							.setCta()
							.onClick(async () => {
								const result = await this.saveSettings({
									rootPath: this.rootPathInput?.getValue(),
								});

								if (result && !result.errors.rootPath) {
									this.rootPathInput?.setValue(
										this.filePilot.stateService.getRootPath(),
									);
								}
							});
					});
				},
			},

		];
	}

	private async saveSettings(changes: SettingsChanges,): Promise<SettingsUpdateResult | null> {
		try {
			const result =
				await this.filePilot.stateService.updateSettings(changes);
			// Refresh the displayed scan root in opened FilePilot views.
			// if refreshing rootpath happens in many places, use subscription.
			if (result.updated.includes('rootPath')) {
				this.filePilot.refreshViewRootPath();
			}
			this.showSettingsFeedback({
				type: 'result',
				result,
			});

			return result;
		} catch (error) {
			this.showSettingsFeedback({
				type: 'failure',
				error,
			});

			return null;
		}
	}


	private showSettingsFeedback(
		feedback: SettingsSaveFeedback,
	): void {
		// Persistence or unexpected failure.
		if (feedback.type === 'failure') {
			console.error('Failed to save settings:', feedback.error);
			new Notice(t('settingsSaveFailed'));
			return;
		}

		const { updated, errors } = feedback.result;
		const errorMessages: string[] = [];

		// Collect validation error messages.
		for (const [field, error] of Object.entries(errors)) {
			if (!error) {
				continue;
			}

			switch (field) {
				case 'rootPath': {
					if (error instanceof FilePilotError) {
						switch (error.code) {
							case 'SCAN_ROOT_LOCKED':
								errorMessages.push(t('scanRootLocked'));
								break;

							case 'SCAN_ROOT_INVALID':
								errorMessages.push(t('scanRootInvalid'));
								break;

							case 'SCAN_ROOT_NOT_FOUND':
								errorMessages.push(t('scanRootNotFound'));
								break;

							default:
								errorMessages.push(t('scanRootSaveFailed'));
						}
					} else {
						errorMessages.push(t('scanRootSaveFailed'));
					}
					break;
				}

				case 'ignorePatterns':
					errorMessages.push(t('ignorePatternsInvalid'));
					break;

				default:
					errorMessages.push(t('settingsInvalid'));
					break;
			}
		}

		const hasErrors = Object.values(errors).some(Boolean);

		// Nothing changed and no error occurred.
		if (updated.length === 0 && !hasErrors) {
			return;
		}

		let summary: string;

		if (hasErrors) {
			summary = updated.length > 0
				? t('settingsPartiallySaved')
				: t('settingsSaveFailed');
		} else {
			summary = t('settingsSaved');
		}

		new Notice(
			[summary, ...errorMessages].join('\n'),
		);
	}

}
