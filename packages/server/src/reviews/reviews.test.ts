import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewChangedPayload, Workspace } from "@thinkrail/contracts";
import { saveWorkspaces } from "../persistence";
import {
	addComment,
	buildSendPackage,
	closeReview,
	deleteComment,
	fileReviewSession,
	getReviewSnapshot,
	markCommentsSent,
	markFileDone,
	REVIEW_LEVEL_KEY,
	reanchorWorkspace,
	removeWorkspaceReviews,
	resolveCommentFromAgent,
	reviewSessionKey,
	rollbackSend,
	sendableComments,
	setReviewPublisher,
	updateComment,
} from "./reviews";

let dataDir: string;
let worktree: string;
let pushes: ReviewChangedPayload[];
const WS_ID = "ws-review-test";

function gitIn(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "reviews-data-"));
	worktree = mkdtempSync(join(tmpdir(), "reviews-wt-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	// A tiny real repo: the store resolves the review's baseSha via `git rev-parse <baseBranch>`.
	gitIn(worktree, ["init", "-b", "main"]);
	gitIn(worktree, [
		"-c",
		"user.email=t@t",
		"-c",
		"user.name=t",
		"commit",
		"--allow-empty",
		"-m",
		"init",
	]);
	writeFileSync(join(worktree, "a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
	const ws: Workspace = {
		id: WS_ID,
		projectId: "p1",
		name: "test",
		branch: "main",
		baseBranch: "main",
		worktreePath: worktree,
		createdAt: 0,
	} as Workspace;
	saveWorkspaces([ws]);
	pushes = [];
	setReviewPublisher((payload) => pushes.push(payload));
});

afterEach(() => {
	setReviewPublisher(() => {});
	delete process.env.THINKRAIL_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(worktree, { recursive: true, force: true });
});

/** Commit `path` on the review's base branch, then leave the worktree copy holding `after` — so the
 * diff's two sides genuinely say different things at the same line numbers. */
function commitThenEdit(path: string, committed: string, after: string): void {
	writeFileSync(join(worktree, path), committed);
	gitIn(worktree, ["add", path]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", `add ${path}`]);
	writeFileSync(join(worktree, path), after);
}

function addBase(path: string, startLine: number, body: string) {
	return addComment({
		workspaceId: WS_ID,
		kind: "diff",
		anchor: {
			path,
			side: "base",
			selectors: [{ kind: "lineRange", startLine, endLine: startLine }],
		},
		body,
	});
}

function addInline(body = "fix this") {
	return addComment({
		workspaceId: WS_ID,
		kind: "inline",
		anchor: {
			path: "a.ts",
			side: "worktree",
			selectors: [{ kind: "lineRange", startLine: 2, endLine: 2 }],
		},
		body,
	});
}

test("add fills contentHash + textQuote, publishes a full snapshot", () => {
	const comment = addInline();
	expect(comment.status).toBe("draft");
	expect(comment.anchor?.contentHash).toBeTruthy();
	expect(comment.anchor?.selectors.some((s) => s.kind === "textQuote")).toBe(true);
	expect(pushes.at(-1)?.comments).toHaveLength(1);
	expect(pushes.at(-1)?.workspaceId).toBe(WS_ID);
});

test("get re-anchors against the worktree: edit above → moved, fragment gone → outdated", () => {
	addInline();
	writeFileSync(
		join(worktree, "a.ts"),
		"// new header\nconst a = 1;\nconst b = 2;\nconst c = 3;\n",
	);
	let snapshot = getReviewSnapshot(WS_ID);
	expect(snapshot.comments[0]?.anchorState).toBe("moved");
	writeFileSync(join(worktree, "a.ts"), "const a = 1;\nconst c = 3;\n");
	snapshot = getReviewSnapshot(WS_ID);
	expect(snapshot.comments[0]?.anchorState).toBe("outdated");
	// The creation-time fragment survives for the sidebar/package.
	const quote = snapshot.comments[0]?.anchor?.selectors.find((s) => s.kind === "textQuote");
	expect(quote && "exact" in quote ? quote.exact : "").toBe("const b = 2;");
});

test("reanchorWorkspace publishes only when something moved", () => {
	addInline();
	const before = pushes.length;
	reanchorWorkspace(WS_ID);
	expect(pushes.length).toBe(before); // nothing changed → no push
	writeFileSync(join(worktree, "a.ts"), "// x\nconst a = 1;\nconst b = 2;\nconst c = 3;\n");
	reanchorWorkspace(WS_ID);
	expect(pushes.length).toBe(before + 1);
});

test("update edits drafts only; manual resolve stamps resolvedBy user; resolved is final", () => {
	const comment = addInline();
	updateComment({ workspaceId: WS_ID, id: comment.id, body: "better wording" });
	// The wire may only land the terminal manual outcomes — draft/sent belong to the send path
	// (markCommentsSent/rollbackSend), so a client can't un-send a comment and rewrite/delete it.
	expect(() => updateComment({ workspaceId: WS_ID, id: comment.id, status: "sent" })).toThrow(
		/resolved or dismissed/,
	);
	markCommentsSent(WS_ID, [comment.id], "sess1");
	expect(() => updateComment({ workspaceId: WS_ID, id: comment.id, body: "nope" })).toThrow();
	expect(() => updateComment({ workspaceId: WS_ID, id: comment.id, status: "draft" })).toThrow(
		/resolved or dismissed/,
	);
	const resolved = updateComment({ workspaceId: WS_ID, id: comment.id, status: "resolved" });
	expect(resolved.resolvedBy).toBe("user");
	// Resolved is final — like delete and rollback, undoing a review outcome isn't offered.
	expect(() => updateComment({ workspaceId: WS_ID, id: comment.id, status: "dismissed" })).toThrow(
		/final/,
	);
});

test("send lifecycle: sendable drafts → sent with session link; the file's chat is pinned and reused", () => {
	const c1 = addInline("one");
	const c2 = addInline("two");
	const drafts = sendableComments(WS_ID);
	expect(drafts.map((c) => c.id)).toEqual([c1.id, c2.id]);
	markCommentsSent(WS_ID, [c1.id, c2.id], "sess-file");
	const snapshot = getReviewSnapshot(WS_ID);
	// Both comments sit on a.ts — the file is pinned to the chat, so later sends follow up into it.
	expect(snapshot.review.fileSessions).toEqual({ "a.ts": "sess-file" });
	expect(fileReviewSession(WS_ID, "a.ts")).toBe("sess-file");
	expect(fileReviewSession(WS_ID, "other.ts")).toBeUndefined();
	expect(snapshot.comments.every((c) => c.status === "sent" && c.sessionId === "sess-file")).toBe(
		true,
	);
	expect(() => sendableComments(WS_ID)).toThrow("No draft comments");
});

test("rollbackSend undoes an optimistic markSent (pre-turn rejection) → drafts again, chat unpinned", () => {
	const c1 = addInline("one");
	const c2 = addInline("two");
	markCommentsSent(WS_ID, [c1.id, c2.id], "sess-file");
	expect(getReviewSnapshot(WS_ID).review.fileSessions).toEqual({ "a.ts": "sess-file" });
	rollbackSend(WS_ID, [c1.id, c2.id], "sess-file");
	const snapshot = getReviewSnapshot(WS_ID);
	expect(snapshot.comments.every((c) => c.status === "draft" && c.sessionId === undefined)).toBe(
		true,
	);
	expect(snapshot.comments.every((c) => c.sentAt === undefined)).toBe(true);
	// The chat spun up for the failed send no longer backs any comment → unpinned, so a retry is clean.
	expect(snapshot.review.fileSessions).toEqual({});
	expect(sendableComments(WS_ID).map((c) => c.id)).toEqual([c1.id, c2.id]);
});

test("rollbackSend keeps a reused chat's pin when another comment still backs it", () => {
	const first = addInline("delivered");
	markCommentsSent(WS_ID, [first.id], "sess-file");
	const second = addInline("failed follow-up");
	markCommentsSent(WS_ID, [second.id], "sess-file");
	rollbackSend(WS_ID, [second.id], "sess-file");
	const snapshot = getReviewSnapshot(WS_ID);
	expect(snapshot.comments.find((c) => c.id === first.id)?.status).toBe("sent");
	expect(snapshot.comments.find((c) => c.id === second.id)?.status).toBe("draft");
	// The first comment still lives in that chat, so the pin stays.
	expect(snapshot.review.fileSessions).toEqual({ "a.ts": "sess-file" });
});

test("rollbackSend is a no-op for a session that never sent these comments (fault after acceptance)", () => {
	const comment = addInline();
	markCommentsSent(WS_ID, [comment.id], "sess-file");
	const before = pushes.length;
	rollbackSend(WS_ID, [comment.id], "other-session");
	expect(pushes.length).toBe(before); // nothing matched → no push
	expect(getReviewSnapshot(WS_ID).comments[0]?.status).toBe("sent");
});

test("rollbackSend after close is a clean no-op — it never resurrects the closed review", () => {
	// The rollback fires DETACHED, so a close can land first; reading with `load` (not `ensureSnapshot`)
	// keeps it from writing a fresh empty open review over the closed one.
	const comment = addInline();
	markCommentsSent(WS_ID, [comment.id], "sess-file");
	closeReview(WS_ID);
	const before = pushes.length;
	rollbackSend(WS_ID, [comment.id], "sess-file");
	expect(pushes.length).toBe(before); // no read-through, no write, no push
	// On disk the review is still closed until the next touch starts a fresh one.
	const onDisk = JSON.parse(readFileSync(join(dataDir, "reviews", `${WS_ID}.json`), "utf8"));
	expect(onDisk.review.status).toBe("closed");
});

test("a review-level remark pins its own bucket chat, so a second one continues the discussion", () => {
	// The whole-change-set bucket is keyed like a file (`REVIEW_LEVEL_KEY`). Without a pin, every
	// anchorless remark opened a chat of its own — the one send that could never be followed up.
	const overall = addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "overall" });
	markCommentsSent(WS_ID, [overall.id], "sess-overall");
	expect(getReviewSnapshot(WS_ID).review.fileSessions).toEqual({
		[REVIEW_LEVEL_KEY]: "sess-overall",
	});
	expect(fileReviewSession(WS_ID, REVIEW_LEVEL_KEY)).toBe("sess-overall");
	expect(reviewSessionKey(overall)).toBe(REVIEW_LEVEL_KEY);
	expect(reviewSessionKey(addInline("pinned to its file"))).toBe("a.ts");
});

test("agent resolve: sent → resolved with note; unknown/duplicate fail loud", () => {
	const comment = addInline();
	expect(() => resolveCommentFromAgent(comment.id)).toThrow("not sent");
	markCommentsSent(WS_ID, [comment.id], "sess1");
	const resolved = resolveCommentFromAgent(comment.id, "renamed the constant");
	expect(resolved.resolvedBy).toBe("agent");
	expect(resolved.resolveNote).toBe("renamed the constant");
	expect(() => resolveCommentFromAgent(comment.id)).toThrow("already resolved");
	expect(() => resolveCommentFromAgent("rc_nope")).toThrow("Unknown review comment");
});

test("close archives; the next touch starts a fresh review", () => {
	const comment = addInline();
	closeReview(WS_ID);
	const fresh = getReviewSnapshot(WS_ID);
	expect(fresh.review.status).toBe("open");
	expect(fresh.comments).toHaveLength(0);
	expect(fresh.review.id).not.toBe(comment.reviewId);
});

test("delete is draft-only: an unsent remark goes, a sent one is a record", () => {
	const draft = addInline("scratch");
	deleteComment(WS_ID, draft.id);
	expect(getReviewSnapshot(WS_ID).comments).toHaveLength(0);
	const sent = addInline("kept");
	markCommentsSent(WS_ID, [sent.id], "sess1");
	expect(() => deleteComment(WS_ID, sent.id)).toThrow(/record/);
	expect(() => deleteComment(WS_ID, "rc_nope")).toThrow(/Unknown/);
});

test("purge removes the workspace's review state", () => {
	addInline();
	removeWorkspaceReviews(WS_ID);
	expect(getReviewSnapshot(WS_ID).comments).toHaveLength(0);
});

test("a path-segment workspace id is refused by every file touch — no traversal out of the reviews dir", () => {
	// The id becomes a filename: `../config` would resolve to the data dir's own config.json.
	for (const evil of ["../config", "a/b", "a\\b", "..", ".", "x.y"]) {
		expect(() => removeWorkspaceReviews(evil)).toThrow(/Invalid workspace id/);
		expect(() => getReviewSnapshot(evil)).toThrow(/Invalid workspace id/);
	}
});

test("a base-side anchor is captured from the BASE blob and never re-anchored", () => {
	commitThenEdit("b.ts", "keep me\nDELETED LINE\ntail\n", "keep me\ntail\nmore\n");
	const comment = addBase("b.ts", 2, "why was this removed?");
	// The fragment is the line as it stood in the base — the worktree's line 2 says something else
	// entirely, which is exactly what a translated-to-worktree anchor would have captured.
	const quote = comment.anchor?.selectors.find((s) => s.kind === "textQuote");
	expect(quote && "exact" in quote ? quote.exact : "").toBe("DELETED LINE");
	expect(comment.anchor?.baseRef).toBeTruthy();

	// Worktree churn re-anchors worktree comments; a base anchor names an immutable blob, so it holds.
	writeFileSync(join(worktree, "b.ts"), "totally different\n");
	const snapshot = getReviewSnapshot(WS_ID);
	expect(snapshot.comments[0]?.anchorState).toBe("anchored");
	expect(snapshot.comments[0]?.anchor?.selectors).toEqual(comment.anchor?.selectors ?? []);
});

test("a base anchor pins its ref to a commit oid, so a later commit can't move the fragment under it", () => {
	// `uncommitted` scope resolves its original side to the literal `HEAD`. Stored verbatim, the user's
	// next commit re-points it and the package reads TODAY's content at yesterday's line numbers — the
	// agent is shown a fragment the remark was never about.
	commitThenEdit("b.ts", "const one = 1;\nconst two = 2;\n", "const one = 1;\nconst TWO = 2;\n");
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();
	const comment = addComment({
		workspaceId: WS_ID,
		kind: "diff",
		anchor: {
			path: "b.ts",
			side: "base",
			selectors: [{ kind: "lineRange", startLine: 2, endLine: 2 }],
		},
		body: "why the rename?",
		scope: { kind: "uncommitted" },
	});
	expect(comment.anchor?.baseRef).toBe(head);

	// Commit the rename: HEAD moves on.
	gitIn(worktree, ["add", "b.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "rename two"]);
	expect(
		execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim(),
	).not.toBe(head);

	// The package still quotes the pre-commit blob — fragment AND the context read around it.
	const pkg = buildSendPackage(WS_ID, sendableComments(WS_ID, [comment.id]));
	expect(pkg).toContain("const two = 2;");
	expect(pkg).not.toContain("const TWO = 2;");
	expect(pkg).toContain(`base-ref="${head}"`);
});

test("a base-side anchor on a path the base doesn't have is rejected, never re-pointed", () => {
	// `a.ts` exists only in the worktree (untracked) — there is no pre-change content to quote.
	expect(() => addBase("a.ts", 1, "x")).toThrow(/no a\.ts to comment on/);
});

test("the review's base is the FORK POINT, not a target tip that advanced past it", () => {
	// The `branch` diff shows fork-point-vs-worktree (merge-base semantics), so the review must pin the
	// same commit. Pinning the target's TIP instead means Reject "restores" upstream commits the review
	// never displayed.
	writeFileSync(join(worktree, "up.ts"), "fork\n");
	gitIn(worktree, ["add", "up.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "fork point"]);
	const forkPoint = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();
	// The workspace diverges…
	gitIn(worktree, ["checkout", "-b", "feature"]);
	writeFileSync(join(worktree, "mine.ts"), "mine\n");
	gitIn(worktree, ["add", "mine.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "my work"]);
	// …and the base branch advances underneath it, touching the same file.
	gitIn(worktree, ["checkout", "main"]);
	writeFileSync(join(worktree, "up.ts"), "upstream\n");
	gitIn(worktree, ["add", "up.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "upstream work"]);
	const tip = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();
	gitIn(worktree, ["checkout", "feature"]);
	expect(tip).not.toBe(forkPoint);

	// The review is created now: its base is the fork point, and the blob it names is the REVIEWED
	// content — not the upstream edit the diff never showed.
	expect(getReviewSnapshot(WS_ID).review.baseSha).toBe(forkPoint);
	expect(
		execFileSync("git", ["show", `${forkPoint}:up.ts`], { cwd: worktree, encoding: "utf8" }),
	).toBe("fork\n");
});

test("the review pins its base to a full oid at creation (what Reject reverts to)", () => {
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();
	expect(getReviewSnapshot(WS_ID).review.baseSha).toBe(head);
});

test("review-level comments carry no anchor; validation rejects bad shapes", () => {
	const c = addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "overall" });
	expect(c.anchor).toBeNull();
	expect(() =>
		addComment({ workspaceId: WS_ID, kind: "inline", anchor: null, body: "x" }),
	).toThrow();
	expect(() =>
		addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "  " }),
	).toThrow();
});

test("a DAMAGED review file is refused, never replaced — the comments stay on disk", () => {
	addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "keep me" });
	const file = join(dataDir, "reviews", `${WS_ID}.json`);
	const intact = readFileSync(file, "utf8");
	// A host killed mid-write leaves a truncated file. Reading that as "no review yet" would have
	// `ensureSnapshot` write a fresh empty one over it — every comment gone, silently.
	writeFileSync(file, intact.slice(0, Math.floor(intact.length / 2)));
	expect(() => getReviewSnapshot(WS_ID)).toThrow(/damaged/);
	expect(readFileSync(file, "utf8")).not.toContain('"comments": []');
	// Repairing it by hand brings the review back untouched.
	writeFileSync(file, intact);
	expect(getReviewSnapshot(WS_ID).comments[0]?.body).toBe("keep me");
});

test("an unreadable review file fails the read instead of starting an empty review", () => {
	addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "keep me too" });
	const file = join(dataDir, "reviews", `${WS_ID}.json`);
	// Any read failure that ISN'T "no such file" (here EISDIR; in the wild EACCES, EIO) must fail the
	// read — answering it with a fresh empty review is how a still-recoverable one gets overwritten.
	rmSync(file);
	mkdirSync(file);
	expect(() => getReviewSnapshot(WS_ID)).toThrow();
	expect(statSync(file).isDirectory()).toBe(true);
});

test("writes land atomically: a rename, and no temp file left behind", () => {
	addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "atomic" });
	const dir = join(dataDir, "reviews");
	expect(readdirSync(dir)).toEqual([`${WS_ID}.json`]);
});

test("resolve_comment skips a damaged sibling review rather than failing the resolve it belongs to", () => {
	const comment = addComment({
		workspaceId: WS_ID,
		kind: "review",
		anchor: null,
		body: "resolve me",
	});
	markCommentsSent(WS_ID, [comment.id], "sess-x");
	// A second workspace's file, damaged. The agent's tool scans every review by id, so this one must
	// not take down a resolve that belongs to the healthy review next to it.
	writeFileSync(join(dataDir, "reviews", "ws-broken.json"), "{ truncated");
	expect(resolveCommentFromAgent(comment.id).status).toBe("resolved");
});

test("markFileDone: only a fully-resolved file; a new comment re-opens it", () => {
	const comment = addInline();
	expect(() => markFileDone(WS_ID, "a.ts")).toThrow(/unresolved/);
	markCommentsSent(WS_ID, [comment.id], "sess1");
	expect(() => markFileDone(WS_ID, "a.ts")).toThrow(/unresolved/);
	resolveCommentFromAgent(comment.id);
	markFileDone(WS_ID, "a.ts");
	expect(getReviewSnapshot(WS_ID).review.doneFiles).toEqual(["a.ts"]);
	// Saying more re-opens the file's review.
	addInline("more to say");
	expect(getReviewSnapshot(WS_ID).review.doneFiles).toEqual([]);
});
