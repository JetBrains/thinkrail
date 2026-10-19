import type { ResourceContent } from "@thinkrail/resource-renderers";
import { diffArrays } from "diff";

export const LARGE_DIFF_CHANGED_LINES = 2000;
export const VIRTUALIZED_DIFF_LINES = 1000;

const splitLines = (text: string) => (text === "" ? [] : text.split("\n"));

export function estimateChangedLines(original: string, modified: string): number {
	const remaining = new Map<string, number>();
	for (const line of splitLines(original)) remaining.set(line, (remaining.get(line) ?? 0) + 1);
	let changed = 0;
	for (const line of splitLines(modified)) {
		const count = remaining.get(line) ?? 0;
		if (count > 0) remaining.set(line, count - 1);
		else changed += 1;
	}
	for (const count of remaining.values()) changed += count;
	return changed;
}

export function surfaceChangedLines(original: ResourceContent, modified: ResourceContent): number {
	if (original.kind === "bytes" || modified.kind === "bytes") return 0;
	return estimateChangedLines(
		original.kind === "text" ? original.text : "",
		modified.kind === "text" ? modified.text : "",
	);
}

export function surfaceLineCount(original: ResourceContent, modified: ResourceContent): number {
	const count = (content: ResourceContent) =>
		content.kind === "text"
			? splitLines(content.text).length - (content.text.endsWith("\n") ? 1 : 0)
			: 0;
	return Math.max(count(original), count(modified));
}

export function isDiffTooExpensive(original: ResourceContent, modified: ResourceContent): boolean {
	if (original.kind !== "text" || modified.kind !== "text") return false;
	if (original.text === "" || modified.text === "") return false;
	if (surfaceChangedLines(original, modified) > LARGE_DIFF_CHANGED_LINES) return true;
	const diff = diffArrays(splitLines(original.text), splitLines(modified.text), {
		maxEditLength: LARGE_DIFF_CHANGED_LINES,
		timeout: 50,
	});
	return diff === undefined;
}
