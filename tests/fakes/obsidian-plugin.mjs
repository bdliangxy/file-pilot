export { getLanguage } from './obsidian.mjs';
export { Notice, Setting, setIcon, ItemView, WorkspaceLeaf } from './obsidian-view.mjs';
export {
    PluginSettingTab,
    ButtonComponent,
    DropdownComponent,
    TextAreaComponent,
    TextComponent,
} from './obsidian-settings.mjs';
export { Component, TFile, TFolder } from './obsidian-watcher.mjs';

export class App {}

import { StateEffect, StateField } from '@codemirror/state';

// A real StateField lets editor transaction tests exercise Live Preview mode.
export const setLivePreviewMode = StateEffect.define();
export const editorLivePreviewField = StateField.define({
    create: () => true,
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setLivePreviewMode)) return effect.value;
        }
        return value;
    },
});

export class Plugin {
    constructor(app) {
        this.app = app;
        this.children = [];
        this.registeredViews = [];
    }

    async loadData() {
        return structuredClone(this.testStoredData);
    }

    async saveData(data) {
        this.testStoredData = structuredClone(data);
    }

    addChild(child) {
        this.children.push(child);
        child.onload?.();
    }

    addSettingTab(tab) {
        this.settingTab = tab;
    }

    registerView(type, factory) {
        this.registeredViews.push({ type, factory });
    }

    registerMarkdownPostProcessor(callback) {
        this.markdownPostProcessor = callback;
    }

    registerEditorExtension(extension) {
        this.editorExtension = extension;
    }

    registerHoverLinkSource(id, info) {
        this.hoverLinkSource = { id, info };
    }

    addRibbonIcon() {}
}
