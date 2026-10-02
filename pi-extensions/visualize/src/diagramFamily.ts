export type DiagramFamily = "flowchart" | "state" | "sequence" | "class" | "er" | "xychart";

const HEADERS: ReadonlyArray<readonly [RegExp, DiagramFamily]> = [
	[/^(?:flowchart|graph)\b/i, "flowchart"],
	[/^stateDiagram(?:-v2)?\b/i, "state"],
	[/^sequenceDiagram\b/i, "sequence"],
	[/^classDiagram\b/i, "class"],
	[/^erDiagram\b/i, "er"],
	[/^xychart(?:-beta)?\b/i, "xychart"],
];

function isPreamble(line: string): boolean {
	const trimmed = line.trim();
	return trimmed === "" || trimmed.startsWith("%%");
}

export function withoutPreamble(source: string): string {
	const lines = source.split("\n");
	let start = 0;
	while (start < lines.length && isPreamble(lines[start] as string)) start += 1;
	return lines.slice(start).join("\n");
}

export function diagramFamily(source: string): DiagramFamily | undefined {
	const header = withoutPreamble(source).split("\n")[0]?.trim() ?? "";
	for (const [pattern, family] of HEADERS) {
		if (pattern.test(header)) return family;
	}
	return undefined;
}
