import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

export { setLanguage } from './obsidian.mjs';

const obsidianFakePath = fileURLToPath(
	new URL('./obsidian.mjs', import.meta.url),
);

export function createTestJiti(metaUrl) {
	return createJiti(metaUrl, {
		alias: { obsidian: obsidianFakePath },
	});
}

export function makeScannedFile(path, options = {}) {
	const fileName = path.split('/').at(-1) ?? path;
	const dotIndex = fileName.lastIndexOf('.');
	const hasExtension = dotIndex > 0;

	return {
		path,
		nativeIdentity: options.nativeIdentity ?? '1:2',
		baseName: options.baseName ?? (
			hasExtension ? fileName.slice(0, dotIndex) : fileName
		),
		extension: Object.hasOwn(options, 'extension')
			? options.extension
			: hasExtension
				? fileName.slice(dotIndex + 1)
				: null,
		size: options.size ?? 123,
		mtimeMs: options.mtimeMs ?? 456,
	};
}

export function createFakeShadowNoteService() {
	const requestedPaths = [];
	const createdNotes = [];

	return {
		requestedPaths,
		createdNotes,
		getAvailableShadowNotePath(relativePath) {
			requestedPaths.push(relativePath);
			return `ShadowNotes/${relativePath.replaceAll('/', '_')}.md`;
		},
		async createShadowNote(notePath, fileId) {
			createdNotes.push({ notePath, fileId });
		},
	};
}

export function createFakeVault(initialPaths = []) {
	const paths = new Set(initialPaths);
	const lookedUpPaths = [];
	const createdFolders = [];
	const createdFiles = [];
	const vault = {
		getAbstractFileByPath(path) {
			lookedUpPaths.push(path);
			return paths.has(path) ? { path } : null;
		},
		getFileByPath(path) {
			return paths.has(path) ? { path } : null;
		},
		getFolderByPath(path) {
			return paths.has(path) ? { path } : null;
		},
		async createFolder(path) {
			createdFolders.push(path);
			paths.add(path);
		},
		async create(path, content) {
			createdFiles.push({ path, content });
			paths.add(path);
		},
	};
	return { vault, paths, lookedUpPaths, createdFolders, createdFiles };
}
