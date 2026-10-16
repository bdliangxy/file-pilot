import assert from 'node:assert/strict';
import test from 'node:test';

import { setLanguage } from '../fakes/index.mjs';
import { createTestJiti } from '../helpers/test-jiti.mjs';

const jiti = createTestJiti(import.meta.url);
const { t } = await jiti.import('../../src/i18n/index.ts');

test('returns English text and interpolates parameters', () => {
	setLanguage('en');

	assert.equal(t('pluginLoaded'), 'File Pilot loaded');
	assert.equal(t('scanCompleted', { count: 3 }), 'Imported 3 files');
});

test('returns Chinese text and interpolates parameters', () => {
	setLanguage('zh');

	assert.equal(t('pluginLoaded'), 'File Pilot 已加载');
	assert.equal(t('scanCompleted', { count: 3 }), '已导入 3 个文件');
});

test('falls back to English for unsupported languages', () => {
	setLanguage('fr');

	assert.equal(t('pluginLoaded'), 'File Pilot loaded');
	assert.equal(t('scanCompleted', { count: 3 }), 'Imported 3 files');
});
