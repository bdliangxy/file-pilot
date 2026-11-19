import { Notice } from 'obsidian';

import { FilePilotError } from '../error';
import { t } from '../i18n';

export function showPortalNoteFeedback(error?: unknown): void {
	if (error === undefined) {
		new Notice(t('portalNoteUpdated'));
		return;
	}

	console.error('Failed to update Portal Note tree:', error);

	new Notice(t('portalNoteUpdateFailed'));

	if (error instanceof FilePilotError) {

		switch (error.code) {
			case 'PORTAL_NOTE_PATH_OCCUPIED':
				new Notice(t('portalNotePathOccupied'));
				return;
		}
	}
}
