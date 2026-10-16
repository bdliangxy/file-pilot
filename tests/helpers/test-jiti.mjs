import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const obsidianFakePath = fileURLToPath(
    new URL('../fakes/obsidian.mjs', import.meta.url),
);

export function createTestJiti(metaUrl) {
    return createJiti(metaUrl, {
        alias: { obsidian: obsidianFakePath },
    });
}
