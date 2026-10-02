export type DiagramFamily = "flowchart" | "state" | "sequence" | "class" | "er" | "xychart";

const HEADERS: ReadonlyArray<readonly [RegExp, DiagramFamily]> = [
	[/^(?:flowchart|graph)\b/i, "flowchart"],
	[/^stateDiagram(?:-v2)?\b/i, "state"],
	[/^sequenceDiagram\b/i, "sequence"],
	[/^classDiagram\b/i, "class"],
	[/^erDiagram\b/i, "er"],
	[/^xychart(?:-beta)?\b/i, "xychart"],
];

function headerLine(source: string): string {
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("%%")) continue;
		return line;
	}
	return "";
}

export function diagramFamily(source: string): DiagramFamily | undefined {
	const header = headerLine(source);
	for (const [pattern, family] of HEADERS) {
		if (pattern.test(header)) return family;
	}
	return undefined;
}
