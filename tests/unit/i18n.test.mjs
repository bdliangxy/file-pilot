import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { t } = await jiti.import('../../src/i18n/index.ts');

test('returns English text and interpolates parameters', () => {
	assert.equal(t('pluginLoaded'), 'File Pilot loaded');
	assert.equal(t('fileCount', { count: 3 }), '3 files');
});
