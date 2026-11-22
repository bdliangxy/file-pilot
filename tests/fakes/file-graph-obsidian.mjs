// Test-only YAML support is provided by the installed dependency tree.
// eslint-disable-next-line import/no-extraneous-dependencies -- Test-only YAML parser is transitively installed.
import YAML from 'yaml';

export class TFile {
    constructor(path) {
        this.path = path;
    }
}

export function getFrontMatterInfo(content) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    return match
        ? { exists: true, frontmatter: match[1] }
        : { exists: false, frontmatter: '' };
}

export function parseYaml(content) {
    return YAML.parse(content);
}

export function stringifyYaml(data) {
    return YAML.stringify(data);
}
