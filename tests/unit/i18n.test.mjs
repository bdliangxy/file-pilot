import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

import { setLanguage } from '../mocks/obsidian.mjs';

const mockPath = fileURLToPath(
	new URL('../mocks/obsidian.mjs', import.meta.url)
);

const jiti = createJiti(import.meta.url, {
	alias: {
		obsidian: mockPath,
	},
});
const { t } = await jiti.import('../../src/i18n/index.ts');

test('returns English text and interpolates parameters', () => {
	setLanguage('en');

	assert.equal(t('pluginLoaded'), 'File Pilot loaded');
	assert.equal(t('fileCount', { count: 3 }), '3 files');
});

test('returns Chinese text and interpolates parameters', () => {
	setLanguage('zh');

	assert.equal(t('pluginLoaded'), 'File Pilot 已加载');
	assert.equal(t('fileCount', { count: 3 }), '3 个文件');
});

test('falls back to English for unsupported languages', () => {
	setLanguage('fr');

	assert.equal(t('pluginLoaded'), 'File Pilot loaded');
	assert.equal(t('fileCount', { count: 3 }), '3 files');
});
