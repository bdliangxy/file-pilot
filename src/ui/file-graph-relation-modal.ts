import {
	Modal,
	FuzzySuggestModal,
	Setting,
	setTooltip,
	setIcon,
	type App,
	type TFile,
	type EventRef,
} from 'obsidian';

import type {
	FileGraphService,
	GraphConnection,
} from '../core/file-graph-service';
import type { PluginStateService } from '../data/plugin-state-service';
import {
	showFileGraphFeedback,
	enableModalDragging,
} from '../utils/file-graph-utils';
import { t } from '../i18n';
import type { ShadowNoteService } from '../core/shadow-note-service';


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
	private dragController: AbortController | null = null;
	constructor(
		app: App,
		private readonly note: TFile,
		private readonly fileGraphService: FileGraphService,
		private readonly shadowNoteService: ShadowNoteService,
		private readonly stateService: PluginStateService,
		private readonly onClosed: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalOpen = true;
		this.setTitle(t('graphEditRelations'));
		this.modalEl.addClass('file-pilot-graph-relation-modal');

		this.dragController = enableModalDragging(
			this.modalEl,
			this.titleEl,
		);
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
		this.dragController?.abort();
		this.dragController = null;

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

		// Preserve the scroll position before rebuilding the connections.
		const scrollTop = contentEl.querySelector<HTMLElement>(
			'.file-pilot-graph-connections',
		)?.scrollTop ?? 0;

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
			.setClass('file-pilot-graph-current-node')
			.setName(t('graphCurrentNode'))
			.setDesc(getGraphDisplayText(this.note, true));

		const connections =
			this.fileGraphService.getNodeConnections(this.note);

		// Collect Shadow Note paths representing managed folders.
		const folderPaths = new Set(
			this.stateService.getFileRecords()
				.filter(record => record.kind === 'folder')
				.map(record => record.shadowNotePath),
		);

		// Create a dedicated scrollable area for graph connections.
		const connectionsEl = contentEl.createDiv({
			cls: 'file-pilot-graph-connections',
		});

		this.renderConnectionSection(
			connectionsEl,
			'incoming',
			connections.incoming,
			folderPaths,
		);

		this.renderConnectionSection(
			connectionsEl,
			'outgoing',
			connections.outgoing,
			folderPaths,
		);

		// Restore the scroll position after rendering both sections.
		connectionsEl.scrollTop = scrollTop;
	}

	/**
	 * Render connections in the specified direction.
	 */
	private renderConnectionSection(
		container: HTMLElement,
		direction: ConnectionDirection,
		connections: GraphConnection[],
		folderPaths: ReadonlySet<string>,
	): void {
		const section = container.createDiv({
			cls: [
				'file-pilot-graph-section',
				`file-pilot-graph-section-${direction}`,
			],
		});

		const title = direction === 'incoming'
			? t('graphIncomingLinks')
			: t('graphOutgoingLinks');

		const heading = new Setting(section)
			.setClass('file-pilot-graph-section-heading')
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

		// Add a directional icon to the section heading.
		const iconEl = heading.nameEl.createSpan({
			cls: 'file-pilot-graph-section-icon',
		});

		setIcon(
			iconEl,
			direction === 'incoming'
				? 'arrow-down-left'
				: 'arrow-up-right',
		);

		heading.nameEl.prepend(iconEl);

		if (connections.length === 0) {
			section.createDiv({
				cls: 'file-pilot-graph-empty-state',
				text: t('graphNoConnections'),
			});
			return;
		}

		for (const connection of connections) {
			this.renderConnection(
				section,
				direction,
				connection,
				folderPaths,
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
		folderPaths: ReadonlySet<string>,
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

		if (folderPaths.has(note.path)) {
			setting.nameEl.addClass('file-pilot-folder-name');
		}

		setting.descEl.addClass('file-pilot-file-path');
		void this.updateConnectionSummary(setting, note);

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
	 * Display the File Summary when available.
	 * Keep the path as the fallback.
	 */
	private async updateConnectionSummary(
		setting: Setting,
		note: TFile,
	): Promise<void> {
		if (
			!note.path.startsWith('ShadowNotes/') ||
			note.extension !== 'md'
		) {
			return;
		}

		try {
			const summary =
				await this.shadowNoteService
					.getFileSummaryFromNote(note);

			if (
				!this.modalOpen ||
				!setting.settingEl.isConnected
			) {
				return;
			}

			if (summary) {
				setting.descEl.removeClass('file-pilot-file-path');
				setting.descEl.addClass('file-pilot-file-summary');
				setting.setDesc(summary);
			}
		} catch (error) {
			console.error(
				'File Pilot failed to read connection summary:',
				note.path,
				error,
			);
		}
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
	private dragController: AbortController | null = null;
	constructor(
		app: App,
		private readonly getCandidates: () => TFile[],
		private readonly onSelected: (note: TFile) => void,
		private readonly onClosed: () => void,
	) {
		super(app);
		this.setPlaceholder(t('graphSelectNote'));
	}

	onOpen(): void {
		void super.onOpen();

		const handleEl = this.modalEl.createDiv({
			cls: 'file-pilot-graph-suggest-drag-handle',
		});

		this.modalEl.prepend(handleEl);

		this.dragController = enableModalDragging(
			this.modalEl,
			handleEl,
		);

		this.dragController.signal.addEventListener(
			'abort',
			() => handleEl.remove(),
			{ once: true },
		);
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
		this.dragController?.abort();
		this.dragController = null;

		super.onClose();
		this.onClosed();
	}
}
