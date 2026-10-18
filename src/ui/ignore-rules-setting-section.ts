import { Notice, Setting, DropdownComponent, ButtonComponent, type TextAreaComponent } from 'obsidian';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type { PluginStateService } from '../data/plugin-state-service';
import { DEFAULT_IGNORE_PATTERNS } from '../data/setting-data';
import { t } from '../i18n';
import { logger } from '../utils/logger';
import {
	MAX_EXTENSION_LENGTH,
	inputIsValidExtension,
	classifyIgnorePattern,
	createSelectedIgnorePattern,
	type IgnoreRuleCategory,
} from '../utils/ignore-rule-utils';
import { pickPaths } from './native-file-dialog';
import { importIgnoreRules, exportIgnoreRules } from './ignore-rules-file-dialog';

function isPathInsideRoot(
	rootPath: string,
	selectedPath: string,
): boolean {
	const relativePath = relative(rootPath, selectedPath);

	return (
		relativePath !== '' &&
		relativePath !== '..' &&
		!relativePath.startsWith(`..${sep}`) &&
		!isAbsolute(relativePath)
	);
}


export class IgnoreRulesSettingSection {
	private ignorePatternsInput?: TextAreaComponent;
	private ignorePatternsDraft: string[] = [];

	constructor(private readonly stateService: PluginStateService) { }

	getDraft(): string[] {
		return [...this.ignorePatternsDraft];
	}

	syncSavedRules(): void {
		this.setIgnoreDraft(this.stateService.getIgnorePatterns().join('\n'));
		this.syncIgnoreInput();
	}

	render(setting: Setting): void {
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
			.onClick(async () => {
				const mode = modeDropdown.getValue();

				if (mode !== 'directories' && mode !== 'filenames') {
					return;
				}

				const selectedPaths = await this.pickValidatedIgnorePaths(mode);

				if (selectedPaths.length === 0) {
					return;
				}

				const rootPath = this.stateService.getRootPath();

				const newPatterns = selectedPaths.map((selectedPath) =>
					createSelectedIgnorePattern(rootPath, selectedPath, mode)
				);

				// Deduplicate against existing rules and within this selection.
				const existingPatterns = new Set(this.ignorePatternsDraft);

				const patternsToAdd = newPatterns.filter((pattern) => {
					if (existingPatterns.has(pattern)) {
						return false;
					}

					existingPatterns.add(pattern);
					return true;
				});

				// No new rules to add.
				if (patternsToAdd.length === 0) {
					return;
				}

				// Update the draft without persisting settings.
				this.ignorePatternsDraft.push(...patternsToAdd);

				// Synchronize the full-text editor.
				this.syncIgnoreInput();

				// Refresh pills only if the user is still viewing this category.
				if (modeDropdown.getValue() === mode) {
					this.renderIgnoreRuleItems(categoryList, mode);
				}

				logger.debug('Added ignore patterns:', patternsToAdd);
			});

		addButton.buttonEl.addClass(
			'file-pilot-ignore-add-button',
			'file-pilot-ignore-hidden',
		);

		modeDropdown.selectEl.addClass(
			'file-pilot-ignore-mode-select',
		);
		this.ignorePatternsDraft =
			this.stateService.getIgnorePatterns();
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

		if (
			matchedRules.length === 0 &&
			category !== 'extensions'
		) {
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
		// Always show an empty input pill in extension mode.
		if (category === 'extensions') {
			this.renderIgnoreExtensionInput(container);
		}
	}


	private async pickValidatedIgnorePaths(
		category: 'directories' | 'filenames',
	): Promise<string[]> {
		const rootPath = this.stateService.getRootPath();

		// Require a saved scan root.
		if (rootPath === '') {
			new Notice(t('ignoreRootRequired'));
			return [];
		}

		try {
			const realRootPath = await realpath(rootPath);

			const selectedPaths = await pickPaths({
				title: category === 'directories'
					? t('ignoreSelectFolders')
					: t('ignoreSelectFiles'),
				defaultPath: rootPath,
				properties: [
					category === 'directories'
						? 'openDirectory'
						: 'openFile',
					'multiSelections',
				],
			});

			// The user canceled the dialog.
			if (selectedPaths.length === 0) {
				return [];
			}

			// Validate every selected path before accepting the batch.
			for (const selectedPath of selectedPaths) {
				const realSelectedPath = await realpath(selectedPath);

				if (
					!isPathInsideRoot(rootPath, selectedPath) ||
					!isPathInsideRoot(realRootPath, realSelectedPath)
				) {
					new Notice(t('ignoreOutsideRoot'));
					return [];
				}
			}

			return selectedPaths;
		} catch (error) {
			console.error('Failed to select ignore paths:', error);
			new Notice(t('ignoreSelectionFailed'));
			return [];
		}
	}


	private renderIgnoreExtensionInput(
		container: HTMLElement,
	): void {
		const pill = container.createDiv({
			cls: 'file-pilot-ignore-pill file-pilot-ignore-extension-editor',
		});

		// The "*." prefix is not editable.
		pill.createSpan({
			cls: 'file-pilot-ignore-extension-prefix',
			text: '*.',
		});

		const input = pill.createEl('input', {
			cls: 'file-pilot-ignore-extension-input',
		});

		input.type = 'text';
		input.maxLength = MAX_EXTENSION_LENGTH;
		input.setAttribute(
			'aria-label',
			t('ignoreExtensionInput'),
		);

		input.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || event.isComposing) {
				return;
			}

			event.preventDefault();

			const extension = input.value;
			input.value = '';
			if (!inputIsValidExtension(extension)) {
				new Notice(t('ignoreExtensionInvalid'));
				return;
			}

			const pattern = `*.${extension}`;

			// Check duplicates without regard to letter case.
			const isDuplicate = this.ignorePatternsDraft.some(
				(existing) =>
					existing.toLowerCase() === pattern.toLowerCase(),
			);

			if (isDuplicate) {
				new Notice(t('ignoreExtensionDuplicate'));
				return;
			}

			// Append the new rule to the draft.
			this.ignorePatternsDraft.push(pattern);

			// Synchronize the full-text editor.
			this.syncIgnoreInput();

			// Rebuild the pills, including a fresh empty editor.
			this.renderIgnoreRuleItems(container, 'extensions');

			// Move focus to the newly created input.
			container
				.querySelector<HTMLInputElement>(
					'.file-pilot-ignore-extension-input',
				)
				?.focus();
		});
	}

}
