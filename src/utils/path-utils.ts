import path from 'node:path';
export function unifyPathFormat(filePath: string): string {
	return filePath.replaceAll('\\', '/');
}

export function getRelativeFilePath(
	rootPath: string,
	absolutePath: string,
): string {
	return unifyPathFormat(
		path.relative(rootPath, absolutePath),
	);
}
// filePath format:basename.ext，Path separators do not need to be considered.
export function getAbsoluteFilePath(
	rootPath: string,
	filePath: string,
): string {
	return path.join(rootPath, filePath);
}

export function getFileExtension(
	filePath: string,
): string | null {
	const extension = path.extname(filePath);

	return extension === ''
		? null
		: extension.slice(1);
}

export function getFileBaseName(
	filePath: string,
): string {
	const extension = path.extname(filePath);

	return path.basename(
		filePath,
		extension,
	);
}

export function getFullName(relativePath: string): string {
	return path.posix.basename(relativePath);
}

