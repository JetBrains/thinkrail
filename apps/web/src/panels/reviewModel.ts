// Pure view-model helpers for the Review sidebar (no store/transport — unit-testable, the
// `changesModel.ts` pattern): grouping, fragment previews, and the status-dot vocabulary.

import type { GitDiffScope, ReviewAnchor, ReviewComment } from "@thinkrail/contracts";
import type { ReviewThreadData } from "./reviewWidgets";

/**
 * Which center surface a review comment is READABLE on — the sidebar's navigation target.
 *
 * Not a cosmetic choice: a `base` anchor's lines index the pre-change blob, which only the diff's
 * ORIGINAL editor renders (and which is the only surface that mounts `base` threads). Sending one to
 * the plain file tab lands on worktree lines that say something else, with no card to focus and a focus
 * request nothing ever consumes. `scope` is the diff identity the anchor captured; absent on comments
 * saved before it was persisted, and the caller falls back to the workspace's current scope.
 */
export type ReviewSurface = { kind: "file" } | { kind: "diff"; scope?: GitDiffScope };

/** The surface ONE comment lives on. A base-side anchor reopens as a **pinned** diff — worktree vs
 * the anchor's own `baseRef` (frozen at creation) — never the scope it was captured in: a
 * branch/uncommitted scope re-resolves against the current fork point/`HEAD`, which moves out from
 * under the comment when the worktree commits or the review target is re-pointed, mounting the card
 * on a different blob at stale line numbers. The captured `scope` remains the fallback for comments
 * saved before `baseRef` was stamped. */
export function commentSurface(comment: ReviewComment): ReviewSurface {
	const anchor = comment.anchor;
	if (anchor?.side !== "base") return { kind: "file" };
	if (anchor.baseRef) return { kind: "diff", scope: { kind: "pinned", baseRef: anchor.baseRef } };
	return { kind: "diff", ...(anchor.scope ? { scope: anchor.scope } : {}) };
}

/**
 * The surface a FILE's row should open: the file whenever any unresolved comment is pinned to the
 * worktree side (that's where those cards render), and the diff only when every one of them is
 * base-side — a file reviewed purely on its pre-change content.
 */
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

/** One sidebar group: the review-level comments (`path: null`, always first), then one per file. */
export interface ReviewGroup {
	path: string | null;
	comments: ReviewComment[];
}

/** Group comments for the sidebar: review-level first, then files alphabetically; a group's comments
 * keep creation order. */
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

/** The compact line reference for a row's meta ("L3" / "L3–5"; "" for file/review-level). */
export function lineRef(comment: ReviewComment): string {
	const range = comment.anchor?.selectors.find((s) => s.kind === "lineRange");
	if (!range || !("startLine" in range)) return "";
	return range.startLine === range.endLine
		? `L${range.startLine}`
		: `L${range.startLine}–${range.endLine}`;
}

/** The human word next to the dot (also the row's `data-status`). */
export function statusLabel(comment: Pick<ReviewComment, "status" | "anchorState">): string {
	if (comment.status !== "resolved" && comment.status !== "dismissed") {
		if (comment.anchorState === "outdated") return `${comment.status} · outdated`;
	}
	return comment.status;
}

/** How loudly a file still in review says so: `draft` — something here is UNSENT (actionable: the
 * violet tab flag + `Send review`); `sent` — the chat is working on it (a quiet marker only). */
export type ReviewFlag = "draft" | "sent";

/**
 * The files still in review, each with its {@link ReviewFlag} — `draft` winning for a file holding
 * both. Resolved/dismissed comments drop out: those files are done.
 *
 * ONE derivation behind every "is this file in review" surface (the tab flag, the pane toolbar's
 * `Send review`), and deliberately draft-*or*-sent, matching what the rest of the review vocabulary
 * already counts (`fileSummaries`, `selectActiveReviewedPath`, `fileThreads`). Drafts-only marking
 * made a file whose review was in progress look identical in the tab strip to one never reviewed,
 * while the rail insisted it was in review.
 */
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

/** One file's pending draft ids — what its "Send review (N)" button counts and sends: the review chat
 * is per file, so the action covers exactly this file's drafts, never another's. `null` keys the
 * anchorless whole-change-set bucket (the Review panel's accordion shows it like any file). */
export function fileDraftIds(comments: ReviewComment[] | undefined, path: string | null): string[] {
	return (comments ?? [])
		.filter((c) => c.status === "draft" && (c.anchor?.path ?? null) === path)
		.map((c) => c.id);
}

/** Every pending draft id in the review — what the files-level "Send all (N)" counts; the send itself
 * omits ids (`review.sendBatch` with none = all drafts), so count and action can't drift. */
export function allDraftIds(comments: ReviewComment[] | undefined): string[] {
	return (comments ?? []).filter((c) => c.status === "draft").map((c) => c.id);
}

/** One file's review marker (`null` = not in review) — the per-file read of {@link reviewFlags}. */
export function reviewFlagFor(
	comments: ReviewComment[] | undefined,
	path: string,
): ReviewFlag | null {
	return reviewFlags(comments).get(path) ?? null;
}

/** One file's inline thread cards for ONE anchor side: the unresolved comments pinned to that side with
 * a line range — what `reviewWidgets.attachReviewThreads` renders under the anchor lines, sorted by
 * position. Per-side because the two diff editors are two line spaces: a `base` comment's lines index
 * the pre-change blob, so rendering it on the worktree side would point it at unrelated code. */
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
		});
	}
	return threads.sort((a, b) => a.endLine - b.endLine);
}

/** One row of the Review panel's FILES level: a file (or the anchorless "whole change set" bucket,
 * `path: null`) that still carries unresolved comments, with its counts. */
export interface ReviewFileSummary {
	path: string | null;
	/** Unresolved (draft + sent) comments. `0` = the file is finishable (the Done button's gate). */
	total: number;
	drafts: number;
	resolved: number;
}

/** The files "in review": holding unresolved comments, or fully resolved but not yet marked done — a
 * finished file leaves the list only when the user says so (`Review.doneFiles`, the Done button).
 * Whole-change-set bucket first. */
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
			continue; // dismissed: neither open nor a reason to keep the file listed
		}
		byPath.set(key, entry);
	}
	// A file whose comments are ALL resolved stays until marked done ("" keys the anchorless bucket).
	const done = new Set(doneFiles ?? []);
	const keep = (key: string | null, entry: { total: number }) =>
		entry.total > 0 || !done.has(key ?? "");
	const rows: ReviewFileSummary[] = [];
	const overall = byPath.get(null);
	if (overall && keep(null, overall)) rows.push({ path: null, ...overall });
	for (const path of [...byPath.keys()].filter((p): p is string => p !== null).sort()) {
		const entry = byPath.get(path) as { total: number; drafts: number; resolved: number };
		if (keep(path, entry)) rows.push({ path, ...entry });
	}
	return rows;
}
