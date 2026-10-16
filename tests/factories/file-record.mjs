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

export function makeFileRecord(id = 'file-1', options = {}) {
    return {
        ...makeScannedFile(options.path ?? 'docs/report.pdf', options),
        id,
        status: options.status ?? 'available',
        shadowNotePath: options.shadowNotePath ?? 'ShadowNotes/report.md',
    };
}
