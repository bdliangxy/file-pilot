
import { spawn } from 'node:child_process';

/**
 * Finds the Explorer window displaying the target directory
 * and requests foreground activation.
 */
const ACTIVATE_EXPLORER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class FilePilotWin32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(
        IntPtr hWnd,
        int command
    );
}
'@

$target = [System.IO.Path]::GetFullPath(
    $env:FILE_PILOT_TARGET_FOLDER
).TrimEnd([char]'\')

$shell = New-Object -ComObject Shell.Application

# Wait for Explorer to create or navigate its window.
$deadline = (Get-Date).AddSeconds(3)

while ((Get-Date) -lt $deadline) {

    foreach ($window in $shell.Windows()) {
        try {
            $currentPath = [string]$window.Document.Folder.Self.Path

            if ([string]::IsNullOrEmpty($currentPath)) {
                continue
            }

            $currentPath = [System.IO.Path]::GetFullPath(
                $currentPath
            ).TrimEnd([char]'\')

            if (-not [string]::Equals(
                $currentPath,
                $target,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
                continue
            }

            $handle = [IntPtr]$window.HWND

            # Restore the window only if it is minimized.
            if ([FilePilotWin32]::IsIconic($handle)) {
                [FilePilotWin32]::ShowWindowAsync(
                    $handle, 9
                ) | Out-Null
            }

            # Request foreground focus.
            if ([FilePilotWin32]::SetForegroundWindow($handle)) {
                exit 0
            }
        }
        catch {
            # Ignore Shell windows that are not filesystem folders.
        }
    }

    Start-Sleep -Milliseconds 150
}

# The folder may have opened even if activation failed.
exit 1
`;

/**
 * Opens a folder using Windows File Explorer.
 */
export function openWindowsFolder(
	folderPath: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('explorer.exe', [folderPath], {
			detached: true,
			stdio: 'ignore',
			windowsHide: false,
		});

		child.once('error', reject);

		child.once('spawn', () => {
			child.unref();

			// Focus activation is best-effort.
			void activateExplorerWindow(folderPath)
				.catch((error: unknown) => {
					console.warn(
						'Failed to activate File Explorer:',
						error,
					);
				});

			resolve('');
		});
	});
}

/**
 * Runs the Windows foreground activation script.
 */
function activateExplorerWindow(
	folderPath: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const encodedScript = Buffer.from(
			ACTIVATE_EXPLORER_SCRIPT,
			'utf16le',
		).toString('base64');

		const child = spawn(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-Sta',
				'-EncodedCommand',
				encodedScript,
			],
			{
				windowsHide: true,
				stdio: 'ignore',
				env: {
					...process.env,
					FILE_PILOT_TARGET_FOLDER: folderPath,
				},
			},
		);

		child.once('error', reject);

		child.once('exit', (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(
				'Explorer foreground activation was not confirmed.',
			));
		});
	});
}
