import {
	TFile,
	type EventRef,
	type Menu,
	type MenuItem,
	type Workspace,
	type App,
} from 'obsidian';

import type { PluginStateService } from '../data/plugin-state-service';
import type { FileActionService } from '../core/file-action-service';
import { notifyFileActionError } from './file-action-error-notifier';
import { t } from '../i18n';
import type { FileGraphService } from '../core/file-graph-service';
import { FileGraphRelationModal } from './file-graph-relation-modal';
const HIDE_CLASS = 'file-pilot-hide-shadow-notes';

export function setShadowNotesHidden(hidden: boolean): void {
	document.body.classList.toggle(HIDE_CLASS, hidden);
}

export function registerFileGraphMenu(
	workspace: Workspace,
	stateService: PluginStateService,
	fileActionService: FileActionService,
): EventRef {
	return workspace.on('file-menu', (menu, file) => {
		if (!(file instanceof TFile)) {
			return;
		}

		const record = stateService.getFileRecords()
			.find(record => record.shadowNotePath === file.path);

		if (!record) {
			return;
		}

		menu.addItem(item => {
			item.setTitle(t('pluginTitle')).setIcon('folder-cog');

			const submenu = (
				item as MenuItem & { setSubmenu(): Menu }
			).setSubmenu();

			const actions = [
				{
					action: 'openSource',
					title: t('graphOpenSource'),
					icon: 'file',
				},
				{
					action: 'openContainingFolder',
					title: t('graphOpenContainingFolder'),
					icon: 'folder-open',
				},
			] as const;

			for (const { action, title, icon } of actions) {
				submenu.addItem(subitem => {
					subitem
						.setTitle(title)
						.setIcon(icon)
						.onClick(() => {
							void fileActionService
								.execute(action, record)
								.catch(error => {
									notifyFileActionError(
										error,
										action,
										record,
									);
								});
						});
				});
			}
		});
	});
}

/**
 * Register graph relation editing for all Markdown notes.
 * Return a cleanup callback for the menu event and active modals.
 */
export function registerGraphRelationMenu(
	app: App,
	fileGraphService: FileGraphService,
): () => void {
	const activeModals = new Set<FileGraphRelationModal>();

	const eventRef = app.workspace.on('file-menu', (menu, file) => {
		if (
			!(file instanceof TFile) ||
			file.extension !== 'md'
		) {
			return;
		}

		menu.addItem(item => {
			item
				.setTitle(t('graphEditRelations'))
				.setIcon('git-branch')
				.onClick(() => {
					const modal = new FileGraphRelationModal(
						app,
						file,
						fileGraphService,
						() => {
							activeModals.delete(modal);
						},
					);

					activeModals.add(modal);
					modal.open();
				});
		});
	});

	return () => {
		app.workspace.offref(eventRef);

		for (const modal of activeModals) {
			modal.close();
		}

		activeModals.clear();
	};
}
