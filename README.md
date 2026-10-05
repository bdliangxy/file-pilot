# File Pilot

This project is an Obsidian-based file management plugin **currently under development**.

Core function:

- One real file corresponds to one Obsidian note (Shadow Note).
- The Shadow Note stores metadata, tags, properties, notes, and relationships for the real file.
- Real files may live outside the Obsidian vault and continue to be edited by their original applications.
- Obsidian acts as the semantic management layer for classification, search, relationships, and organization.
- The project aims to separate a file's physical storage location from its semantic classification as much as practical.

## How to use

- Clone this repo.
- Make sure your NodeJS is Node.js 20 or later (`node --version`).
- `npm i` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.
