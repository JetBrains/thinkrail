import type { GitDiffScope, ReviewAnchor, ReviewComment } from "@thinkrail/contracts";
import type { ReviewThreadData } from "./reviewWidgets";

export type ReviewSurface = { kind: "file" } | { kind: "diff"; scope?: GitDiffScope };

export function commentSurface(comment: ReviewComment): ReviewSurface {
	const anchor = comment.anchor;
	if (anchor?.side !== "base") return { kind: "file" };
	if (anchor.baseRef) return { kind: "diff", scope: { kind: "pinned", baseRef: anchor.baseRef } };
	return { kind: "diff", ...(anchor.scope ? { scope: anchor.scope } : {}) };
}

export function reviewFileSurface(
	comments: ReviewComment[] | undefined,
	path: string,
): ReviewSurface {
	let base: ReviewSurface | null = null;
	for (const comment of comments ?? []) {
		if (comment.status !== "draft" && comment.status !== "sent") continue;
		if (comment.anchor?.path !== path) continue;
		const surface = commentSurface(comment);
		if (surface.kind === "file") return surface;
		base ??= surface;
	}
	return base ?? { kind: "file" };
}

export interface ReviewGroup {
	path: string | null;
	comments: ReviewComment[];
}

export function groupComments(comments: ReviewComment[]): ReviewGroup[] {
	const byPath = new Map<string | null, ReviewComment[]>();
	for (const comment of comments) {
		const key = comment.anchor?.path ?? null;
		const list = byPath.get(key);
		if (list) list.push(comment);
		else byPath.set(key, [comment]);
	}
	const paths = [...byPath.keys()].filter((p): p is string => p !== null).sort();
	const groups: ReviewGroup[] = [];
	const reviewLevel = byPath.get(null);
	if (reviewLevel) groups.push({ path: null, comments: reviewLevel });
	for (const path of paths) groups.push({ path, comments: byPath.get(path) ?? [] });
	return groups;
}

export function lineRef(comment: ReviewComment): string {
	const range = comment.anchor?.selectors.find((s) => s.kind === "lineRange");
	if (!range || !("startLine" in range)) return "";
	return range.startLine === range.endLine
		? `L${range.startLine}`
		: `L${range.startLine}–${range.endLine}`;
}

export function statusLabel(
	comment: Pick<ReviewComment, "status" | "anchorState" | "stale" | "reflection">,
): string {
	if (comment.status !== "resolved" && comment.status !== "dismissed") {
		if (comment.reflection?.verdict === "refuted") return `${comment.status} · refuted`;
		if (comment.stale) return `${comment.status} · stale`;
		if (comment.anchorState === "outdated") return `${comment.status} · outdated`;
	}
	return comment.status;
}

export function threadLabel(
	t: Pick<ReviewThreadData, "status" | "anchorState" | "stale" | "refuted">,
): string {
	if (t.refuted) return `${t.status} · refuted`;
	if (t.stale) return `${t.status} · stale`;
	if (t.anchorState === "outdated") return `${t.status} · outdated`;
	return t.status;
}

export type ReviewFlag = "draft" | "sent";

export function reviewFlags(comments: ReviewComment[] | undefined): Map<string, ReviewFlag> {
	const flags = new Map<string, ReviewFlag>();
	for (const comment of comments ?? []) {
		if (comment.status !== "draft" && comment.status !== "sent") continue;
		const path = comment.anchor?.path;
		if (!path) continue;
		if (comment.status === "draft" || !flags.has(path)) flags.set(path, comment.status);
	}
	return flags;
}

export function fileDraftIds(comments: ReviewComment[] | undefined, path: string | null): string[] {
	return (comments ?? [])
		.filter((c) => c.status === "draft" && (c.anchor?.path ?? null) === path)
		.map((c) => c.id);
}

export function allDraftIds(comments: ReviewComment[] | undefined): string[] {
	return (comments ?? []).filter((c) => c.status === "draft").map((c) => c.id);
}

export function reviewFlagFor(
	comments: ReviewComment[] | undefined,
	path: string,
): ReviewFlag | null {
	return reviewFlags(comments).get(path) ?? null;
}

export function fileThreads(
	comments: ReviewComment[] | undefined,
	path: string,
	side: ReviewAnchor["side"],
): ReviewThreadData[] {
	const threads: ReviewThreadData[] = [];
	for (const comment of comments ?? []) {
		if (comment.status !== "draft" && comment.status !== "sent") continue;
		const anchor = comment.anchor;
		if (!anchor || anchor.path !== path || anchor.side !== side) continue;
		const range = anchor.selectors.find((s) => s.kind === "lineRange");
		if (!range || !("startLine" in range)) continue;
		threads.push({
			id: comment.id,
			startLine: range.startLine,
			endLine: range.endLine,
			body: comment.body,
			status: comment.status,
			anchorState: comment.anchorState,
			...(comment.stale ? { stale: true } : {}),
			...(comment.reflection?.verdict === "refuted" ? { refuted: true } : {}),
		});
	}
	return threads.sort((a, b) => a.endLine - b.endLine);
}

export interface ReviewFileSummary {
	path: string | null;
	total: number;
	drafts: number;
	resolved: number;
}

export function fileSummaries(
	comments: ReviewComment[] | undefined,
	doneFiles?: string[],
): ReviewFileSummary[] {
	const byPath = new Map<string | null, { total: number; drafts: number; resolved: number }>();
	for (const comment of comments ?? []) {
		const key = comment.anchor?.path ?? null;
		const entry = byPath.get(key) ?? { total: 0, drafts: 0, resolved: 0 };
		if (comment.status === "draft" || comment.status === "sent") {
			entry.total += 1;
			if (comment.status === "draft") entry.drafts += 1;
		} else if (comment.status === "resolved") {
			entry.resolved += 1;
		} else {
			continue;
		}
		byPath.set(key, entry);
	}
	const done = new Set(doneFiles ?? []);
	const keep = (key: string | null, entry: { total: number }) =>
		entry.total > 0 || !done.has(key ?? "");
	const rows: ReviewFileSummary[] = [];
	const overall = byPath.get(null);
	if (overall && keep(null, overall)) rows.push({ path: null, ...overall });
	for (const path of [...byPath.keys()].filter((p): p is string => p !== null).sort()) {
		const entry = byPath.get(path) as Omit<ReviewFileSummary, "path">;
		if (keep(path, entry)) rows.push({ path, ...entry });
	}
	return rows;
}
