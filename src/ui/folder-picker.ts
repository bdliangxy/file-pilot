import { t } from '../i18n';

interface FolderDialogResult {
	canceled: boolean;
	filePaths: string[];
}

interface FolderDialog {
	showOpenDialog(options: {
		title: string;
		defaultPath?: string;
		properties: ['openDirectory'];
	}): Promise<FolderDialogResult>;
}

interface ElectronRemote {
	dialog: FolderDialog;
}

export async function pickFolder(
	defaultPath: string,
): Promise<string | undefined> {
	const desktopWindow = window as Window & {
		require?: (id: string) => unknown;
	};

	if (!desktopWindow.require) {
		throw new Error('Electron module loader unavailable');
	}

	const remote = desktopWindow.require(
		'@electron/remote',
	) as ElectronRemote;

	const result = await remote.dialog.showOpenDialog({
		title: t('scanRootSelect'),
		defaultPath: defaultPath || undefined,
		properties: ['openDirectory'],
	});

	if (result.canceled) {
		return undefined;
	}

	return result.filePaths[0];
}
