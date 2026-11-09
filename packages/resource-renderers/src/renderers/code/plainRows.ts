import type { FileDiffMetadata } from "@pierre/diffs";

export type PlainRowKind = "hunk" | "context" | "deletion" | "addition";

export interface PlainRow {
	key: string;
	kind: PlainRowKind;
	text: string;
}

function lineText(line: string | undefined): string {
	return (line ?? "").replace(/\r?\n$/, "");
}

function sideRows(
	lines: readonly string[],
	start: number,
	count: number,
	kind: PlainRowKind,
): PlainRow[] {
	return Array.from({ length: count }, (_, offset) => ({
		key: `${kind}:${start + offset}`,
		kind,
		text: lineText(lines[start + offset]),
	}));
}

export function plainFileRows(text: string): PlainRow[] {
	const lines = text.split(/\r?\n/);
	if (lines.length > 1 && lines.at(-1) === "") lines.pop();
	return lines.map((line, index) => ({ key: `line:${index}`, kind: "context", text: line }));
}

export function plainDiffRows(diff: FileDiffMetadata): PlainRow[] {
	return diff.hunks.flatMap((hunk, hunkIndex) => [
		{
			key: `hunk:${hunkIndex}`,
			kind: "hunk" as const,
			text: `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`,
		},
		...hunk.hunkContent.flatMap((block) =>
			block.type === "context"
				? sideRows(diff.additionLines, block.additionLineIndex, block.lines, "context")
				: [
						...sideRows(diff.deletionLines, block.deletionLineIndex, block.deletions, "deletion"),
						...sideRows(diff.additionLines, block.additionLineIndex, block.additions, "addition"),
					],
		),
	]);
}
