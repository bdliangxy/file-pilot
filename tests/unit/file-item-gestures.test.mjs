import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
    DEFAULT_FILE_ITEM_SHORTCUTS,
    resolveFileItemAction,
} = await jiti.import('../../src/utils/file-item-gestures.ts');

function mouseEvent(type, overrides = {}) {
    return {
        type,
        button: 0,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...overrides,
    };
}

test('default mapping uses the intended gestures and actions', () => {
    assert.deepEqual(DEFAULT_FILE_ITEM_SHORTCUTS, [
        { type: 'dblclick', button: 0, region: 'item', action: 'openSource' },
        { type: 'dblclick', button: 0, region: 'secondary', action: 'editSummary' },
        { type: 'click', button: 0, altKey: true, action: 'openContainingFolder' },
        { type: 'click', button: 0, ctrlKey: true, action: 'openShadowNote' },
    ]);
});

test('unmodified double-click opens the source in the default item region', () => {
    assert.equal(resolveFileItemAction(mouseEvent('dblclick')), 'openSource');
    assert.equal(resolveFileItemAction(mouseEvent('dblclick'), 'item'), 'openSource');
});

test('double-click on the path or summary region requests summary editing', () => {
    assert.equal(resolveFileItemAction(mouseEvent('dblclick'), 'secondary'), 'editSummary');
});

test('Ctrl+left-click opens the Shadow Note in either region', () => {
    const event = mouseEvent('click', { ctrlKey: true });
    for (const region of ['item', 'secondary']) {
        assert.equal(resolveFileItemAction(event, region), 'openShadowNote');
    }
});

test('Alt+left-click opens the containing folder in either region', () => {
    const event = mouseEvent('click', { altKey: true });
    for (const region of ['item', 'secondary']) {
        assert.equal(resolveFileItemAction(event, region), 'openContainingFolder');
    }
});

test('ordinary left-click and unmatched event types do nothing', () => {
    for (const type of ['click', 'mousedown', 'mouseup', 'mousemove']) {
        assert.equal(resolveFileItemAction(mouseEvent(type)), null);
    }
});

test('unconfigured middle and side buttons do nothing by default', () => {
    for (const button of [1, 3, 4]) {
        assert.equal(resolveFileItemAction(mouseEvent('auxclick', { button })), null);
    }
});

test('right mouse button is reserved even when a custom rule matches', () => {
    const custom = [
        { type: 'click', button: 2, action: 'openSource' },
        { type: 'dblclick', button: 2, action: 'editSummary' },
        { type: 'auxclick', button: 2, action: 'openShadowNote' },
    ];

    for (const type of ['click', 'dblclick', 'auxclick']) {
        assert.equal(resolveFileItemAction(mouseEvent(type, { button: 2 }), 'item', custom), null);
    }
    assert.equal(resolveFileItemAction(mouseEvent('contextmenu', { button: 0 }), 'item', custom), null);
});

test('unconfigured modifier combinations never fall through to simpler shortcuts', () => {
    for (const overrides of [
        { ctrlKey: true, altKey: true },
        { ctrlKey: true, shiftKey: true },
        { altKey: true, metaKey: true },
        { shiftKey: true },
        { metaKey: true },
    ]) {
        assert.equal(resolveFileItemAction(mouseEvent('click', overrides)), null);
    }
    for (const overrides of [
        { ctrlKey: true },
        { altKey: true },
        { shiftKey: true },
        { metaKey: true },
    ]) {
        assert.equal(resolveFileItemAction(mouseEvent('dblclick', overrides), 'secondary'), null);
    }
});

test('custom rules can remap all three default opening gestures', () => {
    const custom = [
        { type: 'dblclick', button: 0, action: 'openShadowNote' },
        { type: 'click', button: 0, ctrlKey: true, action: 'openSource' },
        { type: 'click', button: 0, altKey: true, action: 'openContainingFolder' },
    ];
    assert.equal(resolveFileItemAction(mouseEvent('dblclick'), 'item', custom), 'openShadowNote');
    assert.equal(resolveFileItemAction(mouseEvent('click', { ctrlKey: true }), 'item', custom), 'openSource');
    assert.equal(resolveFileItemAction(mouseEvent('click', { altKey: true }), 'item', custom), 'openContainingFolder');
});

test('a custom middle-button rule matches auxclick only', () => {
    const custom = [{ type: 'auxclick', button: 1, action: 'openShadowNote' }];
    assert.equal(resolveFileItemAction(mouseEvent('auxclick', { button: 1 }), 'item', custom), 'openShadowNote');
    assert.equal(resolveFileItemAction(mouseEvent('click', { button: 1 }), 'item', custom), null);
});

test('custom side-button rules can use different actions', () => {
    const custom = [
        { type: 'auxclick', button: 3, action: 'openContainingFolder' },
        { type: 'auxclick', button: 4, action: 'openSource' },
    ];
    assert.equal(resolveFileItemAction(mouseEvent('auxclick', { button: 3 }), 'item', custom), 'openContainingFolder');
    assert.equal(resolveFileItemAction(mouseEvent('auxclick', { button: 4 }), 'item', custom), 'openSource');
    assert.equal(resolveFileItemAction(mouseEvent('auxclick', { button: 1 }), 'item', custom), null);
});

test('custom combinations require an exact match of every modifier', () => {
    const custom = [
        {
            type: 'click',
            button: 0,
            ctrlKey: true,
            shiftKey: true,
            action: 'openShadowNote',
        },
        {
            type: 'auxclick',
            button: 1,
            metaKey: true,
            action: 'openContainingFolder',
        },
    ];

    assert.equal(resolveFileItemAction(mouseEvent('click', { ctrlKey: true, shiftKey: true }), 'item', custom), 'openShadowNote');
    assert.equal(resolveFileItemAction(mouseEvent('click', { ctrlKey: true }), 'item', custom), null);
    assert.equal(resolveFileItemAction(mouseEvent('click', { ctrlKey: true, shiftKey: true, altKey: true }), 'item', custom), null);
    assert.equal(resolveFileItemAction(mouseEvent('auxclick', { button: 1, metaKey: true }), 'item', custom), 'openContainingFolder');
    assert.equal(resolveFileItemAction(mouseEvent('auxclick', { button: 1 }), 'item', custom), null);
});

test('region-specific rules override shared rules regardless of their order', () => {
    const custom = [
        { type: 'dblclick', button: 0, action: 'openSource' },
        { type: 'dblclick', button: 0, region: 'secondary', action: 'editSummary' },
        { type: 'dblclick', button: 0, region: 'item', action: 'openShadowNote' },
    ];

    assert.equal(resolveFileItemAction(mouseEvent('dblclick'), 'item', custom), 'openShadowNote');
    assert.equal(resolveFileItemAction(mouseEvent('dblclick'), 'secondary', custom), 'editSummary');
});

test('a shared rule applies across regions but another region-specific rule does not', () => {
    const scoped = [{ type: 'dblclick', button: 0, region: 'item', action: 'openSource' }];
    const shared = [{ type: 'click', button: 0, ctrlKey: true, action: 'openShadowNote' }];

    assert.equal(resolveFileItemAction(mouseEvent('dblclick'), 'secondary', scoped), null);
    assert.equal(resolveFileItemAction(mouseEvent('click', { ctrlKey: true }), 'secondary', shared), 'openShadowNote');
});

test('resolver does not mutate an event or custom shortcut configuration', () => {
    const event = Object.freeze(mouseEvent('dblclick'));
    const custom = Object.freeze([
        Object.freeze({ type: 'dblclick', button: 0, action: 'openSource' }),
    ]);

    assert.equal(resolveFileItemAction(event, 'item', custom), 'openSource');
    assert.deepEqual(custom, [{ type: 'dblclick', button: 0, action: 'openSource' }]);
    assert.equal(event.type, 'dblclick');
});
