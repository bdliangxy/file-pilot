export { getLanguage, setLanguage } from './obsidian.mjs';

// Minimal Obsidian setting controls and DOM surfaces used by the setting UI.
export class FakeElement {
    constructor(tag = 'div') {
        this.tag = tag;
        this.children = [];
        this.components = [];
        this.classes = new Set();
        this.handlers = new Map();
        this.attributes = new Map();
        this.dataset = {};
        this.value = '';
        this.text = '';
        this.classList = {
            toggle: (name, enabled) => {
                if (enabled) this.classes.add(name);
                else this.classes.delete(name);
            },
        };
    }

    addClass(...names) {
        for (const name of names) this.classes.add(name);
        return this;
    }

    createEl(tag, options = {}) {
        const child = new FakeElement(tag);
        if (options.cls) {
            for (const name of options.cls.split(/\s+/)) child.addClass(name);
        }
        if (options.text) child.text = options.text;
        this.children.push(child);
        return child;
    }

    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }

    empty() {
        this.children = [];
        this.components = [];
        this.text = '';
    }

    setText(text) { this.text = text; }
    setAttribute(name, value) { this.attributes.set(name, value); }

    addEventListener(name, handler) {
        const listeners = this.handlers.get(name) ?? [];
        listeners.push(handler);
        this.handlers.set(name, listeners);
    }

    dispatchKey(key, isComposing = false) {
        let prevented = false;
        const event = {
            key,
            isComposing,
            preventDefault() { prevented = true; },
        };
        const results = (this.handlers.get('keydown') ?? []).map((handler) => handler(event));
        return { prevented, results };
    }

    querySelector(selector) {
        const target = selector.startsWith('.') ? selector.slice(1) : null;
        for (const child of this.children) {
            if (target && child.classes.has(target)) return child;
            const descendant = child.querySelector(selector);
            if (descendant) return descendant;
        }
        return null;
    }

    focus() { this.focused = true; }
}

export class Notice {
    static messages = [];

    constructor(message) {
        this.message = message;
        Notice.messages.push(message);
    }
}

export class ButtonComponent {
    constructor(parent) {
        this.buttonEl = parent.createEl('button');
        parent.components.push(this);
    }

    setIcon(icon) { this.icon = icon; return this; }
    setButtonText(label) { this.label = label; return this; }
    setCta() { return this; }
    onClick(handler) { this.handler = handler; return this; }
    click() { return this.handler?.(); }
}

export class DropdownComponent {
    constructor(parent) {
        this.selectEl = parent.createEl('select');
        parent.components.push(this);
    }

    addOption(value, label) {
        this.options ??= [];
        this.options.push([value, label]);
        return this;
    }

    setValue(value) { this.value = value; return this; }
    getValue() { return this.value; }
    onChange(handler) { this.handler = handler; return this; }
    change(value) {
        this.value = value;
        this.handler?.(value);
    }
}

class InputComponent {
    constructor(parent, tag) {
        this.inputEl = parent.createEl(tag);
    }

    setPlaceholder(value) { this.placeholder = value; return this; }
    setValue(value) { this.inputEl.value = value; return this; }
    getValue() { return this.inputEl.value; }
    onChange(handler) { this.handler = handler; return this; }
    edit(value) {
        this.setValue(value);
        this.handler?.(value);
    }
}

export class TextComponent extends InputComponent {
    constructor(parent) { super(parent, 'input'); }
}

export class TextAreaComponent extends InputComponent {
    constructor(parent) { super(parent, 'textarea'); }
}

export class Setting {
    constructor(parent = new FakeElement()) {
        this.settingEl = parent.createDiv();
        this.controlEl = this.settingEl.createDiv();
        this.texts = [];
        this.textAreas = [];
    }

    setName(value) { this.name = value; return this; }
    setDesc(value) { this.desc = value; return this; }

    addButton(callback) {
        callback(new ButtonComponent(this.controlEl));
        return this;
    }

    addText(callback) {
        const text = new TextComponent(this.controlEl);
        this.texts.push(text);
        callback(text);
        return this;
    }

    addTextArea(callback) {
        const area = new TextAreaComponent(this.controlEl);
        this.textAreas.push(area);
        callback(area);
        return this;
    }
}

export class PluginSettingTab {
    constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
    }
}

export function findComponents(element, Type) {
    const found = element.components.filter((component) => component instanceof Type);
    for (const child of element.children) {
        found.push(...findComponents(child, Type));
    }
    return found;
}

export function findButton(setting, label) {
    return findComponents(setting.settingEl, ButtonComponent)
        .find((button) => button.label === label);
}
