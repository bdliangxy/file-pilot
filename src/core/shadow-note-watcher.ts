
import {
	Component,
	TFile,
	type Vault,
	type MetadataCache,
} from 'obsidian';
import { PluginStateService } from '../data/plugin-state-service';
import type { FileRecord } from './file-interface';

export interface FileSummaryChange {
	fileId: string;
	summary: string | null;
}

class FileSummaryChangeTracker {
	private readonly FSChangeListeners =
		new Set<(change: FileSummaryChange) => void>();

	private readonly lastSummaries =
		new Map<string, string | null>();

	private readonly latestReadVersions =
		new Map<string, number>();

	private nextReadVersion = 0;

	constructor(
		private readonly stateService: PluginStateService,
		private readonly getFileSummary: (
			record: FileRecord,
		) => Promise<string | null>,
	) { }

	subscribe(
		callback: (change: FileSummaryChange) => void,
	): () => void {
		this.FSChangeListeners.add(callback);

		return () => {
			this.FSChangeListeners.delete(callback);
		};
	}

	handleNoteChanged(notePath: string): void {
		if (
			this.FSChangeListeners.size === 0 ||
			this.stateService.isClearingData
		) {
			return;
		}

		const record = this.stateService
			.getFileRecords()
			.find(record => record.shadowNotePath === notePath);

		if (!record) {
			return;
		}

		void this.checkSummaryChange(record);
	}

	private async checkSummaryChange(
		record: FileRecord,
	): Promise<void> {
		const version = ++this.nextReadVersion;

		this.latestReadVersions.set(record.id, version);

		try {
			const summary = await this.getFileSummary(record);

			// Ignore outdated reads and data-clearing operations.
			if (
				this.latestReadVersions.get(record.id) !== version ||
				this.stateService.isClearingData ||
				this.FSChangeListeners.size === 0
			) {
				return;
			}

			// The FileRecord may have been removed or changed.
			const stillManaged = this.stateService
				.getFileRecords()
				.some(current =>
					current.id === record.id &&
					current.shadowNotePath === record.shadowNotePath
				);

			if (!stillManaged) {
				return;
			}

			// No notification when the Summary is unchanged.
			if (
				this.lastSummaries.has(record.id) &&
				this.lastSummaries.get(record.id) === summary
			) {
				return;
			}

			this.lastSummaries.set(record.id, summary);

			const change: FileSummaryChange = {
				fileId: record.id,
				summary,
			};

			for (const callback of this.FSChangeListeners) {
				try {
					callback(change);
				} catch (error) {
					console.error(
						'File Summary subscriber failed:',
						error,
					);
				}
			}
		} catch (error) {
			console.error(
				'Failed to read File Summary:',
				record.shadowNotePath,
				error,
			);
		}
	}

	forget(fileId: string): void {
		this.lastSummaries.delete(fileId);
		this.latestReadVersions.delete(fileId);
	}

	clear(): void {
		this.FSChangeListeners.clear();
		this.lastSummaries.clear();
		this.latestReadVersions.clear();
	}
}

export class ShadowNoteWatcher extends Component {
	// Currently, listening to shadow notes independently incurs significant overhead.
	// The function actually listens to all notes;
	// narrowing the scope to shadow notes is implemented by the subscribers.
	private deletionQueue: Promise<void> = Promise.resolve();
	private readonly noteChangedListeners =
		new Set<(notePath: string) => void>();
	private readonly summaryTracker: FileSummaryChangeTracker;

	constructor(
		private readonly vault: Vault,
		private readonly metadataCache: MetadataCache,
		private readonly stateService: PluginStateService,
		private readonly onRecordRemoved: () => void,
		getFileSummary: (
			record: FileRecord,
		) => Promise<string | null>,
	) {
		super();

		this.summaryTracker = new FileSummaryChangeTracker(
			stateService,
			getFileSummary,
		);
	}

	onNoteChanged(
		callback: (notePath: string) => void,
	): () => void {
		this.noteChangedListeners.add(callback);

		// Return a function that removes this subscription.
		return () => {
			this.noteChangedListeners.delete(callback);
		};
	}

	onFileSummaryChanged(
		callback: (change: FileSummaryChange) => void,
	): () => void {
		return this.summaryTracker.subscribe(callback);
	}

	onload(): void {
		this.registerEvent(
			this.vault.on('delete', (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				// Data reset handles record removal in bulk.
				if (this.stateService.isClearingData) {
					return;
				}
				const notePath = file.path;

				// Process deletions sequentially.
				this.deletionQueue = this.deletionQueue
					.then(() => this.handleDelete(notePath))
					.catch(error => {
						console.error(
							'Failed to synchronize Shadow Note deletion:',
							error,
						);
					});
			}),
		);

		// Notify subscribers after a note's metadata has been updated.
		this.registerEvent(
			this.metadataCache.on('changed', (file) => {
				const notePath = file.path;

				for (const callback of this.noteChangedListeners) {
					try {
						callback(notePath);
					} catch (error) {
						console.error(
							'Shadow Note change subscriber failed:',
							error,
						);
					}
				}
				this.summaryTracker.handleNoteChanged(notePath);
			}),
		);
	}

	private async handleDelete(notePath: string): Promise<void> {
		if (this.stateService.isClearingData) {
			return;
		}

		const records = this.stateService
			.getFileRecords()
			.filter(record => record.shadowNotePath === notePath);

		if (records.length === 0) {
			return;
		}

		let removedCount = 0;

		try {
			for (const record of records) {
				if (this.stateService.isClearingData) {
					break;
				}

				await this.stateService.removeFileRecord(record.id);
				this.summaryTracker.forget(record.id);
				removedCount++;
			}
		} finally {
			if (removedCount > 0) {
				this.onRecordRemoved();
			}
		}
	}

	async waitForPendingDeletions(): Promise<void> {
		await this.deletionQueue;
	}

	onunload(): void {
		this.noteChangedListeners.clear();
		this.summaryTracker.clear();
	}
}
