import assert from 'node:assert/strict';
import test from 'node:test';

import { setLanguage } from '../fakes/index.mjs';
import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const { t } = await jiti.import('../../src/i18n/index.ts');

test('returns English text and interpolates file and folder counts', () => {
	setLanguage('en');

	assert.equal(t('pluginLoaded'), 'File Pilot loaded');
	assert.equal(
		t('scanCompleted', { fileCount: 3, folderCount: 2 }),
		'Imported 3 files and 2 folders',
	);
	assert.equal(
		t('managedEntryCount', { fileCount: 3, folderCount: 2 }),
		'Managed: 3 files, 2 folders',
	);
	assert.equal(t('noNewImportedEntries'), 'No new files or folders imported');
});

test('returns Chinese text and interpolates file and folder counts', () => {
	setLanguage('zh');

	assert.equal(t('pluginLoaded'), 'File Pilot 已加载');
	assert.equal(
		t('scanCompleted', { fileCount: 3, folderCount: 2 }),
		'已导入 3 个文件、2 个文件夹',
	);
	assert.equal(
		t('managedEntryCount', { fileCount: 3, folderCount: 2 }),
		'已管理 3 个文件、2 个文件夹',
	);
	assert.equal(t('noNewImportedEntries'), '无新文件或文件夹导入');
});

test('falls back to English for unsupported languages', () => {
	setLanguage('fr');

	assert.equal(t('pluginLoaded'), 'File Pilot loaded');
	assert.equal(
		t('scanCompleted', { fileCount: 3, folderCount: 2 }),
		'Imported 3 files and 2 folders',
	);
});
