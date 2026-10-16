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
