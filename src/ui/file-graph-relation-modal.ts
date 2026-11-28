import {
	Modal,
	FuzzySuggestModal,
	Setting,
	setTooltip,
	type App,
	type TFile,
	type EventRef,
} from 'obsidian';

import type {
	FileGraphService,
	GraphConnection,
} from '../core/file-graph-service';

import { showFileGraphFeedback } from '../utils/file-graph-utils';
import { t } from '../i18n';

type ConnectionDirection = 'incoming' | 'outgoing';
const GRAPH_LINK_TOOLTIP_DELAY = 300;
/**
 * Hide the Markdown extension only for Shadow Notes.
 */
function getGraphDisplayText(
	file: TFile,
	usePath = false,
): string {
	const text = usePath ? file.path : file.name;

	return file.path.startsWith('ShadowNotes/')
		? text.replace(/\.md$/, '')
		: text;
}

export class FileGraphRelationModal extends Modal {
	private metadataEvent: EventRef | null = null;// Stores the MetadataCache event subscription reference
	private modalOpen = false;// Determines whether the current modal is still open
	private isUpdating = false;// Determines whether a connection modification operation is currently in progress
	private noteSuggestModal: GraphNoteSuggestModal | null = null;
	constructor(
		app: App,
		private readonly note: TFile,
		private readonly fileGraphService: FileGraphService,
		private readonly onClosed: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalOpen = true;
		this.setTitle(t('graphEditRelations'));

		// Refresh after Obsidian finishes resolving note links.
		this.metadataEvent = this.app.metadataCache.on(
			'resolved',
			() => {
				this.render();
			},
		);

		this.render();
	}

	onClose(): void {
		this.modalOpen = false;

		this.noteSuggestModal?.close();
		this.noteSuggestModal = null;

		if (this.metadataEvent) {
			this.app.metadataCache.offref(this.metadataEvent);
			this.metadataEvent = null;
		}

		this.contentEl.empty();
		this.onClosed();
	}

	/**
	 * Render the current graph connections.
	 */
	private render(): void {
		if (!this.modalOpen) {
			return;
		}

		const { contentEl } = this;
		contentEl.empty();

		// Ensure the current note still exists.
		if (
			this.app.vault.getFileByPath(this.note.path) !==
			this.note
		) {
			contentEl.createEl('p', {
				text: t('fileGraphNoteNotFound'),
			});
			return;
		}

		new Setting(contentEl)
			.setName(t('graphCurrentNode'))
			.setDesc(getGraphDisplayText(this.note, true));

		const connections =
			this.fileGraphService.getNodeConnections(this.note);

		this.renderConnectionSection(
			'incoming',
			connections.incoming,
		);

		this.renderConnectionSection(
			'outgoing',
			connections.outgoing,
		);
	}

	/**
	 * Render connections in the specified direction.
	 */
	private renderConnectionSection(
		direction: ConnectionDirection,
		connections: GraphConnection[],
	): void {
		const section = this.contentEl.createDiv();

		const title = direction === 'incoming'
			? t('graphIncomingLinks')
			: t('graphOutgoingLinks');

		new Setting(section)
			.setName(`${title} (${connections.length})`)
			.setHeading()
			.addButton(button => {
				button
					.setButtonText(t('graphAddConnection'))
					.setDisabled(this.isUpdating)
					.onClick(() => {
						this.openNoteSuggest(direction);
					});
			});

		if (connections.length === 0) {
			section.createEl('p', {
				cls: 'setting-item-description',
				text: t('graphNoConnections'),
			});
			return;
		}

		for (const connection of connections) {
			this.renderConnection(
				section,
				direction,
				connection,
			);
		}
	}

	/**
	 * Render an individual graph connection.
	 */
	private renderConnection(
		container: HTMLElement,
		direction: ConnectionDirection,
		connection: GraphConnection,
	): void {
		const { note, filePilotLink } = connection;

		const setting = new Setting(container)
			.setClass('file-pilot-graph-connection')
			.setName(getGraphDisplayText(note))
			.setDesc(getGraphDisplayText(note, true));

		// Apply the editable connection style.
		if (filePilotLink) {
			setting.settingEl.addClass(
				'file-pilot-graph-connection-editable',
			);
		}

		// Reuse file list typography.
		setting.nameEl.addClass('file-pilot-file-name');
		setting.descEl.addClass('file-pilot-file-path');

		// Read-only connections cannot be removed here.
		if (!filePilotLink) {
			setTooltip(
				setting.settingEl,
				t('graphOrdinaryLinkTooltip'),
				{
					placement: 'top',
					delay: GRAPH_LINK_TOOLTIP_DELAY,
				},
			);
			return;
		}

		setting.addExtraButton(button => {
			button
				.setIcon('trash-2')
				.setTooltip(t('graphRemoveConnection'))
				.setDisabled(this.isUpdating)
				.onClick(() => {
					void this.updateConnection(
						direction,
						note,
						false,
					);
				});
		});
	}

	/**
	 * Open a Markdown note selector for the specified direction.
	 */
	private openNoteSuggest(
		direction: ConnectionDirection,
	): void {
		if (
			!this.modalOpen ||
			this.isUpdating ||
			this.noteSuggestModal
		) {
			return;
		}

		this.noteSuggestModal = new GraphNoteSuggestModal(
			this.app,
			() => {
				const connections =
					this.fileGraphService.getNodeConnections(
						this.note,
					);

				const existingPaths = new Set(
					connections[direction]
						.filter(connection => connection.filePilotLink)
						.map(connection => connection.note.path),
				);

				return this.app.vault
					.getMarkdownFiles()
					.filter(file =>
						file.path !== this.note.path &&
						!existingPaths.has(file.path),
					);
			},
			note => {
				void this.updateConnection(
					direction,
					note,
					true,
				);
			},
			() => {
				this.noteSuggestModal = null;
			},
		);

		this.noteSuggestModal.open();
	}

	/**
	 * Add or remove a managed graph connection.
	 */
	private async updateConnection(
		direction: ConnectionDirection,
		connectedNote: TFile,
		connected: boolean,
	): Promise<void> {
		if (!this.modalOpen || this.isUpdating) {
			return;
		}

		this.isUpdating = true;

		try {
			this.render();

			const source = direction === 'incoming'
				? connectedNote
				: this.note;

			const target = direction === 'incoming'
				? this.note
				: connectedNote;

			const changed =
				await this.fileGraphService.setNodeConnection(
					source,
					target,
					connected,
				);

			showFileGraphFeedback({
				status: 'success',
				changed,
			});
		} catch (error) {
			showFileGraphFeedback({
				status: 'failure',
				error,
			});
		} finally {
			this.isUpdating = false;
			this.render();
		}
	}
}

/**
 * Select a Markdown note using Obsidian's native fuzzy search.
 */
class GraphNoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly getCandidates: () => TFile[],
		private readonly onSelected: (note: TFile) => void,
		private readonly onClosed: () => void,
	) {
		super(app);
		this.setPlaceholder(t('graphSelectNote'));
	}

	getItems(): TFile[] {
		return this.getCandidates();
	}

	getItemText(item: TFile): string {
		return getGraphDisplayText(item, true);
	}

	onChooseItem(item: TFile): void {
		this.onSelected(item);
	}

	onClose(): void {
		super.onClose();
		this.onClosed();
	}
}
