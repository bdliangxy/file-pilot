import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Creates real files to exercise the scanner's actual fs calls.
// File paths must be relative POSIX-style paths inside the temporary root.
export async function createTempFileTree(files) {
    const rootPath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'file-pilot-test-'),
    );

    try {
        for (const file of files) {
            const segments = file.split('/');
            if (
                segments.some((segment) => segment === '..' || segment === '' || segment === '.')
                || path.isAbsolute(file)
                || file.includes('\\')
            ) {
                throw new Error(`Invalid test fixture path: ${file}`);
            }

            const absolutePath = path.join(rootPath, ...segments);
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, 'test-content');
        }
    } catch (error) {
        await fs.rm(rootPath, { recursive: true, force: true });
        throw error;
    }

    return {
        rootPath,
        async cleanup() {
            await fs.rm(rootPath, { recursive: true, force: true });
        },
    };
}
