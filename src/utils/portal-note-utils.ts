import { Notice } from 'obsidian';

import { FilePilotError } from '../error';
import { t } from '../i18n';

export type PortalNoteFeedback =
	| {
		status: 'success';
		changed: boolean;
	}
	| {
		status: 'failure';
		error: unknown;
	};

export function showPortalNoteFeedback(
	feedback: PortalNoteFeedback,
): void {
	if (feedback.status === 'success') {
		new Notice(
			t(
				feedback.changed
					? 'portalNoteUpdated'
					: 'portalNoteUnchanged',
			),
		);
		return;
	}

	const { error } = feedback;

	console.error('Failed to update Portal Note tree:', error);

	if (error instanceof FilePilotError) {
		switch (error.code) {
			case 'PORTAL_NOTE_NOT_FOUND':
				new Notice(t('portalNoteNotFound'));
				return;

			case 'PORTAL_NOTE_PATH_OCCUPIED':
				new Notice(t('portalNotePathOccupied'));
				return;

			default:
				new Notice(t('portalNoteUpdateFailed'));
				return;
		}
	}

	new Notice(t('portalNoteUpdateFailed'));
}
