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
        this.pointerCaptures = new Set();
        const properties = new Map();
        this.style = {
            setProperty: (name, value) => properties.set(name, value),
            getPropertyValue: name => properties.get(name) ?? '',
            removeProperty: name => properties.delete(name),
        };
    }

    get isConnected() {
        return this.connected !== false
            && (this.parent ? this.parent.isConnected : true);
    }

    createDiv(options = {}) {
        return this.createEl('div', options);
    }

    createSpan(options = {}) {
        return this.createEl('span', options);
    }

    querySelector(selector) {
        if (!selector.startsWith('.')) throw new Error('Unsupported selector: ' + selector);
        for (const child of this.children) {
            if (child.classes.has(selector.slice(1))) return child;
            const match = child.querySelector(selector);
            if (match) return match;
        }
        return null;
    }

    prepend(element) {
        this.appendChild(element);
        this.children.pop();
        this.children.unshift(element);
    }

    remove() {
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index >= 0) this.parent.children.splice(index, 1);
        }
        this.parent = null;
        this.connected = false;
    }

    setPointerCapture(id) { this.pointerCaptures.add(id); }
    hasPointerCapture(id) { return this.pointerCaptures.has(id); }
    releasePointerCapture(id) { this.pointerCaptures.delete(id); }

    createEl(tag, options = {}) {
        const element = new FakeElement(this);
        element.tag = tag;
        for (const cls of (Array.isArray(options.cls) ? options.cls : (options.cls ?? '').split(/\s+/).filter(Boolean))) {
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

    addEventListener(event, callback, options = {}) {
        if (options.signal?.aborted) return;
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(callback);
        this.listeners.set(event, listeners);
        options.signal?.addEventListener('abort', () => {
            const index = listeners.indexOf(callback);
            if (index >= 0) listeners.splice(index, 1);
        }, { once: true });
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

// Minimal modal lifecycle and suggestion selection for UI tests.
export class Modal {
    constructor(app) {
        this.app = app;
        this.modalEl = new FakeElement();
        this.modalEl.connected = false;
        this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
        this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
        this.isOpen = false;
    }

    setTitle(title) {
        this.title = title;
        this.titleEl.setText(title);
        return this;
    }

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.app.openModals ??= new Set();
        this.app.openModals.add(this);
        this.modalEl.connected = true;
        this.onOpen();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.app.openModals.delete(this);
        this.modalEl.connected = false;
        this.onClose();
    }

    onOpen() {}
    onClose() {}
}

export class FuzzySuggestModal extends Modal {
    setPlaceholder(placeholder) {
        this.placeholder = placeholder;
    }

    chooseItem(item) {
        if (!this.isOpen) return;
        this.close();
        this.onChooseItem(item);
    }

    onClose() {
        this.contentEl.empty();
    }
}

export function setTooltip(element, text, options) {
    element.tooltip = { text, options };
}

export class Setting {
    constructor(parent) {
        this.element = parent.createDiv({ cls: 'setting-item' });
        this.settingEl = this.element;
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

    setClass(cls) {
        for (const name of cls.split(/\s+/).filter(Boolean)) {
            this.settingEl.addClass(name);
        }
        return this;
    }

    setHeading() {
        return this.setClass('setting-item-heading');
    }

    addExtraButton(callback) {
        const element = this.controlEl.createDiv({ cls: 'clickable-icon extra-setting-button' });
        callback({
            setIcon(icon) { setIcon(element, icon); return this; },
            setTooltip(text) { setTooltip(element, text); return this; },
            setDisabled(disabled) { element.disabled = disabled; return this; },
            onClick(handler) { element.addEventListener('click', handler); return this; },
        });
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
