
interface TreeFence {
	marker: string;
	isTree: boolean;
}

type ReadLine = (index: number) => string;

// Collect zero-based line numbers inside File Pilot tree fences.
export function getFilePilotTreeBodyLines(
	lineCount: number,
	readLine: ReadLine,
): ReadonlySet<number> {
	const bodyLines = new Set<number>();
	let fence: TreeFence | null = null;

	for (let number = 0; number < lineCount; number++) {
		const text = readLine(number);

		if (fence !== null) {
			const closing =
				/^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);

			const marker = closing?.[1];

			if (
				marker !== undefined &&
				marker[0] === fence.marker[0] &&
				marker.length >= fence.marker.length
			) {
				fence = null;
				continue;
			}

			if (fence.isTree) {
				bodyLines.add(number);
			}

			continue;
		}

		const opening =
			/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);

		const marker = opening?.[1];

		if (marker === undefined) {
			continue;
		}

		const info = opening?.[2] ?? "";

		// Backtick fences cannot contain backticks in the info string.
		if (marker[0] === "`" && info.includes("`")) {
			continue;
		}

		const language = info.trim().split(/\s+/)[0];

		fence = {
			marker,
			isTree: language === "file-pilot-tree",
		};
	}

	return bodyLines;
}

// Check one zero-based line without scanning subsequent lines.
export function isFilePilotTreeBodyLine(
	lineNumber: number,
	readLine: ReadLine,
): boolean {
	if (lineNumber < 0) {
		return false;
	}

	return getFilePilotTreeBodyLines(
		lineNumber + 1,
		readLine,
	).has(lineNumber);
}
