import type { SearchGroup, SearchGroupState, SearchHit, SearchKind } from "@thinkrail/contracts";

export interface Deadline {
	readonly expired: () => boolean;
}

export function deadlineAt(endMs: number, now: () => number = performance.now): Deadline {
	return { expired: () => now() >= endMs };
}

export function compareHits(a: SearchHit, b: SearchHit): number {
	return a.tier - b.tier || b.score - a.score || (b.timestamp ?? 0) - (a.timestamp ?? 0);
}

export function buildGroup(
	kind: SearchKind,
	hits: SearchHit[],
	limit: number,
	state: SearchGroupState = "ready",
): SearchGroup {
	hits.sort(compareHits);
	return { kind, hits: hits.slice(0, limit), total: hits.length, state };
}

export function emptyGroup(kind: SearchKind, state: SearchGroupState = "ready"): SearchGroup {
	return { kind, hits: [], total: 0, state };
}

export function termRanges(text: string, terms: readonly string[]): [number, number][] {
	const lower = text.toLowerCase();
	const ranges: [number, number][] = [];
	for (const term of terms) {
		const needle = term.toLowerCase();
		if (!needle) continue;
		const index = lower.indexOf(needle);
		if (index !== -1) ranges.push([index, index + needle.length]);
	}
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const [start, end] of ranges) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

export function lineSnippet(content: string, terms: readonly string[], radius = 70): string | null {
	const lower = content.toLowerCase();
	const first = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((at) => at !== -1);
	if (first.length === 0) return null;
	const at = Math.min(...first);
	const lineStart = content.lastIndexOf("\n", at) + 1;
	const lineEnd = content.indexOf("\n", at);
	const line = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd).trim();
	if (line.length <= radius * 2) return line;
	const local = at - lineStart;
	const start = Math.max(0, local - radius);
	const end = Math.min(line.length, local + radius);
	return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

export function compactWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
