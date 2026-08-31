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
import type { ReviewChangedPayload, ReviewSnapshot, Workspace } from "@thinkrail/contracts";
import { saveWorkspaces } from "../persistence";
import { setWorkspaceDiffBase } from "../workspaces";
import {
	addComment,
	anchorProblem,
	buildSendPackage,
	clearReview,
	deleteComment,
	fileReviewSession,
	getReviewSnapshot,
	markCommentsSent,
	markFileDone,
	REVIEW_LEVEL_KEY,
	reanchorWorkspace,
	removeWorkspaceReviews,
	resolveCommentFromAgent,
	reviewReadFailure,
	reviewSessionKey,
	rollbackSend,
	sendableComments,
	setReflection,
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

function archiveDir(): string {
	return join(dataDir, "reviews", "archive", WS_ID);
}

function archivedSnapshots(): ReviewSnapshot[] {
	return readdirSync(archiveDir())
		.filter((file) => file.endsWith(".json"))
		.map((file) => JSON.parse(readFileSync(join(archiveDir(), file), "utf8")) as ReviewSnapshot);
}

test("anchorProblem: real path + in-range line passes, hallucinated path and past-EOF line fail", () => {
	expect(anchorProblem(WS_ID, "a.ts", 1)).toBeNull();
	expect(anchorProblem(WS_ID, "a.ts", 3)).toBeNull();
	expect(anchorProblem(WS_ID, "nope.ts", 1)).toContain("No file");
	expect(anchorProblem(WS_ID, "a.ts", 99)).toContain("past the end");
});

test("setReflection records the verdict on a finding and publishes it", async () => {
	const comment = await addInline();
	const updated = await setReflection(WS_ID, comment.id, {
		verdict: "refuted",
		confidence: "high",
		reason: "the cited API does exist",
	});
	expect(updated.reflection).toEqual({
		verdict: "refuted",
		confidence: "high",
		reason: "the cited API does exist",
	});
	expect(pushes.at(-1)?.comments.find((c) => c.id === comment.id)?.reflection?.verdict).toBe(
		"refuted",
	);
});

test("add fills contentHash + textQuote, publishes a full snapshot", async () => {
	const comment = await addInline();
	expect(comment.status).toBe("draft");
	expect(comment.anchor?.contentHash).toBeTruthy();
	expect(comment.anchor?.selectors.some((s) => s.kind === "textQuote")).toBe(true);
	expect(pushes.at(-1)?.comments).toHaveLength(1);
	expect(pushes.at(-1)?.workspaceId).toBe(WS_ID);
});

test("get re-anchors against the worktree: edit above → moved, fragment gone → outdated", async () => {
	await addInline();
	writeFileSync(
		join(worktree, "a.ts"),
		"// new header\nconst a = 1;\nconst b = 2;\nconst c = 3;\n",
	);
	let snapshot = await getReviewSnapshot(WS_ID);
	expect(snapshot.comments[0]?.anchorState).toBe("moved");
	writeFileSync(join(worktree, "a.ts"), "const a = 1;\nconst c = 3;\n");
	snapshot = await getReviewSnapshot(WS_ID);
	expect(snapshot.comments[0]?.anchorState).toBe("outdated");
	const quote = snapshot.comments[0]?.anchor?.selectors.find((s) => s.kind === "textQuote");
	expect(quote && "exact" in quote ? quote.exact : "").toBe("const b = 2;");
});

test("a workspace removed while creation awaits git gets no resurrected review file", async () => {
	const pending = getReviewSnapshot(WS_ID);
	saveWorkspaces([]);
	await expect(pending).rejects.toThrow(`Unknown workspace: ${WS_ID}`);
	expect(
		statSync(join(dataDir, "reviews", `${WS_ID}.json`), { throwIfNoEntry: false }),
	).toBeUndefined();
});

test("Clear serializes with a first lazy review read", async () => {
	const clearing = clearReview(WS_ID);
	const reading = getReviewSnapshot(WS_ID);
	const [cleared] = await Promise.all([clearing, reading]);

	expect((await getReviewSnapshot(WS_ID)).review.id).toBe(cleared.review.id);
	expect(pushes).toHaveLength(1);
	expect(pushes[0]?.review.id).toBe(cleared.review.id);
});

test("review creation retries when the diff target changes during base resolution", async () => {
	gitIn(worktree, ["switch", "-c", "feature"]);
	writeFileSync(join(worktree, "feature.ts"), "feature\n");
	gitIn(worktree, ["add", "feature.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "feature"]);
	const featureHead = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();

	const pending = getReviewSnapshot(WS_ID);
	setWorkspaceDiffBase(WS_ID, "feature");

	expect((await pending).review.baseSha).toBe(featureHead);
});

test("a concurrent get's re-anchor persist can't delete a mutation's just-saved comment", async () => {
	const first = await addInline("first");
	writeFileSync(join(worktree, "a.ts"), "// shift\nconst a = 1;\nconst b = 2;\nconst c = 3;\n");
	const adding = addInline("second");
	const reading = getReviewSnapshot(WS_ID);
	const [second] = await Promise.all([adding, reading]);
	const ids = (await getReviewSnapshot(WS_ID)).comments.map((c) => c.id);
	expect(ids).toContain(first.id);
	expect(ids).toContain(second.id);
});

test("reanchorWorkspace publishes only when something moved", async () => {
	await addInline();
	const before = pushes.length;
	reanchorWorkspace(WS_ID);
	expect(pushes.length).toBe(before);
	writeFileSync(join(worktree, "a.ts"), "// x\nconst a = 1;\nconst b = 2;\nconst c = 3;\n");
	reanchorWorkspace(WS_ID);
	expect(pushes.length).toBe(before + 1);
});

test("update edits drafts only; manual resolve stamps resolvedBy user; resolved is final", async () => {
	const comment = await addInline();
	await updateComment({ workspaceId: WS_ID, id: comment.id, body: "better wording" });
	await expect(
		updateComment({ workspaceId: WS_ID, id: comment.id, status: "sent" }),
	).rejects.toThrow(/resolved or dismissed/);
	await markCommentsSent(WS_ID, [comment.id], "sess1");
	await expect(
		updateComment({ workspaceId: WS_ID, id: comment.id, body: "nope" }),
	).rejects.toThrow();
	await expect(
		updateComment({ workspaceId: WS_ID, id: comment.id, status: "draft" }),
	).rejects.toThrow(/resolved or dismissed/);
	const resolved = await updateComment({ workspaceId: WS_ID, id: comment.id, status: "resolved" });
	expect(resolved.resolvedBy).toBe("user");
	await expect(
		updateComment({ workspaceId: WS_ID, id: comment.id, status: "dismissed" }),
	).rejects.toThrow(/final/);
});

test("send lifecycle: sendable drafts → sent with session link; the file's chat is pinned and reused", async () => {
	const c1 = await addInline("one");
	const c2 = await addInline("two");
	const drafts = await sendableComments(WS_ID);
	expect(drafts.map((c) => c.id)).toEqual([c1.id, c2.id]);
	await markCommentsSent(WS_ID, [c1.id, c2.id], "sess-file");
	const snapshot = await getReviewSnapshot(WS_ID);
	expect(snapshot.review.fileSessions).toEqual({ "a.ts": "sess-file" });
	expect(await fileReviewSession(WS_ID, "a.ts")).toBe("sess-file");
	expect(await fileReviewSession(WS_ID, "other.ts")).toBeUndefined();
	expect(snapshot.comments.every((c) => c.status === "sent" && c.sessionId === "sess-file")).toBe(
		true,
	);
	await expect(sendableComments(WS_ID)).rejects.toThrow("No draft comments");
});

test("the implicit batch sweeps agent drafts too — findings ride the user's send on equal terms", async () => {
	const mine = await addInline("mine");
	const theirs = await addComment({
		workspaceId: WS_ID,
		kind: "inline",
		author: "agent",
		anchor: {
			path: "a.ts",
			side: "worktree",
			selectors: [{ kind: "lineRange", startLine: 3, endLine: 3 }],
		},
		body: "reviewer finding",
	});
	expect((await sendableComments(WS_ID)).map((c) => c.id)).toEqual([mine.id, theirs.id]);
});

test("mark sent rejects lifecycle drift without partially updating the surviving draft", async () => {
	const comment = await addInline("draft");

	await expect(markCommentsSent(WS_ID, [comment.id, "rc_missing"], "sess-file")).rejects.toThrow(
		/Unknown review comment/,
	);
	expect((await getReviewSnapshot(WS_ID)).comments.find((c) => c.id === comment.id)?.status).toBe(
		"draft",
	);
});

test("rollbackSend undoes an optimistic markSent (pre-turn rejection) → drafts again, chat unpinned", async () => {
	const c1 = await addInline("one");
	const c2 = await addInline("two");
	await markCommentsSent(WS_ID, [c1.id, c2.id], "sess-file");
	expect((await getReviewSnapshot(WS_ID)).review.fileSessions).toEqual({ "a.ts": "sess-file" });
	rollbackSend(WS_ID, [c1.id, c2.id], "sess-file");
	const snapshot = await getReviewSnapshot(WS_ID);
	expect(snapshot.comments.every((c) => c.status === "draft" && c.sessionId === undefined)).toBe(
		true,
	);
	expect(snapshot.comments.every((c) => c.sentAt === undefined)).toBe(true);
	expect(snapshot.review.fileSessions).toEqual({});
	expect((await sendableComments(WS_ID)).map((c) => c.id)).toEqual([c1.id, c2.id]);
});

test("rollbackSend keeps a reused chat's pin when another comment still backs it", async () => {
	const first = await addInline("delivered");
	await markCommentsSent(WS_ID, [first.id], "sess-file");
	const second = await addInline("failed follow-up");
	await markCommentsSent(WS_ID, [second.id], "sess-file");
	rollbackSend(WS_ID, [second.id], "sess-file");
	const snapshot = await getReviewSnapshot(WS_ID);
	expect(snapshot.comments.find((c) => c.id === first.id)?.status).toBe("sent");
	expect(snapshot.comments.find((c) => c.id === second.id)?.status).toBe("draft");
	expect(snapshot.review.fileSessions).toEqual({ "a.ts": "sess-file" });
});

test("rollbackSend is a no-op for a session that never sent these comments (fault after acceptance)", async () => {
	const comment = await addInline();
	await markCommentsSent(WS_ID, [comment.id], "sess-file");
	const before = pushes.length;
	rollbackSend(WS_ID, [comment.id], "other-session");
	expect(pushes.length).toBe(before);
	expect((await getReviewSnapshot(WS_ID)).comments[0]?.status).toBe("sent");
});

test("rollbackSend after clear is a clean no-op — it never resurrects cleared comments", async () => {
	const comment = await addInline();
	await markCommentsSent(WS_ID, [comment.id], "sess-file");
	await clearReview(WS_ID);
	const before = pushes.length;
	rollbackSend(WS_ID, [comment.id], "sess-file");
	expect(pushes.length).toBe(before);
	const onDisk = JSON.parse(readFileSync(join(dataDir, "reviews", `${WS_ID}.json`), "utf8"));
	expect(onDisk.review.status).toBe("open");
	expect(onDisk.comments).toEqual([]);
});

test("a review-level remark pins its own bucket chat, so a second one continues the discussion", async () => {
	const overall = await addComment({
		workspaceId: WS_ID,
		kind: "review",
		anchor: null,
		body: "overall",
	});
	await markCommentsSent(WS_ID, [overall.id], "sess-overall");
	expect((await getReviewSnapshot(WS_ID)).review.fileSessions).toEqual({
		[REVIEW_LEVEL_KEY]: "sess-overall",
	});
	expect(await fileReviewSession(WS_ID, REVIEW_LEVEL_KEY)).toBe("sess-overall");
	expect(reviewSessionKey(overall)).toBe(REVIEW_LEVEL_KEY);
	expect(reviewSessionKey(await addInline("pinned to its file"))).toBe("a.ts");
});

test("agent resolve: sent → resolved with note; unknown/duplicate fail loud", async () => {
	const comment = await addInline();
	expect(() => resolveCommentFromAgent("sess1", comment.id)).toThrow("not sent");
	await markCommentsSent(WS_ID, [comment.id], "sess1");
	const resolved = resolveCommentFromAgent("sess1", comment.id, "renamed the constant");
	expect(resolved.resolvedBy).toBe("agent");
	expect(resolved.resolveNote).toBe("renamed the constant");
	expect(() => resolveCommentFromAgent("sess1", comment.id)).toThrow("already resolved");
	expect(() => resolveCommentFromAgent("sess1", "rc_nope")).toThrow("Unknown review comment");
});

test("agent resolve is bound to the chat the comment was actually sent to — no other session, sent or not", async () => {
	const comment = await addInline();
	await markCommentsSent(WS_ID, [comment.id], "sess1");
	expect(() => resolveCommentFromAgent("sess2", comment.id)).toThrow("not sent to this chat");
	expect(resolveCommentFromAgent("sess1", comment.id).status).toBe("resolved");
});

test("an open-snapshot mutation cannot overwrite an agent resolution across its async return", async () => {
	const sent = await addInline("sent first");
	await markCommentsSent(WS_ID, [sent.id], "sess1");

	const adding = addInline("added concurrently");
	resolveCommentFromAgent("sess1", sent.id, "fixed concurrently");
	await adding;

	expect((await getReviewSnapshot(WS_ID)).comments.find((c) => c.id === sent.id)).toMatchObject({
		status: "resolved",
		resolveNote: "fixed concurrently",
	});
});

test("a draft finding is unresolvable through resolve_comment even when self-authored by the agent — the reviewer must not clear its own unsent finding", async () => {
	const finding = await addComment({
		workspaceId: WS_ID,
		kind: "inline",
		author: "agent",
		anchor: {
			path: "a.ts",
			side: "worktree",
			selectors: [{ kind: "lineRange", startLine: 3, endLine: 3 }],
		},
		body: "reviewer finding",
	});
	expect(() => resolveCommentFromAgent("reviewer-sess", finding.id)).toThrow("not sent");
	const scratch = await addInline("human scratch");
	expect(() => resolveCommentFromAgent("any-sess", scratch.id)).toThrow("not sent");
});

test("the first worktree comment captures its anchor after lazy snapshot creation", async () => {
	const adding = addInline("late anchor");
	writeFileSync(join(worktree, "a.ts"), "const a = 1;\nconst b = 22;\nconst c = 3;\n");
	const comment = await adding;
	const quote = comment.anchor?.selectors.find((selector) => selector.kind === "textQuote");
	expect(quote).toMatchObject({ exact: "const b = 22;" });
});

test("clear keeps an agent resolution that lands while the fresh base resolves", async () => {
	const sent = await addInline("agent record");
	await markCommentsSent(WS_ID, [sent.id], "sess1");

	const clearing = clearReview(WS_ID);
	resolveCommentFromAgent("sess1", sent.id, "resolved during clear");
	await clearing;

	expect(archivedSnapshots()[0]?.comments[0]).toMatchObject({
		id: sent.id,
		status: "resolved",
		resolveNote: "resolved during clear",
	});
});

test("clear archives records, discards drafts, and publishes only the fresh snapshot", async () => {
	const draft = await addInline("unsent scratch");
	const sent = await addInline("agent record");
	await markCommentsSent(WS_ID, [sent.id], "sess1");
	const before = pushes.length;
	const fresh = await clearReview(WS_ID);

	expect(fresh.review.status).toBe("open");
	expect(fresh.comments).toHaveLength(0);
	expect(fresh.review.id).not.toBe(draft.reviewId);
	expect(pushes.slice(before)).toEqual([{ workspaceId: WS_ID, ...fresh }]);
	expect(await getReviewSnapshot(WS_ID)).toEqual(fresh);

	const [archived] = archivedSnapshots();
	expect(archived?.review).toMatchObject({ id: sent.reviewId, status: "closed" });
	expect(typeof archived?.review.closedAt).toBe("number");
	expect(archived?.comments.map((comment) => comment.id)).toEqual([sent.id]);

	const beforeResolve = pushes.length;
	expect(resolveCommentFromAgent("sess1", sent.id, "fixed after clear").status).toBe("resolved");
	expect(pushes).toHaveLength(beforeResolve);
	expect(archivedSnapshots()[0]?.comments[0]).toMatchObject({
		id: sent.id,
		status: "resolved",
		resolveNote: "fixed after clear",
	});
});

test("delete is draft-only: an unsent remark goes, a sent one is a record", async () => {
	const draft = await addInline("scratch");
	await deleteComment(WS_ID, draft.id);
	expect((await getReviewSnapshot(WS_ID)).comments).toHaveLength(0);
	const sent = await addInline("kept");
	await markCommentsSent(WS_ID, [sent.id], "sess1");
	await expect(deleteComment(WS_ID, sent.id)).rejects.toThrow(/record/);
	await expect(deleteComment(WS_ID, "rc_nope")).rejects.toThrow(/Unknown/);
});

test("purge removes the workspace's active review and archives", async () => {
	const sent = await addInline();
	await markCommentsSent(WS_ID, [sent.id], "sess1");
	await clearReview(WS_ID);
	expect(statSync(archiveDir()).isDirectory()).toBe(true);

	removeWorkspaceReviews(WS_ID);
	expect(() => statSync(archiveDir())).toThrow();
	expect((await getReviewSnapshot(WS_ID)).comments).toHaveLength(0);
});

test("a path-segment workspace id is refused by every file touch — no traversal out of the reviews dir", async () => {
	for (const evil of ["../config", "a/b", "a\\b", "..", ".", "x.y"]) {
		expect(() => removeWorkspaceReviews(evil)).toThrow(/Invalid workspace id/);
		await expect(getReviewSnapshot(evil)).rejects.toThrow(/Invalid workspace id/);
	}
});

test("clear refuses an unsafe persisted review id instead of escaping the archive directory", async () => {
	const sent = await addInline();
	await markCommentsSent(WS_ID, [sent.id], "sess1");
	const activeFile = join(dataDir, "reviews", `${WS_ID}.json`);
	const corrupted = JSON.parse(readFileSync(activeFile, "utf8")) as ReviewSnapshot;
	corrupted.review.id = "../escape";
	writeFileSync(activeFile, `${JSON.stringify(corrupted)}\n`);

	await expect(clearReview(WS_ID)).rejects.toThrow(/Invalid review id/);
	expect((JSON.parse(readFileSync(activeFile, "utf8")) as ReviewSnapshot).comments).toHaveLength(1);
	expect(() => statSync(join(dataDir, "reviews", "archive", "escape.json"))).toThrow();
});

test("a base-side anchor is captured from the BASE blob and never re-anchored", async () => {
	commitThenEdit("b.ts", "keep me\nDELETED LINE\ntail\n", "keep me\ntail\nmore\n");
	const comment = await addBase("b.ts", 2, "why was this removed?");
	const quote = comment.anchor?.selectors.find((s) => s.kind === "textQuote");
	expect(quote && "exact" in quote ? quote.exact : "").toBe("DELETED LINE");
	expect(comment.anchor?.baseRef).toBeTruthy();

	writeFileSync(join(worktree, "b.ts"), "totally different\n");
	const snapshot = await getReviewSnapshot(WS_ID);
	expect(snapshot.comments[0]?.anchorState).toBe("anchored");
	expect(snapshot.comments[0]?.anchor?.selectors).toEqual(comment.anchor?.selectors ?? []);
});

test("a base anchor pins its ref to a commit oid, so a later commit can't move the fragment under it", async () => {
	commitThenEdit("b.ts", "const one = 1;\nconst two = 2;\n", "const one = 1;\nconst TWO = 2;\n");
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();
	const comment = await addComment({
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

	gitIn(worktree, ["add", "b.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "rename two"]);
	expect(
		execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim(),
	).not.toBe(head);

	const pkg = await buildSendPackage(WS_ID, await sendableComments(WS_ID, [comment.id]));
	expect(pkg).toContain("const two = 2;");
	expect(pkg).not.toContain("const TWO = 2;");
	expect(pkg).toContain(`base-ref="${head}"`);
});

test("a base-side anchor on a path the base doesn't have is rejected, never re-pointed", async () => {
	await expect(addBase("a.ts", 1, "x")).rejects.toThrow(/no a\.ts to comment on/);
});

test("the review's base is the FORK POINT, not a target tip that advanced past it", async () => {
	writeFileSync(join(worktree, "up.ts"), "fork\n");
	gitIn(worktree, ["add", "up.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "fork point"]);
	const forkPoint = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();
	gitIn(worktree, ["checkout", "-b", "feature"]);
	writeFileSync(join(worktree, "mine.ts"), "mine\n");
	gitIn(worktree, ["add", "mine.ts"]);
	gitIn(worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "my work"]);
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

	expect((await getReviewSnapshot(WS_ID)).review.baseSha).toBe(forkPoint);
	expect(
		execFileSync("git", ["show", `${forkPoint}:up.ts`], { cwd: worktree, encoding: "utf8" }),
	).toBe("fork\n");
});

test("the review pins its base to a full oid at creation (what Reject reverts to)", async () => {
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: worktree,
		encoding: "utf8",
	}).trim();
	expect((await getReviewSnapshot(WS_ID)).review.baseSha).toBe(head);
});

test("review-level comments carry no anchor; validation rejects bad shapes", async () => {
	const c = await addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "overall" });
	expect(c.anchor).toBeNull();
	await expect(
		addComment({ workspaceId: WS_ID, kind: "inline", anchor: null, body: "x" }),
	).rejects.toThrow();
	await expect(
		addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "  " }),
	).rejects.toThrow();
});

test("a DAMAGED review file is refused, never replaced — the comments stay on disk", async () => {
	await addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "keep me" });
	const file = join(dataDir, "reviews", `${WS_ID}.json`);
	const intact = readFileSync(file, "utf8");
	writeFileSync(file, intact.slice(0, Math.floor(intact.length / 2)));
	try {
		await getReviewSnapshot(WS_ID);
		expect.unreachable();
	} catch (error) {
		expect(reviewReadFailure(error)).toBe("damaged");
	}
	await expect(clearReview(WS_ID)).rejects.toThrow(/damaged/);
	expect(readFileSync(file, "utf8")).not.toContain('"comments": []');
	writeFileSync(file, intact);
	expect((await getReviewSnapshot(WS_ID)).comments[0]?.body).toBe("keep me");
});

test("an unreadable review file fails the read instead of starting an empty review", async () => {
	await addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "keep me too" });
	const file = join(dataDir, "reviews", `${WS_ID}.json`);
	rmSync(file);
	mkdirSync(file);
	try {
		await getReviewSnapshot(WS_ID);
		expect.unreachable();
	} catch (error) {
		expect(reviewReadFailure(error)).toBe("not a file");
	}
	expect(statSync(file).isDirectory()).toBe(true);
});

test("review read diagnostics keep filesystem messages out of their closed classification", () => {
	const error = Object.assign(new Error("private path"), { code: "EACCES" });
	expect(reviewReadFailure(error)).toBe("permission denied");
	expect(reviewReadFailure(new Error("private path"))).toBe("read failure");
});

test("writes land atomically: a rename, and no temp file left behind", async () => {
	await addComment({ workspaceId: WS_ID, kind: "review", anchor: null, body: "atomic" });
	const dir = join(dataDir, "reviews");
	expect(readdirSync(dir)).toEqual([`${WS_ID}.json`]);
});

test("resolve_comment skips a damaged sibling review rather than failing the resolve it belongs to", async () => {
	const comment = await addComment({
		workspaceId: WS_ID,
		kind: "review",
		anchor: null,
		body: "resolve me",
	});
	await markCommentsSent(WS_ID, [comment.id], "sess-x");
	writeFileSync(join(dataDir, "reviews", "ws-broken.json"), "{ truncated");
	expect(resolveCommentFromAgent("sess-x", comment.id).status).toBe("resolved");
});

test("markFileDone: only a fully-resolved file; a new comment re-opens it", async () => {
	const comment = await addInline();
	await expect(markFileDone(WS_ID, "a.ts")).rejects.toThrow(/unresolved/);
	await markCommentsSent(WS_ID, [comment.id], "sess1");
	await expect(markFileDone(WS_ID, "a.ts")).rejects.toThrow(/unresolved/);
	resolveCommentFromAgent("sess1", comment.id);
	await markFileDone(WS_ID, "a.ts");
	expect((await getReviewSnapshot(WS_ID)).review.doneFiles).toEqual(["a.ts"]);
	await addInline("more to say");
	expect((await getReviewSnapshot(WS_ID)).review.doneFiles).toEqual([]);
});
