import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
    getFilePilotTreeBodyLines,
    isFilePilotTreeBodyLine,
} = await jiti.import('../../src/utils/file-pilot-tree-fence.ts');

function scan(lines) {
    return [...getFilePilotTreeBodyLines(
        lines.length,
        index => lines[index],
    )];
}

test('detects only body lines in File Pilot tree fences', () => {
    const lines = [
        'Before',
        '```file-pilot-tree',
        'Root/',
        '├── |||',
        '```',
        '```typescript',
        '|||',
        '```',
        '~~~file-pilot-tree',
        '└── |||',
        '~~~',
        'After',
    ];
    assert.deepEqual(scan(lines), [2, 3, 9]);
    assert.equal(isFilePilotTreeBodyLine(3, i => lines[i]), true);
    assert.equal(isFilePilotTreeBodyLine(1, i => lines[i]), false);
    assert.equal(isFilePilotTreeBodyLine(4, i => lines[i]), false);
    assert.equal(isFilePilotTreeBodyLine(11, i => lines[i]), false);
    assert.equal(isFilePilotTreeBodyLine(-1, i => lines[i]), false);
});

test('closing markers must match the marker kind and opening length', () => {
    const lines = [
        '````file-pilot-tree',
        'entry',
        '~~~',
        'entry',
        '```',
        'entry',
        '````',
        'outside',
    ];
    assert.deepEqual(scan(lines), [1, 2, 3, 4, 5]);
});

test('fences inside an ordinary code fence do not open a nested tree', () => {
    const lines = [
        '```typescript',
        '```file-pilot-tree',
        '|||',
        '```',
        'outside',
    ];
    assert.deepEqual(scan(lines), []);
});

test('fence languages are exact and allow up to three indentation spaces', () => {
    const lines = [
        '   ```file-pilot-tree extra',
        'tree entry',
        '   ```',
        '```file-pilot-tree-other',
        'not a tree',
        '```',
        '    ```file-pilot-tree',
        'also not a tree',
    ];
    assert.deepEqual(scan(lines), [1]);
});
