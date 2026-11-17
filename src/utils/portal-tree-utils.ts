import type { FileRecord } from "../core/file-interface";
import path from "node:path";
import { FilePilotError } from "../error";

export interface PortalTreeNode {
	name: string;
	path: string;
	kind: "file" | "folder";
	record: FileRecord | null;
	children: PortalTreeNode[];
}


export function buildPortalTree(
	records: readonly FileRecord[],
	rootName: string,
): PortalTreeNode {
	const root: PortalTreeNode = {
		name: rootName,
		path: "",
		kind: "folder",
		record: null,
		children: [],
	};

	// Locate previously created folder nodes.
	const folders = new Map<string, PortalTreeNode>();
	folders.set("", root);

	// Create missing folders along a relative path.
	function ensureFolder(segments: string[]): PortalTreeNode {
		let parent = root;
		let currentPath = "";

		for (const segment of segments) {
			currentPath = currentPath
				? `${currentPath}/${segment}`
				: segment;

			let folder = folders.get(currentPath);

			if (!folder) {
				folder = {
					name: segment,
					path: currentPath,
					kind: "folder",
					record: null,
					children: [],
				};

				parent.children.push(folder);
				folders.set(currentPath, folder);
			}

			parent = folder;
		}

		return parent;
	}

	for (const record of records) {
		const segments = record.path
			.split("/")
			.filter(Boolean);

		if (segments.length === 0) continue;

		if (record.kind === "folder") {
			const folder = ensureFolder(segments);
			folder.record = record;
		} else {
			const name = segments.pop();
			if (!name) continue;

			const parent = ensureFolder(segments);

			parent.children.push({
				name,
				path: record.path,
				kind: "file",
				record,
				children: [],
			});
		}
	}

	// Sort folders first, then files alphabetically.
	function sortChildren(node: PortalTreeNode): void {
		node.children.sort((a, b) => {
			if (a.kind !== b.kind) {
				return a.kind === "folder" ? -1 : 1;
			}

			return a.name.localeCompare(b.name);
		});

		for (const child of node.children) {
			sortChildren(child);
		}
	}

	sortChildren(root);

	return root;
}


export function renderPortalTree(
	tree: PortalTreeNode,
	formatReference: (id: string) => string | null,
): string {
	const lines: string[] = [
		/[\\/]$/.test(tree.name)
			? tree.name
			: `${tree.name}${path.sep}`,
	];

	function renderChildren(
		children: readonly PortalTreeNode[],
		prefix: string,
	): void {
		children.forEach((node, index) => {
			const isLast = index === children.length - 1;

			const branch = isLast ? "└── " : "├── ";

			let label: string;

			if (node.record !== null) {
				const reference = formatReference(node.record.id);

				if (reference === null) {
					throw new FilePilotError(
						"FILE_REFERENCE_NOT_FOUND",
						`Cannot format file reference: ${node.path}`,
					);
				}

				label = reference;
			} else {
				// An implicit folder has no FileRecord.
				label = node.kind === "folder"
					? `${node.name}${path.sep}`
					: node.name;
			}

			lines.push(`${prefix}${branch}${label}`);

			const nextPrefix = prefix + (
				isLast ? "    " : "│   "
			);

			renderChildren(node.children, nextPrefix);
		});
	}

	renderChildren(tree.children, "");

	return lines.join("\n");
}

