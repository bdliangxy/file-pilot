// Supply synthetic syntax trees for both lightweight views and real EditorState.
const excludedRanges = new WeakMap();

export function setSyntaxExclusions(state, ranges) {
    excludedRanges.set(state, ranges);
}

export function syntaxTree(state) {
    if (state.syntaxTree) return state.syntaxTree;

    return {
        resolveInner(position) {
            const excluded = (excludedRanges.get(state) ?? []).find(
                range => position >= range.from && position < range.to,
            );
            return { name: excluded?.name ?? 'Text', parent: null };
        },
    };
}
