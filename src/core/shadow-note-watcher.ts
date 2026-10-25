
import { Component, TFile, Vault } from 'obsidian';
import { PluginStateService } from '../data/plugin-state-service';

export class ShadowNoteWatcher extends Component {
	private deletionQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly vault: Vault,
		private readonly stateService: PluginStateService,
		private readonly onRecordRemoved: () => void,
	) {
		super();
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
