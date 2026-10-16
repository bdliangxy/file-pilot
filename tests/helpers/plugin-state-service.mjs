import { makePluginData } from '../factories/plugin-data.mjs';

// Keep the existing recording-adapter semantics: loadData returns the supplied
// initial value, and saveData records snapshots without mutating that value.
export function createPluginStateServiceTestContext(
    PluginStateService,
    storedData = makePluginData(),
) {
    const savedData = [];
    const service = new PluginStateService({
        loadData: async () => storedData,
        saveData: async (data) => {
            savedData.push(structuredClone(data));
        },
    });

    return { service, savedData };
}
