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
import { pickPaths } from './native-file-dialog';
import type {
	SettingsChanges,
	SettingsUpdateResult,
} from '../data/plugin-state-service';
import { IgnoreRulesSettingSection } from './ignore-rules-setting-section';

type SettingsSaveFeedback =
	| {
		type: 'result';
		result: SettingsUpdateResult;
	}
	| {
		type: 'failure';
		error: unknown;
	};

// Defines a setting item and its visibility behavior.
interface FilePilotSettingDefinition {
	name: string;
	desc?: string;
	alwaysVisible?: boolean;
	render: (setting: Setting) => void;
}

export class FilePilotSettingTab extends PluginSettingTab {
	private rootPathInput?: TextComponent;
	private readonly ignoreRulesSection: IgnoreRulesSettingSection;
	private hideShadowNotesDraft!: boolean;
	constructor(
		app: App,
		private readonly filePilot: FilePilotPlugin,
	) {
		super(app, filePilot);
		this.ignoreRulesSection = new IgnoreRulesSettingSection(this.filePilot.stateService);
	}

	getSettingDefinitions(): FilePilotSettingDefinition[] {
		const definitions: FilePilotSettingDefinition[] = [
			{
				name: t('scanRootName'),
				desc: t('scanRootDesc'),
				alwaysVisible: true,

				render: (setting: Setting) => {

					setting
						.addText((text) => {
							text.inputEl.addClass('file-pilot-path-input');
							this.rootPathInput = text;

							text
								.setPlaceholder(t('scanRootPlaceholder'))
								.setValue(this.filePilot.stateService.getRootPath())
								.inputEl.addEventListener('keydown', (event) => {
									if (event.key !== 'Enter' || event.isComposing) {
										return;
									}

									event.preventDefault();

									void this.saveSettings({
										rootPath: this.rootPathInput?.getValue(),
									});
								});

						})
						.addButton((button) => {
							button
								.setButtonText(t('scanRootBrowse'))
								.onClick(async () => {
									let selectedPath: string | undefined;
									try {
										const selectedPaths = await pickPaths(
											{
												title: t('scanRootSelect'),
												defaultPath:
													this.filePilot.stateService.getRootPath() || undefined,
												properties: ['openDirectory'],
											}
										);
										selectedPath = selectedPaths[0];
									} catch (error) {
										console.error('Failed to import rootPath:', error);
										new Notice(t('scanRootBrowseFailed'));
										return;
									}

									if (selectedPath === undefined) {
										return;
									}
									this.rootPathInput?.setValue(selectedPath);
									await this.saveSettings({
										rootPath: selectedPath,
									});
								});
						});
				},
			},


			{
				name: t('ignorePatternsName'),
				desc: t('ignorePatternsDesc'),
				render: (setting: Setting) => {
					this.ignoreRulesSection.render(setting);
				},
			},

			{
				name: t('hideShadowNotesName'),
				desc: t('hideShadowNotesDesc'),
				render: (setting: Setting) => {
					this.hideShadowNotesDraft =
						this.filePilot.stateService
							.getHideShadowNotesFlag();

					setting.addToggle((toggle) => {
						toggle
							.setValue(this.hideShadowNotesDraft)
							.onChange((hidden) => {
								this.hideShadowNotesDraft = hidden;
							});
					});
				},
			},

			{
				name: '',
				alwaysVisible: true,
				render: (setting: Setting) => {
					setting.settingEl.addClass('file-pilot-settings-actions');

					setting.addButton((button) => {
						button
							.setButtonText(t('clearAllData'))
							.setDestructive()
							.onClick(async () => {
								button.setDisabled(true);

								try {
									await this.filePilot.clearUserData();
									this.update();
									new Notice(t('clearAllDataSuccess'));
								} catch (error) {
									if (error instanceof FilePilotError) {
										if (error.code === 'SYNC_IN_PROGRESS') {
											new Notice(t('syncAlreadyInProgress'));
											return;
										}

										if (error.code === 'CLEAR_IN_PROGRESS') {
											new Notice(t('clearInProgress'));
											return;
										}
									}
									console.error('Failed to clear data:', error);
									new Notice(t('clearAllDataFailed'));
								} finally {
									button.setDisabled(false);
								}
							});
					});

					setting.addButton((button) => {
						button
							.setButtonText(t('settingsSave'))
							.setCta()
							.onClick(async () => {
								const result = await this.saveSettings({
									rootPath: this.rootPathInput?.getValue(),
									ignorePatterns: this.ignoreRulesSection.getDraft(),
									hideShadowNotesFlag: this.hideShadowNotesDraft,
								});

								if (result && !result.errors.ignorePatterns) {
									this.ignoreRulesSection.syncSavedRules();
								}
							});
					});
				},
			},

		];
		return definitions.map(
			({ alwaysVisible, render, ...definition }) => ({
				...definition,

				render: (setting: Setting) => {
					render(setting);

					if (!alwaysVisible) {
						this.markRootDependent(setting);
					}
				},
			}),
		);
	}

	private async saveSettings(changes: SettingsChanges,): Promise<SettingsUpdateResult | null> {
		try {
			const result =
				await this.filePilot.stateService.updateSettings(changes);
			// Refresh the displayed scan root in opened FilePilot views.
			// if refreshing rootpath happens in many places, use subscription.
			if (result.updated.includes('rootPath')) {
				this.filePilot.refreshViewRootPath();
				this.updateRootDependentVisibility();
			}
			if (result.updated.includes('ignorePatterns')) {
				this.filePilot.refreshViewFileList();
			}
			if (result.updated.includes('hideShadowNotesFlag')) {
				this.filePilot.applyShadowNotesVisibility();
			}
			this.showSettingsFeedback({
				type: 'result',
				result,
			});

			return result;
		} catch (error) {
			if (
				error instanceof FilePilotError &&
				error.code === 'CLEAR_IN_PROGRESS'
			) {
				new Notice(t('clearInProgress'));
				return null;
			}
			this.showSettingsFeedback({
				type: 'failure',
				error,
			});

			return null;
		} finally {
			// Restore the persisted root path after a save attempt.
			if (
				changes.rootPath !== undefined &&
				this.rootPathInput?.getValue() === changes.rootPath
			) {
				this.rootPathInput.setValue(
					this.filePilot.stateService.getRootPath(),
				);
			}
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
			new Notice(t('settingsUnchanged'));
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

	// Mark a setting as dependent on the configured root path.
	private markRootDependent(setting: Setting): void {
		setting.settingEl.addClass('file-pilot-requires-root');

		const hasRootPath =
			this.filePilot.stateService.getRootPath().trim() !== '';

		setting.settingEl.classList.toggle(
			'file-pilot-setting-hidden',
			!hasRootPath,
		);
	}

	// Update visibility after the root path changes.
	private updateRootDependentVisibility(): void {
		const hasRootPath =
			this.filePilot.stateService.getRootPath().trim() !== '';

		const elements = this.containerEl.querySelectorAll<HTMLElement>(
			'.file-pilot-requires-root',
		);

		elements.forEach((element) => {
			element.classList.toggle(
				'file-pilot-setting-hidden',
				!hasRootPath,
			);
		})
	}

}
