
import {
	Component,
	TFile,
	type Vault,
	type MetadataCache,
} from 'obsidian';
import { PluginStateService } from '../data/plugin-state-service';

export class ShadowNoteWatcher extends Component {
	// Currently, listening to shadow notes independently incurs significant overhead.
	// The function actually listens to all notes;
	// narrowing the scope to shadow notes is implemented by the subscribers.
	private deletionQueue: Promise<void> = Promise.resolve();
	private readonly noteChangedListeners =
		new Set<(notePath: string) => void>();

	constructor(
		private readonly vault: Vault,
		private readonly metadataCache: MetadataCache,
		private readonly stateService: PluginStateService,
		private readonly onRecordRemoved: () => void,
	) {
		super();
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

	onload(): void {
		this.registerEvent(
			this.vault.on('delete', (file) => {
				if (!(file instanceof TFile)) {
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
			}),
		);
	}

	private async handleDelete(notePath: string): Promise<void> {
		const records = this.stateService
			.getFileRecords()
			.filter(record => record.shadowNotePath === notePath);

		if (records.length === 0) {
			return;
		}

		let removedCount = 0;

		try {
			for (const record of records) {
				await this.stateService.removeFileRecord(record.id);
				removedCount++;
			}
		} finally {
			if (removedCount > 0) {
				this.onRecordRemoved();
			}
		}
	}
}
