// Root-relative POSIX paths describing scanner test inputs.
export const IGNORE_FILE_TREE = [
    'report.pdf',
    'temp.tmp',
    'folder/c.txt',
    'folder/keep.pdf',
    'folder/temp/nested.txt',
    'ignored/secret.pdf',
    'ignored/nested/deep.txt',
    'temp/root.txt',
    'Thumbs.db',
    'folder/Thumbs.db',
    'folder/important.pdf',
];

export const IGNORE_FILE_TREE_SORTED = [...IGNORE_FILE_TREE].sort();
