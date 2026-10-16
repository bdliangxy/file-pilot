// An in-memory persistence fake shared across service instances.
export function createFakeDataAdapter(initialData = null) {
    let storedData = structuredClone(initialData);
    const savedData = [];

    return {
        savedData,
        async loadData() {
            return structuredClone(storedData);
        },
        async saveData(data) {
            const snapshot = structuredClone(data);
            storedData = snapshot;
            savedData.push(structuredClone(snapshot));
        },
    };
}
