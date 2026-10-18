
interface FileFilter {
	name: string;
	extensions: string[];
}

type OpenDialogProperty =
	| 'openFile'
	| 'openDirectory'
	| 'multiSelections'
	| 'showHiddenFiles';

interface OpenDialogOptions {
	title?: string;
	defaultPath?: string;
	properties?: OpenDialogProperty[];
	filters?: FileFilter[];
}


interface SaveDialogOptions {
	title?: string;
	defaultPath?: string;
	filters?: FileFilter[];
}

interface NativeDialog {
	showOpenDialog(options: OpenDialogOptions): Promise<{
		canceled: boolean;
		filePaths: string[];
	}>;

	showSaveDialog(options: SaveDialogOptions): Promise<{
		canceled: boolean;
		filePath?: string;
	}>;
}

function getNativeDialog(): NativeDialog {
	const desktopWindow = window as Window & {
		require?: (id: string) => unknown;
	};

	if (!desktopWindow.require) {
		throw new Error('Electron module loader unavailable');
	}

	const remote = desktopWindow.require(
		'@electron/remote',
	) as { dialog: NativeDialog };

	return remote.dialog;
}

export async function pickPaths(
	options: OpenDialogOptions = {},
): Promise<string[]> {
	// Default to selecting a single file.
	const properties: OpenDialogProperty[] = [
		...(options.properties ?? ['openFile']),
	];

	// Always show hidden files.
	if (!properties.includes('showHiddenFiles')) {
		properties.push('showHiddenFiles');
	}

	const result = await getNativeDialog().showOpenDialog({
		...options,
		properties,
	});

	return result.canceled ? [] : result.filePaths;
}

export async function pickSavePath(
	options: SaveDialogOptions = {},
): Promise<string | undefined> {
	const result = await getNativeDialog().showSaveDialog(options);

	return result.canceled ? undefined : result.filePath;
}
