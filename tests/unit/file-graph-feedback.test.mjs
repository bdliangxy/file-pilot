import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Notice } from '../fakes/obsidian-settings.mjs';
import { setLanguage } from '../fakes/obsidian.mjs';

const jiti = createJiti(import.meta.url, {
    alias: {
        obsidian: fileURLToPath(
            new URL('../fakes/obsidian-settings.mjs', import.meta.url),
        ),
    },
});
const { showFileGraphFeedback } = await jiti.import('../../src/utils/file-graph-utils.ts');
const { FilePilotError } = await jiti.import('../../src/error.ts');
const { en } = await jiti.import('../../src/i18n/locales/en.ts');
const { zh } = await jiti.import('../../src/i18n/locales/zh.ts');

test('graph edit errors produce localized notices and log the original error', t => {
    const log = t.mock.method(console, 'error', () => {});
    const cases = [
        ['FILE_GRAPH_SELF_LINK', 'fileGraphSelfLink', false],
        ['FILE_GRAPH_NOTE_NOT_FOUND', 'fileGraphNoteNotFound', true],
        ['FILE_GRAPH_INVALID_NOTE_TYPE', 'fileGraphInvalidNoteType', false],
        ['FILE_GRAPH_FRONTMATTER_INVALID', 'fileGraphFrontmatterInvalid', true],
        ['CLEAR_IN_PROGRESS', 'clearInProgress', false],
    ];
    try {
        for (const [language, locale] of [['en', en], ['zh', zh]]) {
            setLanguage(language);
            for (const [code, key, detail] of cases) {
                Notice.messages.length = 0;
                const error = new FilePilotError(code, 'detail');
                showFileGraphFeedback({ status: 'failure', error });
                assert.deepEqual(Notice.messages, [
                    detail ? `${locale[key]}\ndetail` : locale[key],
                ]);
                assert.equal(log.mock.calls.at(-1).arguments[1], error);
            }
        }
    } finally {
        setLanguage('en');
        Notice.messages.length = 0;
    }
});

test('graph feedback handles success, no change and unexpected errors', t => {
    t.mock.method(console, 'error', () => {});
    try {
        Notice.messages.length = 0;
        showFileGraphFeedback({ status: 'success', changed: true });
        showFileGraphFeedback({ status: 'success', changed: false });
        showFileGraphFeedback({ status: 'failure', error: new Error('write failed') });
        assert.deepEqual(Notice.messages, [
            en.fileGraphUpdated, en.fileGraphUnchanged, en.fileGraphUpdateFailed,
        ]);
    } finally {
        Notice.messages.length = 0;
    }
});
