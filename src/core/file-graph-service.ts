
import {
	App,
	TFile,
	getFrontMatterInfo,
	parseYaml,
} from 'obsidian';

import { PluginStateService } from '../data/plugin-state-service';
import { FilePilotError } from '../error';
import type { FileRecord } from './file-interface';
import type { PortalTreeNode } from '../utils/portal-tree-utils';
import { collectPortalTreeRelations } from '../utils/file-graph-utils';

const GRAPH_LINKS_PROPERTY = 'file-pilot-links';

export interface LocationGraphSyncResult {
	updatedNoteCount: number;
	unchangedNoteCount: number;
}

interface NoteLinksUpdate {
	note: TFile;
	targets: FileRecord[];
}

export class FileGraphService {
	constructor(
		private readonly app: App,
		private readonly stateService: PluginStateService,
	) { }

	/**
	 * Synchronize physical file relationships to Obsidian Properties.
	 * The Portal Note represents the virtual root.
	 */
	async syncLocationGraph(
		tree: PortalTreeNode,
	): Promise<LocationGraphSyncResult> {
		if (this.stateService.isClearingData) {
			throw new FilePilotError('CLEAR_IN_PROGRESS');
		}

		const relations = collectPortalTreeRelations(tree);

		// Extract all FileRecords from the Portal Tree relationships.
		// Keep FileRecords from the same tree snapshot instead of reading StateService.
		const records = relations.map(
			relation => relation.childRecord,
		);
		const projectName = this.stateService.getProjectName();
		const portalPath = `${projectName || 'PORTAL NOTE'}.md`;

		const portalEntry = this.app.vault.getAbstractFileByPath(
			portalPath,
		);

		if (portalEntry === null) {
			throw new FilePilotError(
				'PORTAL_NOTE_NOT_FOUND',
				`Portal Note not found: ${portalPath}`,
			);
		}

		if (!(portalEntry instanceof TFile)) {
			throw new FilePilotError(
				'PORTAL_NOTE_PATH_OCCUPIED',
				`Portal Note path is occupied: ${portalPath}`,
			);
		}

		// Resolve every managed note before modifying any Properties.
		const notesById = new Map<string, TFile>();

		for (const record of records) {
			const note = this.app.vault.getFileByPath(
				record.shadowNotePath,
			);

			if (note === null) {
				throw new FilePilotError(
					'SHADOW_NOTE_NOT_FOUND',
					`Shadow Note not found: ${record.shadowNotePath}`,
				);
			}

			notesById.set(record.id, note);
		}
		// Store the top-level files and folders that a Portal Note should link to.
		const portalTargets: FileRecord[] = [];
		// Store the direct child nodes that each FileRecord should link to.
		const targetsByParentId = new Map<string, FileRecord[]>();

		// Initialize every FileRecord, including leaf nodes.
		for (const record of records) {
			targetsByParentId.set(record.id, []);
		}

		for (const relation of relations) {
			if (relation.parentRecordId === null) {
				portalTargets.push(relation.childRecord);
				continue;
			}

			const targets = targetsByParentId.get(
				relation.parentRecordId,
			);

			if (targets === undefined) {
				throw new FilePilotError(
					'FILE_GRAPH_RECORD_MISSING',
					`Graph parent not found: ${relation.parentRecordId}`,
				);
			}

			targets.push(relation.childRecord);
		}

		const updates: NoteLinksUpdate[] = [
			{
				note: portalEntry,
				targets: portalTargets,
			},
		];

		for (const record of records) {
			const note = notesById.get(record.id);
			const targets = targetsByParentId.get(record.id);

			if (note === undefined || targets === undefined) {
				throw new FilePilotError(
					'FILE_GRAPH_RECORD_MISSING',
					`Graph record not found: ${record.id}`,
				);
			}

			updates.push({ note, targets });
		}

		let updatedNoteCount = 0;
		let unchangedNoteCount = 0;

		for (const update of updates) {
			if (this.stateService.isClearingData) {
				throw new FilePilotError('CLEAR_IN_PROGRESS');
			}

			const links = update.targets.map((record) => {
				const target = notesById.get(record.id);

				if (target === undefined) {
					throw new FilePilotError(
						'SHADOW_NOTE_NOT_FOUND',
						`Shadow Note not found: ${record.shadowNotePath}`,
					);
				}

				const linktext =
					this.app.metadataCache.fileToLinktext(
						target,
						update.note.path,
						true,
					);

				return `[[${linktext}]]`;
			});

			const changed = await this.updateNoteLinks(
				update.note,
				links,
			);

			if (changed) {
				updatedNoteCount++;
			} else {
				unchangedNoteCount++;
			}
		}

		return {
			updatedNoteCount,
			unchangedNoteCount,
		};
	}

	/**
	 * Update only the plugin-managed links property.
	 * Skip writing when the current links are already identical.
	 */
	private async updateNoteLinks(
		note: TFile,
		links: readonly string[],
	): Promise<boolean> {
		const content = await this.app.vault.read(note);
		const info = getFrontMatterInfo(content);

		let parsed: unknown = {};

		if (info.exists) {
			try {
				parsed = parseYaml(info.frontmatter) ?? {};
			} catch {
				throw new FilePilotError(
					'FILE_GRAPH_FRONTMATTER_INVALID',
					`Invalid Frontmatter: ${note.path}`,
				);
			}
		}

		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new FilePilotError(
				'FILE_GRAPH_FRONTMATTER_INVALID',
				`Invalid Frontmatter properties: ${note.path}`,
			);
		}

		const properties = parsed as Record<string, unknown>;
		const current = properties[GRAPH_LINKS_PROPERTY];

		if (
			Array.isArray(current) &&
			current.length === links.length &&
			current.every(
				(value, index) => value === links[index],
			)
		) {
			return false;
		}

		await this.app.fileManager.processFrontMatter(
			note,
			(frontmatter: Record<string, unknown>) => {
				frontmatter[GRAPH_LINKS_PROPERTY] = [...links];
			},
		);

		return true;
	}
}
