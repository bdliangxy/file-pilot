export { getLanguage } from './obsidian.mjs';
export { Notice } from './obsidian-settings.mjs';

export function setIcon(element, icon) {
    element.icon = icon;
}

export class FakeElement {
    constructor(parent = null) {
        this.parent = parent;
        this.children = [];
        this.classes = new Set();
        this.text = '';
        this.attributes = {};
        this.listeners = new Map();
        this.scrollTop = 0;
    }

    get isConnected() {
        return this.connected !== false
            && (this.parent ? this.parent.isConnected : true);
    }

    createDiv(options = {}) {
        return this.createEl('div', options);
    }

    createEl(tag, options = {}) {
        const element = new FakeElement(this);
        element.tag = tag;
        for (const cls of (options.cls ?? '').split(/\s+/).filter(Boolean)) {
            element.classes.add(cls);
        }
        element.text = options.text ?? '';
        element.attributes = { ...options.attr };
        this.children.push(element);
        return element;
    }

    appendChild(element) {
        if (element.parent) {
            const siblings = element.parent.children;
            siblings.splice(siblings.indexOf(element), 1);
        }
        element.parent = this;
        this.children.push(element);
        return element;
    }

    before(element) {
        if (!this.parent) throw new Error('Cannot insert before a root element');
        const parent = this.parent;
        if (element.parent) {
            const siblings = element.parent.children;
            siblings.splice(siblings.indexOf(element), 1);
        }
        element.parent = parent;
        parent.children.splice(parent.children.indexOf(this), 0, element);
    }

    addEventListener(event, callback) {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(callback);
        this.listeners.set(event, listeners);
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    dispatch(event, properties = {}) {
        const syntheticEvent = {
            target: this,
            preventDefault() {},
            stopPropagation() {},
            ...properties,
        };
        for (const callback of this.listeners.get(event) ?? []) {
            callback(syntheticEvent);
        }
    }

    click() {
        for (const callback of this.listeners.get('click') ?? []) {
            callback();
        }
    }

    empty() {
        for (const child of this.children) child.connected = false;
        this.children = [];
    }

    focus() { this.focused = true; }
    select() { this.selected = true; }

    addClass(cls) { this.classes.add(cls); }
    removeClass(cls) { this.classes.delete(cls); }
    setText(text) { this.text = text; }
}

export class Setting {
    constructor(parent) {
        this.element = parent.createDiv({ cls: 'setting-item' });
        this.infoEl = this.element.createDiv({ cls: 'setting-item-info' });
        this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
        this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
        this.controlEl = this.element.createDiv({ cls: 'setting-item-control' });
    }

    setName(text) {
        this.name = text;
        this.nameEl.setText(text);
        return this;
    }

    setDesc(text) {
        this.description = text;
        this.descEl.setText(text);
        return this;
    }

    addButton(callback) {
        const element = this.controlEl.createEl('button');
        callback({
            setButtonText(text) { element.setText(text); return this; },
            setCta() { element.addClass('mod-cta'); return this; },
            onClick(handler) { element.addEventListener('click', handler); return this; },
            setDisabled(disabled) { element.disabled = disabled; return this; },
        });
        return this;
    }

    addSearch(callback) {
        const inputEl = this.controlEl.createEl('input');
        inputEl.value = '';
        const search = {
            inputEl,
            setPlaceholder(value) { inputEl.placeholder = value; return this; },
            setValue(value) { inputEl.value = value; return this; },
            onChange(handler) {
                inputEl.addEventListener('input', () => handler(inputEl.value));
                return this;
            },
        };
        callback(search);
        return this;
    }

    addDropdown(callback) {
        const selectEl = this.controlEl.createEl('select');
        selectEl.options = new Map();
        selectEl.value = '';
        const dropdown = {
            selectEl,
            addOption(value, label) { selectEl.options.set(value, label); return this; },
            setValue(value) { selectEl.value = value; return this; },
            onChange(handler) {
                selectEl.addEventListener('change', () => handler(selectEl.value));
                return this;
            },
        };
        callback(dropdown);
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
