
import { readFile, writeFile } from 'node:fs/promises';
import { t } from '../i18n';
import {
	pickPaths,
	pickSavePath,
} from './native-file-dialog';


export async function importIgnoreRules():
	Promise<string | undefined> {

	const selectedPaths = await pickPaths({
		title: t('ignoreImportDialogTitle'),
		properties: ['openFile'],
		filters: [
			{
				name: 'Ignore / Text files',
				extensions: ['txt', 'gitignore'],
			},
			{
				name: 'All files',
				extensions: ['*'],
			},
		],
	});

	const selectedPath = selectedPaths[0];

	if (selectedPath === undefined) {
		return undefined;
	}

	const content = await readFile(selectedPath, 'utf8');

	return content
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n');
}

export async function exportIgnoreRules(
	content: string,
): Promise<boolean> {

	const selectedPath = await pickSavePath({
		title: t('ignoreExportDialogTitle'),
		defaultPath: 'file-pilot-ignore.txt',
		filters: [
			{
				name: 'Text files',
				extensions: ['txt'],
			},
			{
				name: 'All files',
				extensions: ['*'],
			},
		],
	});

	if (selectedPath === undefined) {
		return false;
	}

	await writeFile(selectedPath, content, 'utf8');
	return true;
}
