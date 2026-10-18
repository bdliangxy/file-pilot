import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	DropdownComponent,
	type TextComponent,
	type TextAreaComponent,
	ButtonComponent
} from 'obsidian';

import type FilePilotPlugin from '../main';
import { FilePilotError } from '../error';
import { t } from '../i18n';
import { pickPaths } from './native-file-dialog';
import type {
	SettingsChanges,
	SettingsUpdateResult,
} from '../data/plugin-state-service';
import { DEFAULT_IGNORE_PATTERNS } from '../data/setting-data';
import {
	importIgnoreRules,
	exportIgnoreRules,
} from './ignore-rules-file-dialog';

type SettingsSaveFeedback =
	| {
		type: 'result';
		result: SettingsUpdateResult;
	}
	| {
		type: 'failure';
		error: unknown;
	};


type IgnoreRuleCategory =
	| 'directories'
	| 'filenames'
	| 'extensions';

function classifyIgnorePattern(
	pattern: string,
): IgnoreRuleCategory | null {
	// Skip empty lines, comments, and negation rules.
	if (
		pattern.trim() === '' ||
		pattern.startsWith('#') ||
		pattern.startsWith('!')
	) {
		return null;
	}

	// Complex patterns require the full-text editor.
	const hasSpecialSyntax = ['*', '?', '[', ']', '\\']
		.some((char) => pattern.includes(char));

	// A trailing slash indicates a directory rule.
	if (pattern.endsWith('/') && !hasSpecialSyntax) {
		return 'directories';
	}

	// Recognize simple extension patterns.
	if (/^\*\.[a-zA-Z0-9_-]+$/.test(pattern)) {
		return 'extensions';
	}

	// Recognize simple name-based patterns.
	if (!hasSpecialSyntax && !pattern.endsWith('/')) {
		return 'filenames';
	}

	return null;
}


export class FilePilotSettingTab extends PluginSettingTab {
	private rootPathInput?: TextComponent;
	private ignorePatternsInput?: TextAreaComponent;
	private ignorePatternsDraft: string[] = [];
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
								});
						});
				},
			},


			{
				name: t('ignorePatternsName'),
				desc: t('ignorePatternsDesc'),

				render: (setting: Setting) => {
					setting.settingEl.addClass('file-pilot-ignore-setting');
					// Group the mode selector and add button in one row.
					const modeRow = setting.controlEl.createDiv({
						cls: 'file-pilot-ignore-mode-row',
					});
					const modeDropdown = new DropdownComponent(modeRow)
						.addOption('all', t('ignoreViewAll'))
						.addOption('directories', t('ignoreViewDirectories'))
						.addOption('filenames', t('ignoreViewFilenames'))
						.addOption('extensions', t('ignoreViewExtensions'))
						.setValue('all');

					const addButton = new ButtonComponent(modeRow)
						.setIcon('plus')
						.setDisabled(true);

					addButton.buttonEl.addClass(
						'file-pilot-ignore-add-button',
						'file-pilot-ignore-hidden',
					);

					modeDropdown.selectEl.addClass(
						'file-pilot-ignore-mode-select',
					);
					this.ignorePatternsDraft =
						this.filePilot.stateService.getIgnorePatterns();
					setting.addTextArea((textArea) => {
						this.ignorePatternsInput = textArea;

						textArea
							.setValue(this.ignorePatternsDraft.join('\n'))
							.onChange((value) => this.setIgnoreDraft(value))
							;

						textArea.inputEl.rows = 8;
						textArea.inputEl.addClass(
							'file-pilot-ignore-textarea',
						);
					})

					const actions = setting.controlEl.createDiv({
						cls: 'file-pilot-ignore-actions',
					});

					// restore default ignore
					new ButtonComponent(actions)
						.setButtonText(t('restorDefault'))
						.onClick(() => {
							this.setIgnoreDraft(
								DEFAULT_IGNORE_PATTERNS.join('\n'),
							);
							this.syncIgnoreInput();
						});

					// clear
					new ButtonComponent(actions)
						.setButtonText(t('clear'))
						.onClick(() => {
							this.setIgnoreDraft('');
							this.syncIgnoreInput();
						});

					// import
					new ButtonComponent(actions)
						.setButtonText(t('import'))
						.onClick(async () => {
							try {
								const content = await importIgnoreRules();

								if (content === undefined) {
									return;
								}

								this.setIgnoreDraft(content);
								this.syncIgnoreInput();
								new Notice(t('ignoreImportedDraft'));
							} catch (error) {
								console.error('Failed to import ignore rules:', error);
								new Notice(t('ignoreImportFailed'));
							}
						});

					// export
					new ButtonComponent(actions)
						.setButtonText(t('export'))
						.onClick(async () => {
							try {
								const content = this.ignorePatternsDraft.join('\n');

								const exported = await exportIgnoreRules(content);

								if (exported) {
									new Notice(t('ignoreExported'));
								}
							} catch (error) {
								console.error('Failed to export ignore rules:', error);
								new Notice(t('ignoreExportFailed'));
							}
						});


					const categoryList = setting.controlEl.createDiv({
						cls: 'file-pilot-ignore-category-list file-pilot-ignore-hidden',
					});

					modeDropdown.onChange((mode) => {
						switch (mode) {
							case 'directories':
								setting.setDesc(t('ignoreDirectoriesDesc'));
								break;

							case 'filenames':
								setting.setDesc(t('ignoreFilenamesDesc'));
								break;

							case 'extensions':
								setting.setDesc(t('ignoreExtensionsDesc'));
								break;

							case 'all':
							default:
								setting.setDesc(t('ignorePatternsDesc'));
								break;
						}

						const showAll = mode === 'all';
						const showAddButton =
							mode === 'directories' || mode === 'filenames';

						addButton.buttonEl.classList.toggle(
							'file-pilot-ignore-hidden',
							!showAddButton,
						);
						this.ignorePatternsInput?.inputEl.classList.toggle(
							'file-pilot-ignore-hidden',
							!showAll,
						);

						actions.classList.toggle(
							'file-pilot-ignore-hidden',
							!showAll,
						);

						categoryList.classList.toggle(
							'file-pilot-ignore-hidden',
							showAll,
						);

						if (
							mode === 'directories' ||
							mode === 'filenames' ||
							mode === 'extensions'
						) {
							this.renderIgnoreRuleItems(categoryList, mode);
						}
					});


				},
			},


			{
				name: '',
				render: (setting: Setting) => {
					setting.addButton((button) => {
						button
							.setButtonText(t('settingsSave'))
							.setCta()
							.onClick(async () => {
								const result = await this.saveSettings({
									rootPath: this.rootPathInput?.getValue(),
									ignorePatterns: [...this.ignorePatternsDraft],
								});

								if (result && !result.errors.rootPath) {
									this.rootPathInput?.setValue(
										this.filePilot.stateService.getRootPath(),
									);
								}

								if (result && !result.errors.ignorePatterns) {
									this.setIgnoreDraft(
										this.filePilot.stateService
											.getIgnorePatterns()
											.join('\n'),
									);
									this.syncIgnoreInput();
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


	private setIgnoreDraft(text: string): void {
		this.ignorePatternsDraft =
			text === '' ? [] : text.split(/\r?\n/);
	}

	private syncIgnoreInput(): void {
		this.ignorePatternsInput?.setValue(
			this.ignorePatternsDraft.join('\n'),
		);
	}


	private renderIgnoreRuleItems(
		container: HTMLElement,
		category: IgnoreRuleCategory,
	): void {
		container.empty();

		const matchedRules = this.ignorePatternsDraft
			.map((pattern, index) => ({ pattern, index }))
			.filter(
				({ pattern }) =>
					classifyIgnorePattern(pattern) === category,
			);

		if (matchedRules.length === 0) {
			container.setText(t('ignoreCategoryPlaceholder'));
			return;
		}

		for (const { pattern, index } of matchedRules) {
			const pill = container.createDiv({
				cls: 'file-pilot-ignore-pill',
			});

			pill.dataset.ruleIndex = String(index);
			pill.createSpan({
				cls: 'file-pilot-ignore-pill-label',
				text: pattern,
			});

			const removeButton = new ButtonComponent(pill)
				.setIcon('x');

			removeButton.buttonEl.setAttribute(
				'aria-label',
				t('ignoreRemoveRule'),
			);

			removeButton.onClick(() => {
				// Remove only this occurrence from the complete draft.
				this.ignorePatternsDraft.splice(index, 1);
				this.syncIgnoreInput();
				this.renderIgnoreRuleItems(container, category);
			});
		}
	}
}
