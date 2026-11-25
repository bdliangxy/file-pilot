
import {
	App,
	TFile,
	getFrontMatterInfo,
	parseYaml,
	parseLinktext,
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

/**
 * Represents a connection between the current node and another note.
 */
export interface GraphConnection {
	/** The note at the other end of the connection. */
	note: TFile;
	/** Whether the connection exists in the file-pilot-links property. */
	filePilotLink: boolean;
	/** Whether the connection also exists in the note body or other properties. */
	otherLink: boolean;
}

/**
 * Groups all connections of a node by link direction.
 */
export interface GraphNodeConnections {
	/** Notes that link to the current node. */
	incoming: GraphConnection[];
	/** Notes that the current node links to. */
	outgoing: GraphConnection[];
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
	 * Get the native graph connections and identify their sources.
	 */
	getNodeConnections(note: TFile): GraphNodeConnections {
		const resolved = this.app.metadataCache.resolvedLinks;

		const incoming: GraphConnection[] = [];
		const outgoing: GraphConnection[] = [];

		// Get all target paths linked from this note, or an empty list if none exist.
		for (const targetPath of Object.keys(
			resolved[note.path] ?? {},
		)) {
			if (targetPath === note.path) {
				continue;
			}

			const target = this.app.vault.getFileByPath(targetPath);

			if (target) {
				outgoing.push(this.createGraphConnection(note, target, target));
			}
		}

		for (const [sourcePath, targets] of Object.entries(resolved)) {
			if (
				sourcePath === note.path ||
				(targets[note.path] ?? 0) === 0
			) {
				continue;
			}

			const source = this.app.vault.getFileByPath(sourcePath);

			if (source) {
				incoming.push(this.createGraphConnection(source, note, source));
			}
		}

		return { incoming, outgoing };
	}

	/**
	 * Classify a resolved connection by its source.
	 */
	private createGraphConnection(
		source: TFile,
		target: TFile,
		connectedNote: TFile,
	): GraphConnection {
		const cache = this.app.metadataCache.getFileCache(source);

		const resolvesToTarget = (link: string): boolean => {
			const { path } = parseLinktext(link);

			return this.app.metadataCache.getFirstLinkpathDest(
				path,
				source.path,
			)?.path === target.path;
		};

		const isManagedProperty = (key: string): boolean =>
			key === GRAPH_LINKS_PROPERTY ||
			(
				key.startsWith(`${GRAPH_LINKS_PROPERTY}.`) &&
				/^\d+$/.test(
					key.slice(GRAPH_LINKS_PROPERTY.length + 1),
				)
			);

		const managedLinks = (cache?.frontmatterLinks ?? []).filter(
			link =>
				isManagedProperty(link.key) &&
				resolvesToTarget(link.link),
		);

		const otherFrontmatterLink = (
			cache?.frontmatterLinks ?? []
		).some(
			link =>
				!isManagedProperty(link.key) &&
				resolvesToTarget(link.link),
		);

		const otherBodyLink = [
			...(cache?.links ?? []),
			...(cache?.embeds ?? []),
		].some(link => resolvesToTarget(link.link));

		const hasFilePilotLink = managedLinks.length > 0;

		return {
			note: connectedNote,
			filePilotLink: hasFilePilotLink,
			otherLink:
				otherFrontmatterLink ||
				otherBodyLink ||
				!hasFilePilotLink,
		};
	}

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

	/**
	 * Add or remove a File Pilot managed connection.
	 */
	async setNodeConnection(
		source: TFile,
		target: TFile,
		connected: boolean,
	): Promise<boolean> {
		if (this.stateService.isClearingData) {
			throw new FilePilotError('CLEAR_IN_PROGRESS');
		}

		if (connected && source.path === target.path) {
			throw new FilePilotError(
				'FILE_GRAPH_SELF_LINK',
				`A graph node cannot link to itself: ${source.path}`,
			);
		}

		if (
			this.app.vault.getFileByPath(source.path) !== source ||
			this.app.vault.getFileByPath(target.path) !== target
		) {
			throw new FilePilotError(
				'FILE_GRAPH_NOTE_NOT_FOUND',
				`Graph connection endpoint no longer exists: ${source.path} -> ${target.path}`,
			);
		}

		// Validate graph connection endpoint types.
		if (
			source.extension !== 'md' ||
			(connected && target.extension !== 'md')
		) {
			throw new FilePilotError(
				'FILE_GRAPH_INVALID_NOTE_TYPE',
				'Graph connection endpoints must be Markdown notes',
			);
		}

		const matchesTarget = (link: string): boolean =>
			this.resolveManagedLink(source, link)?.path === target.path;

		const content = await this.app.vault.read(source);
		const info = getFrontMatterInfo(content);

		let parsed: unknown = {};

		if (info.exists) {
			try {
				parsed = parseYaml(info.frontmatter) ?? {};
			} catch {
				throw new FilePilotError(
					'FILE_GRAPH_FRONTMATTER_INVALID',
					`Invalid Frontmatter: ${source.path}`,
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
				`Invalid Frontmatter: ${source.path}`,
			);
		}

		const raw = (
			parsed as Record<string, unknown>
		)[GRAPH_LINKS_PROPERTY];

		let existing: string[] = [];

		if (raw !== undefined) {
			if (
				!Array.isArray(raw) ||
				!raw.every(value => typeof value === 'string')
			) {
				throw new FilePilotError(
					'FILE_GRAPH_FRONTMATTER_INVALID',
					`Invalid graph links: ${source.path}`,
				);
			}

			existing = raw;
		}

		if (existing.some(matchesTarget) === connected) {
			return false;
		}

		let changed = false;

		await this.app.fileManager.processFrontMatter(
			source,
			(frontmatter: Record<string, unknown>) => {
				if (this.stateService.isClearingData) {
					throw new FilePilotError('CLEAR_IN_PROGRESS');
				}

				if (
					this.app.vault.getFileByPath(source.path) !== source ||
					this.app.vault.getFileByPath(target.path) !== target
				) {
					throw new FilePilotError(
						'FILE_GRAPH_NOTE_NOT_FOUND',
						`Graph connection endpoint no longer exists: ${source.path} -> ${target.path}`,
					);
				}

				const value: unknown =
					frontmatter[GRAPH_LINKS_PROPERTY];

				let links: string[] = [];

				if (value !== undefined) {
					if (
						!Array.isArray(value) ||
						!value.every(item => typeof item === 'string')
					) {
						throw new FilePilotError(
							'FILE_GRAPH_FRONTMATTER_INVALID',
							`Invalid graph links: ${source.path}`,
						);
					}

					links = value;
				}

				if (links.some(matchesTarget) === connected) {
					return;
				}

				if (connected) {
					const linktext =
						this.app.metadataCache.fileToLinktext(
							target,
							source.path,
							true,
						);

					frontmatter[GRAPH_LINKS_PROPERTY] = [
						...links,
						`[[${linktext}]]`,
					];
				} else {
					frontmatter[GRAPH_LINKS_PROPERTY] =
						links.filter(link => !matchesTarget(link));
				}

				changed = true;
			},
		);

		return changed;
	}

	/**
	 * Resolve a managed wikilink to its destination note.
	 * Determine which note a given link in file-pilot-links actually points to.
	 */
	private resolveManagedLink(
		source: TFile,
		link: string,
	): TFile | null {
		const match = /^\[\[([^\]\r\n]+)\]\]$/.exec(link);
		const content = match?.[1];

		if (!content) {
			return null;
		}

		const linktext = content.split('|', 1)[0]?.trim();

		if (!linktext) {
			return null;
		}

		const { path } = parseLinktext(linktext);

		if (!path) {
			return null;
		}

		return this.app.metadataCache.getFirstLinkpathDest(
			path,
			source.path,
		);
	}

}
