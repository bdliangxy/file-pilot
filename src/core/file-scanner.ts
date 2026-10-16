import type {
	FileScope,
	ScannedFileInfo
} from "./file-interface";

import { promises as fs } from 'node:fs';

import {
	getAbsoluteFilePath,
	getRelativeFilePath,
	getFileBaseName,
	getFileExtension,
} from '../utils/path-utils';

import ignore, { type Ignore } from 'ignore';
export class FileScanner {
	async scan(fileScope: FileScope): Promise<ScannedFileInfo[]> {
		const results: ScannedFileInfo[] = [];

		const ignoreMatcher = ignore().add(
			fileScope.ignorePatterns,
		);

		await this.scanDirectory(
			fileScope.rootPath,
			fileScope.rootPath,
			results,
			ignoreMatcher,
		);

		return results;
	}

	private async scanDirectory(
		rootPath: string,
		currentPath: string,
		results: ScannedFileInfo[],
		ignoreMatcher: Ignore,
	): Promise<void> {
		const entries = await fs.readdir(
			currentPath,
			{ withFileTypes: true },
		);

		for (const entry of entries) {
			const absolutePath = getAbsoluteFilePath(
				currentPath,
				entry.name,
			);
			const relativePath = getRelativeFilePath(
				rootPath,
				absolutePath,
			);
			if (entry.isDirectory()) {
				if (ignoreMatcher.ignores(`${relativePath}/`)) {
					continue;
				}
				await this.scanDirectory(
					rootPath,
					absolutePath,
					results,
					ignoreMatcher,
				);

				continue;
			}

			if (!entry.isFile()) {
				continue;
			}
			if (ignoreMatcher.ignores(relativePath)) {
				continue;
			}
			const stats = await fs.stat(absolutePath);

			const nativeIdentity =
				stats.dev !== 0 || stats.ino !== 0
					? `${stats.dev}:${stats.ino}`
					: undefined;

			const scannedFileInfo: ScannedFileInfo = {
				path: relativePath,
				nativeIdentity,
				baseName: getFileBaseName(entry.name),
				extension: getFileExtension(entry.name),
				size: stats.size, //unit:byte
				mtimeMs: stats.mtimeMs,
			};

			results.push(scannedFileInfo);
		}
	}
}
