// Minimal Obsidian event and component primitives for watcher unit tests.
export class Component {
    constructor() {
        this.eventRefs = [];
    }
    registerEvent(ref) {
        this.eventRefs.push(ref);
    }
    unload() {
        for (const ref of this.eventRefs) {
            ref.off();
        }
        this.eventRefs = [];
        this.onunload?.();
    }
}
export class TFile {
    constructor(path) {
        this.path = path;
    }

    get name() { return this.path.split('/').at(-1); }
    get extension() {
        const index = this.name.lastIndexOf('.');
        return index > 0 ? this.name.slice(index + 1) : '';
    }
    get basename() {
        return this.extension ? this.name.slice(0, -this.extension.length - 1) : this.name;
    }
}
export class TFolder {
    constructor(path) {
        this.path = path;
    }
}
