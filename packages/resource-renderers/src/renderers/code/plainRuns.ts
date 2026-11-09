import type { FileDiffMetadata } from "@pierre/diffs";

export type PlainRunKind = "hunk" | "context" | "deletion" | "addition";

export interface PlainRun {
	key: string;
	kind: PlainRunKind;
	lines: string[];
}

function lineText(line: string | undefined): string {
	return (line ?? "").replace(/\r?\n$/, "");
}

function sideRun(
	lines: readonly string[],
	start: number,
	count: number,
	kind: PlainRunKind,
): PlainRun[] {
	if (count === 0) return [];
	return [
		{
			key: `${kind}:${start}`,
			kind,
			lines: Array.from({ length: count }, (_, offset) => lineText(lines[start + offset])),
		},
	];
}

export function plainFileRuns(text: string): PlainRun[] {
	const lines = text.split(/\r?\n/);
	if (lines.length > 1 && lines.at(-1) === "") lines.pop();
	return [{ key: "file", kind: "context", lines }];
}

export function plainDiffRuns(diff: FileDiffMetadata): PlainRun[] {
	return diff.hunks.flatMap((hunk, hunkIndex) => [
		{
			key: `hunk:${hunkIndex}`,
			kind: "hunk" as const,
			lines: [
				`@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`,
			],
		},
		...hunk.hunkContent.flatMap((block) =>
			block.type === "context"
				? sideRun(diff.additionLines, block.additionLineIndex, block.lines, "context")
				: [
						...sideRun(diff.deletionLines, block.deletionLineIndex, block.deletions, "deletion"),
						...sideRun(diff.additionLines, block.additionLineIndex, block.additions, "addition"),
					],
		),
	]);
}
