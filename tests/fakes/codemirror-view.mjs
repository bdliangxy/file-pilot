// Minimal CodeMirror view primitives for deterministic decoration tests.
export class WidgetType {}

export const Decoration = {
    none: Object.freeze([]),
    replace(spec) {
        return {
            range(from, to) {
                return { from, to, widget: spec.widget };
            },
        };
    },
    set(ranges, sorted = false) {
        if (sorted) {
            for (let index = 1; index < ranges.length; index++) {
                if (ranges[index - 1].from > ranges[index].from) {
                    throw new Error('Decoration ranges must be sorted');
                }
            }
        }
        return ranges;
    },
};

// Record the atomic range provider without requiring a browser EditorView.
export const EditorView = {
    atomicRanges: {
        of(readRanges) {
            return { kind: 'atomicRanges', readRanges };
        },
    },
};

export const ViewPlugin = {
    fromClass(PluginClass, config) {
        const extension = {
            create(view) {
                return new PluginClass(view);
            },
            decorations: config.decorations,
        };
        extension.provided = config.provide?.(extension) ?? [];
        return extension;
    },
};
