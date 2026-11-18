import type {
	MatchRange,
	SearchGroup,
	SearchGroupState,
	SearchHit,
	SearchKind,
} from "@thinkrail/contracts";

export interface Deadline {
	readonly expired: () => boolean;
}

export function deadlineAt(endMs: number, now: () => number = performance.now): Deadline {
	return { expired: () => now() >= endMs };
}

export function compareHits(a: SearchHit, b: SearchHit): number {
	return a.tier - b.tier || b.score - a.score;
}

export interface GroupOutcome {
	readonly state?: SearchGroupState;
	readonly timeCut?: boolean;
	readonly fileList?: number;
}

export function groupOf(
	kind: SearchKind,
	hits: SearchHit[],
	total: number,
	{ state = "ready", timeCut = false, fileList }: GroupOutcome = {},
): SearchGroup {
	const cut = {
		...(timeCut ? { time: true as const } : {}),
		...(fileList === undefined ? {} : { fileList }),
	};
	return { kind, hits, total, state, ...(timeCut || fileList !== undefined ? { cut } : {}) };
}

export function buildGroup(
	kind: SearchKind,
	hits: SearchHit[],
	limit: number,
	outcome: GroupOutcome = {},
): SearchGroup {
	hits.sort(compareHits);
	return groupOf(kind, hits.slice(0, limit), hits.length, outcome);
}

export function emptyGroup(kind: SearchKind, state: SearchGroupState = "ready"): SearchGroup {
	return { kind, hits: [], total: 0, state };
}

const SNIPPET_RADIUS = 70;

function ellipsized(text: string, start: number, end: number): string {
	return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function snippetAround(text: string, [from, to]: MatchRange): string {
	return ellipsized(
		text,
		Math.max(0, from - SNIPPET_RADIUS),
		Math.min(text.length, to + SNIPPET_RADIUS),
	);
}

export function compactWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
