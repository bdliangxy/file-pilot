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

    registerHoverLinkSource(id, info) {
        this.hoverLinkSource = { id, info };
    }

    addRibbonIcon() {}
}
