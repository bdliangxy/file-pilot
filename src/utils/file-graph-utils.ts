import type { FileRecord } from '../core/file-interface';
import type { PortalTreeNode } from './portal-tree-utils';
import { FilePilotError } from '../error';
import { Notice } from 'obsidian';
import { t } from '../i18n/index';

export interface PortalTreeRelation {
	parentRecordId: string | null;
	childRecord: FileRecord;
}

export function collectPortalTreeRelations(
	tree: PortalTreeNode,
): PortalTreeRelation[] {
	const relations: PortalTreeRelation[] = [];

	function visit(
		node: PortalTreeNode,
		parentRecordId: string | null,
	): void {
		if (node.record === null) {
			throw new FilePilotError(
				'FILE_GRAPH_RECORD_MISSING',
				`File graph node has no FileRecord: ${node.path}`,
			);
		}

		relations.push({
			parentRecordId,
			childRecord: node.record,
		});

		for (const child of node.children) {
			visit(child, node.record.id);
		}
	}

	for (const child of tree.children) {
		visit(child, null);
	}

	return relations;
}

type FileGraphFeedback =
	| {
		status: 'success';
		changed: boolean;
	}
	| {
		status: 'failure';
		error: unknown;
	};

export function showFileGraphFeedback(
	feedback: FileGraphFeedback,
): void {
	if (feedback.status === 'success') {
		new Notice(
			feedback.changed
				? t('fileGraphUpdated')
				: t('fileGraphUnchanged'),
		);
		return;
	}

	const { error } = feedback;

	console.error('File graph update failed:', error);

	if (!(error instanceof FilePilotError)) {
		new Notice(t('fileGraphUpdateFailed'));
		return;
	}

	let message: string;

	switch (error.code) {
		case 'FILE_GRAPH_RECORD_MISSING':
			message = t('fileGraphRecordMissing');
			break;

		case 'FILE_GRAPH_FRONTMATTER_INVALID':
			message = t('fileGraphFrontmatterInvalid');
			break;

		case 'SHADOW_NOTE_NOT_FOUND':
			message = t('fileGraphShadowNoteNotFound');
			break;

		case 'PORTAL_NOTE_NOT_FOUND':
			message = t('fileGraphPortalNoteNotFound');
			break;

		case 'PORTAL_NOTE_PATH_OCCUPIED':
			message = t('fileGraphPortalNotePathOccupied');
			break;

		case 'CLEAR_IN_PROGRESS':
			new Notice(t('clearInProgress'));
			return;

		case 'FILE_GRAPH_SELF_LINK':
			new Notice(t('fileGraphSelfLink'));
			return;

		case 'FILE_GRAPH_NOTE_NOT_FOUND':
			message = t('fileGraphNoteNotFound');
			break;

		case 'FILE_GRAPH_INVALID_NOTE_TYPE':
			new Notice(t('fileGraphInvalidNoteType'));
			return;

		default:
			new Notice(t('fileGraphUpdateFailed'));
			return;
	}

	new Notice(`${message}\n${error.message}`);
}
