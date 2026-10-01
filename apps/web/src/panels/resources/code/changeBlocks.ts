import type { LineSpan } from "@thinkrail/contracts";
import { structuredPatch } from "diff";
import type { AnchorDraft } from "@/resources";

export interface ChangeBlock {
	original: LineSpan;
	modified: LineSpan;
}

export interface AskAgentRequest {
	draft: AnchorDraft;
	initialText: string;
	notice?: string;
}

export function computeChangeBlocks(
	original: string,
	modified: string,
	ignoreWhitespace: boolean,
): ChangeBlock[] {
	const patch = structuredPatch("original", "modified", original, modified, undefined, undefined, {
		context: 0,
		ignoreWhitespace,
	});
	return patch.hunks.map((hunk) => ({
		original: { start: Math.max(1, hunk.oldStart), count: hunk.oldLines },
		modified: { start: Math.max(1, hunk.newStart), count: hunk.newLines },
	}));
}

export function computeActionBlocks(
	original: string | null,
	modified: string | null,
	ignoreWhitespace: boolean,
): ChangeBlock[] {
	return modified === null ? [] : computeChangeBlocks(original ?? "", modified, ignoreWhitespace);
}

export function changeBlockId(block: ChangeBlock): string {
	return `${block.original.start}:${block.original.count}:${block.modified.start}:${block.modified.count}`;
}

export function createAskAgentRequest(block: ChangeBlock, modifiedText: string): AskAgentRequest {
	const lineCount = textLineCount(modifiedText);
	const nearestLine = Math.min(lineCount, Math.max(1, block.modified.start - 1));
	const lineRange =
		block.modified.count > 0
			? {
					kind: "lineRange" as const,
					startLine: block.modified.start,
					endLine: block.modified.start + block.modified.count - 1,
				}
			: lineCount > 0
				? {
						kind: "lineRange" as const,
						startLine: nearestLine,
						endLine: nearestLine,
					}
				: null;
	const hunk = {
		kind: "diffHunk" as const,
		hunkHeader: `@@ -${block.original.start},${block.original.count} +${block.modified.start},${block.modified.count} @@`,
	};
	return {
		draft: {
			selectors: lineRange ? [lineRange, hunk] : [hunk],
			label: lineRange
				? lineRange.startLine === lineRange.endLine
					? `L${lineRange.startLine}`
					: `L${lineRange.startLine}–${lineRange.endLine}`
				: "file",
		},
		initialText: "Please revise this change: ",
		...(block.modified.count === 0 ? { notice: "This comment refers to removed lines." } : {}),
	};
}

function textLineCount(text: string): number {
	if (text.length === 0) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}
