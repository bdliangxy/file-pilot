export { getLanguage } from './obsidian.mjs';
export { Notice } from './obsidian-settings.mjs';

export class FakeElement {
    constructor(parent = null) {
        this.parent = parent;
        this.children = [];
        this.classes = new Set();
        this.text = '';
        this.scrollTop = 0;
    }
    get isConnected() {
        return this.parent ? this.parent.isConnected : this.connected !== false;
    }
    createDiv(options = {}) {
        const element = new FakeElement(this);
        for (const cls of (options.cls ?? '').split(/\s+/).filter(Boolean)) {
            element.classes.add(cls);
        }
        element.text = options.text ?? '';
        this.children.push(element);
        return element;
    }
    empty() {
        for (const child of this.children) child.connected = false;
        this.children = [];
    }
    addClass(cls) { this.classes.add(cls); }
    removeClass(cls) { this.classes.delete(cls); }
    setText(text) { this.text = text; }
}
export class Setting {
    constructor(parent) {
        this.element = parent.createDiv();
    }
    setName(text) { this.name = text; return this; }
    setDesc(text) { this.description = text; return this; }
    addButton(callback) {
        callback({
            setButtonText() { return this; },
            setCta() { return this; },
            onClick() { return this; },
        });
        return this;
    }
}
export class ItemView {
    constructor(leaf) {
        this.app = leaf.app;
        this.contentEl = leaf.contentEl;
    }
}
export class WorkspaceLeaf {}
