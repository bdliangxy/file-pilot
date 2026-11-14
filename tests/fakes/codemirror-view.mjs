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

export const ViewPlugin = {
    fromClass(PluginClass, config) {
        return {
            create(view) {
                return new PluginClass(view);
            },
            decorations: config.decorations,
        };
    },
};
