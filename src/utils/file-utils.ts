
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return '—';
	}

	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${Number(size.toFixed(2))} ${SIZE_UNITS[unitIndex]}`;
}
