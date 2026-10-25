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
}
export class TFolder {
    constructor(path) {
        this.path = path;
    }
}
