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
