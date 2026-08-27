import { expect, test } from "bun:test";
import type { ReviewComment } from "@thinkrail/contracts";
import {
	allDraftIds,
	commentSurface,
	fileDraftIds,
	fileSummaries,
	fileThreads,
	groupComments,
	lineRef,
	reviewFileSurface,
	reviewFlags,
	statusLabel,
} from "./reviewModel";

function comment(over: Partial<ReviewComment>): ReviewComment {
	return {
		id: "rc_1",
		reviewId: "rev_1",
		kind: "inline",
		anchor: {
			path: "src/a.ts",
			side: "worktree",
			selectors: [
				{ kind: "lineRange", startLine: 3, endLine: 5 },
				{ kind: "textQuote", exact: "const x = 1;\nmore", prefix: "", suffix: "" },
			],
		},
		body: "note",
		status: "draft",
		anchorState: "anchored",
		createdAt: 0,
		...over,
	};
}

test("draft ids: per-file counts only that file's drafts (null keys the anchorless bucket); allDraftIds spans every file", () => {
	const comments = [
		comment({ id: "a1" }),
		comment({ id: "a2", status: "sent" }),
		comment({ id: "b1", anchor: { path: "src/b.ts", side: "worktree", selectors: [] } }),
		comment({ id: "r1", kind: "review", anchor: null }),
		comment({ id: "a3", status: "resolved" }),
	];
	expect(fileDraftIds(comments, "src/a.ts")).toEqual(["a1"]);
	expect(fileDraftIds(comments, "src/b.ts")).toEqual(["b1"]);
	expect(fileDraftIds(comments, null)).toEqual(["r1"]);
	expect(allDraftIds(comments)).toEqual(["a1", "b1", "r1"]);
	expect(allDraftIds(undefined)).toEqual([]);
});

test("agent comments ride the same lifecycle as the user's — drafts join the batch, badged only by author", () => {
	const agentDraft = comment({ id: "f1", author: "agent" });
	const agentSent = comment({ id: "f2", author: "agent", status: "sent" });
	const agentResolved = comment({ id: "f3", author: "agent", status: "resolved" });
	const userDraft = comment({ id: "u1" });
	expect(fileDraftIds([agentDraft, userDraft], "src/a.ts")).toEqual(["f1", "u1"]);
	expect(allDraftIds([agentDraft, agentSent, userDraft])).toEqual(["f1", "u1"]);
	expect(fileSummaries([agentDraft, agentSent, agentResolved, userDraft])).toEqual([
		{ path: "src/a.ts", total: 3, drafts: 2, resolved: 1 },
	]);
});

test("groupComments: review-level first, then files alphabetically, creation order kept", () => {
	const groups = groupComments([
		comment({ id: "c1", anchor: { path: "z.ts", side: "worktree", selectors: [] } }),
		comment({ id: "c2", kind: "review", anchor: null }),
		comment({ id: "c3", anchor: { path: "a.ts", side: "worktree", selectors: [] } }),
		comment({ id: "c4", anchor: { path: "z.ts", side: "worktree", selectors: [] } }),
	]);
	expect(groups.map((g) => g.path)).toEqual([null, "a.ts", "z.ts"]);
	expect(groups[2]?.comments.map((c) => c.id)).toEqual(["c1", "c4"]);
});

test("lineRef: the compact line reference; empty for review-level", () => {
	expect(lineRef(comment({}))).toBe("L3–5");
	expect(lineRef(comment({ kind: "review", anchor: null }))).toBe("");
});

test("reviewFlags: a file in review is flagged whether its comments are unsent or already sent", () => {
	const at = (path: string, over: Partial<ReviewComment>) =>
		comment({ anchor: { path, side: "worktree", selectors: [] }, ...over });
	const flags = reviewFlags([
		at("draft.ts", { status: "draft" }),
		at("sent.ts", { status: "sent" }),
		at("both.ts", { status: "sent" }),
		at("both.ts", { status: "draft" }),
		at("also-both.ts", { status: "draft" }),
		at("also-both.ts", { status: "sent" }),
		at("done.ts", { status: "resolved" }),
		at("dropped.ts", { status: "dismissed" }),
		comment({ kind: "review", anchor: null, status: "draft" }),
	]);
	expect(Object.fromEntries(flags)).toEqual({
		"draft.ts": "draft",
		"sent.ts": "sent",
		"both.ts": "draft",
		"also-both.ts": "draft",
	});
});

test("fileThreads keeps the two diff sides apart — each editor renders only its own anchors", () => {
	const comments = [
		comment({ id: "w1" }),
		comment({
			id: "b1",
			anchor: {
				path: "src/a.ts",
				side: "base",
				baseRef: "deadbee",
				selectors: [{ kind: "lineRange", startLine: 9, endLine: 9 }],
			},
		}),
	];
	expect(fileThreads(comments, "src/a.ts", "worktree").map((t) => t.id)).toEqual(["w1"]);
	expect(fileThreads(comments, "src/a.ts", "base").map((t) => [t.id, t.startLine])).toEqual([
		["b1", 9],
	]);
});

test("status vocabulary: outdated rides draft/sent labels but never resolved", () => {
	expect(statusLabel(comment({ status: "sent", anchorState: "outdated" }))).toBe("sent · outdated");
	expect(statusLabel(comment({ status: "resolved", anchorState: "outdated" }))).toBe("resolved");
});

test("a base-side comment navigates to a PINNED diff on its own baseRef, a worktree one to the file", () => {
	const base = comment({
		id: "cb",
		anchor: {
			path: "a.ts",
			side: "base",
			baseRef: "abc123",
			scope: { kind: "branch" },
			selectors: [{ kind: "lineRange", startLine: 2, endLine: 2 }],
		},
	});
	expect(commentSurface(base)).toEqual({
		kind: "diff",
		scope: { kind: "pinned", baseRef: "abc123" },
	});
	expect(
		commentSurface(
			comment({
				anchor: { path: "a.ts", side: "base", scope: { kind: "uncommitted" }, selectors: [] },
			}),
		),
	).toEqual({ kind: "diff", scope: { kind: "uncommitted" } });
	expect(
		commentSurface(comment({ anchor: { path: "a.ts", side: "base", selectors: [] } })),
	).toEqual({ kind: "diff" });
	expect(commentSurface(comment({}))).toEqual({ kind: "file" });
	expect(commentSurface(comment({ kind: "review", anchor: null }))).toEqual({ kind: "file" });
});

test("a file row opens the diff only when EVERY unresolved comment on it is base-side", () => {
	const base = comment({
		id: "cb",
		anchor: { path: "a.ts", side: "base", scope: { kind: "branch" }, selectors: [] },
	});
	const worktree = comment({ id: "cw", anchor: { path: "a.ts", side: "worktree", selectors: [] } });
	expect(reviewFileSurface([base], "a.ts")).toEqual({ kind: "diff", scope: { kind: "branch" } });
	expect(reviewFileSurface([base, worktree], "a.ts")).toEqual({ kind: "file" });
	expect(reviewFileSurface([comment({ ...base, status: "resolved" })], "a.ts")).toEqual({
		kind: "file",
	});
	expect(reviewFileSurface([base], "other.ts")).toEqual({ kind: "file" });
});

test("fileSummaries: a fully-resolved file stays listed until marked done; a new comment re-lists it", () => {
	const open = comment({ id: "rc_1", status: "sent" });
	const closed = comment({ id: "rc_2", status: "resolved" });
	expect(fileSummaries([open, closed], ["src/a.ts"])).toEqual([
		{ path: "src/a.ts", total: 1, drafts: 0, resolved: 1 },
	]);
	expect(fileSummaries([closed])).toEqual([{ path: "src/a.ts", total: 0, drafts: 0, resolved: 1 }]);
	expect(fileSummaries([closed], ["src/a.ts"])).toEqual([]);
	const overall = comment({ id: "rc_3", kind: "review", anchor: null, status: "resolved" });
	expect(fileSummaries([overall], [""])).toEqual([]);
	expect(fileSummaries([overall])).toEqual([{ path: null, total: 0, drafts: 0, resolved: 1 }]);
});
