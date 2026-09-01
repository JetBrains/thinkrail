import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { gitCommitPaths } from "../git";
import { enqueueTodoMutation, reconcileChangeArtifacts } from "./artifacts";
import {
	clearAllPendingReviews,
	dropReviewRecord,
	putReviewRecord,
	readReviewRecords,
	setAutoCycles,
} from "./reviews";
import {
	approveTodoReview,
	listTodos,
	removeTodo,
	renderFixPackage,
	requestTodoFix,
	reviewedShaSuperseded,
	rollbackTodoFix,
	startTodoReview,
	todoReviewAutoCycles,
} from "./todos";

// --- The TODO review workflow: the review sidecar, the listTodos review decoration, approve /
// ask-to-fix, and the revision watermark (real git + registry, the decoration.test harness) ---

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const SESSION = "sess-review";

function sh(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-todos-review-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	sh(repo, "init", "-b", "main");
	sh(repo, "config", "user.email", "t@thinkrail.test");
	sh(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "w1",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
				createdAt: 1,
			},
		]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

/** A committed done item the way artifacts.ts leaves one, returning its id + sha. */
function committedItem(store: TodoStore, title: string, file: string): { id: string; sha: string } {
	writeFileSync(join(repo, file), "export {};\n");
	const committed = gitCommitPaths("w1", title, [file]);
	if (!committed) throw new Error("commit failed");
	const todo = store.add({
		title,
		artifacts: [{ kind: "commit", sha: committed.sha, label: title }],
	});
	store.update(todo.id, { status: "done" });
	return { id: todo.id, sha: committed.sha };
}

test("reviewedShaSuperseded: true when an older sha lost the newest slot, else false", () => {
	const store = new TodoStore(repo, SESSION);
	const todo = store.add({
		title: "two commits",
		artifacts: [
			{ kind: "commit", sha: "sha1", label: "a" },
			{ kind: "commit", sha: "sha2", label: "b" },
		],
	});
	const ref = { workspaceId: "w1", sessionId: SESSION, id: todo.id };
	expect(reviewedShaSuperseded(ref, "sha1")).toBe(true);
	expect(reviewedShaSuperseded(ref, "sha2")).toBe(false);
	expect(reviewedShaSuperseded(ref, "")).toBe(false);
	expect(reviewedShaSuperseded({ ...ref, id: "t_nope" }, "sha1")).toBe(false);
});

test("review sidecar: put/read round-trip, rollback restore, corrupt file reads as none", () => {
	const record = {
		state: "changes_requested" as const,
		reviewedShas: ["abc"],
		feedback: "propagate it",
		at: "2026-01-01T00:00:00Z",
	};
	expect(putReviewRecord(repo, SESSION, "t_1", record)).toBeUndefined();
	expect(readReviewRecords(repo, SESSION)).toEqual({ t_1: record });
	// Replace returns the previous record; rollback (drop with previous) restores it.
	const next = {
		state: "reviewed" as const,
		reviewedShas: ["abc", "def"],
		at: "2026-01-02T00:00:00Z",
	};
	expect(putReviewRecord(repo, SESSION, "t_1", next)).toEqual(record);
	dropReviewRecord(repo, SESSION, "t_1", record);
	expect(readReviewRecords(repo, SESSION)).toEqual({ t_1: record });
	// Plain drop removes; a corrupt file reads as none.
	dropReviewRecord(repo, SESSION, "t_1");
	expect(readReviewRecords(repo, SESSION)).toEqual({});
	writeFileSync(join(repo, ".thinkrail/context/todos", `${SESSION}.reviews.json`), "{nope");
	expect(readReviewRecords(repo, SESSION)).toEqual({});
});

test("listTodos decorates reviewable items (unreviewed, revision) and leaves diff-less items alone", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	const research = store.add({ title: "research step" });
	store.update(research.id, { status: "done" });

	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	const wire = plan.todos.find((t) => t.id === id);
	expect(wire?.review).toEqual({ state: "unreviewed", revision: 1 });
	// No change set → not reviewable → no review decoration, ever.
	expect(plan.todos.find((t) => t.id === research.id)?.review).toBeUndefined();
});

test("approve records the watermark; a later revision commit reads as the unreviewed delta", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id, sha } = committedItem(store, "step", "impl.ts");

	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id });
	let plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	let review = plan.todos.find((t) => t.id === id)?.review;
	expect(review?.state).toBe("reviewed");
	expect(review?.unreviewedShas).toBeUndefined();
	expect(review?.at).toBeString();

	// A fix cycle appends a second commit — only IT is the unreviewed delta.
	writeFileSync(join(repo, "impl2.ts"), "export {};\n");
	const second = gitCommitPaths("w1", "feat: step", ["impl2.ts"]);
	if (!second) throw new Error("commit failed");
	store.update(id, {
		artifacts: [
			{ kind: "commit", sha, label: "step" },
			{ kind: "commit", sha: second.sha, label: "step" },
		],
	});
	plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	review = plan.todos.find((t) => t.id === id)?.review;
	expect(review?.revision).toBe(2);
	expect(review?.unreviewedShas).toEqual([second.sha]);
});

test("an agent verdict watermarks the START-time shas — a commit landed mid-review stays the unreviewed delta", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id, sha } = committedItem(store, "step", "impl.ts");

	// The agent review starts: the pending mark captures the sha set the reviewer will actually read.
	startTodoReview({ workspaceId: "w1", sessionId: SESSION, id });

	// The worker lands another commit WHILE the reviewer's turn is streaming.
	writeFileSync(join(repo, "impl2.ts"), "export {};\n");
	const second = gitCommitPaths("w1", "feat: step", ["impl2.ts"]);
	if (!second) throw new Error("commit failed");
	store.update(id, {
		artifacts: [
			{ kind: "commit", sha, label: "step" },
			{ kind: "commit", sha: second.sha, label: "step" },
		],
	});

	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id }, "agent");
	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	const review = plan.todos.find((t) => t.id === id)?.review;
	expect(review?.state).toBe("reviewed");
	expect(review?.reviewing).toBeUndefined();
	expect(review?.unreviewedShas).toEqual([second.sha]);
	expect(readReviewRecords(repo, SESSION)[id]?.reviewedShas).toEqual([sha]);
});

test("requestTodoFix records changes_requested + feedback and renders the context package", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id, sha } = committedItem(store, "Implement FloodWait handling", "flood.ts");
	store.update(id, { summary: "Added throttling and fallback for failed batch sends." });

	const { pkg, previous, requested } = requestTodoFix({
		workspaceId: "w1",
		sessionId: SESSION,
		id,
		feedback: "Don't retry RetryAfter here. Propagate it.",
	});
	expect(previous).toBeUndefined();
	expect(pkg).toContain(`step ${id}`);
	expect(pkg).toContain("Implement FloodWait handling");
	expect(pkg).toContain("Added throttling and fallback");
	expect(pkg).toContain(sha.slice(0, 12));
	expect(pkg).toContain("Don't retry RetryAfter here. Propagate it.");
	expect(pkg).toContain("Do not create a new item");

	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	const review = plan.todos.find((t) => t.id === id)?.review;
	expect(review?.state).toBe("changes_requested");
	expect(review?.feedback).toBe("Don't retry RetryAfter here. Propagate it.");

	// A pre-turn send rejection rolls the record back to what it replaced (here: none).
	rollbackTodoFix({ workspaceId: "w1", sessionId: SESSION, id }, previous, requested);
	const after = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(after.todos.find((t) => t.id === id)?.review?.state).toBe("unreviewed");
});

test("a failed fix request cannot roll back a newer review decision", () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	const { previous, requested } = requestTodoFix({
		workspaceId: "w1",
		sessionId: SESSION,
		id,
		feedback: "change it",
	});
	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id });

	expect(rollbackTodoFix({ workspaceId: "w1", sessionId: SESSION, id }, previous, requested)).toBe(
		false,
	);
	expect(readReviewRecords(repo, SESSION)[id]?.state).toBe("reviewed");
});

test("review ops reject diff-less or unknown items; empty feedback is refused", () => {
	const store = new TodoStore(repo, SESSION);
	const research = store.add({ title: "research" });
	expect(() =>
		approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id: research.id }),
	).toThrow(/no change set/);
	expect(() =>
		approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id: "t_missing" }),
	).toThrow(/No TODO/);
	const { id } = committedItem(store, "step", "impl.ts");
	expect(() =>
		requestTodoFix({ workspaceId: "w1", sessionId: SESSION, id, feedback: "  " }),
	).toThrow(/must not be empty/);
});

test("a path-list fallback redo resets the review record (no sha to watermark against)", async () => {
	const store = new TodoStore(repo, SESSION);
	const todo = store.add({ title: "step" });
	store.update(todo.id, { status: "in_progress" });
	await reconcileChangeArtifacts(store, repo, SESSION, async () => []); // window (clean start)
	store.update(todo.id, { status: "done" });
	// No commit fn → path-list fallback.
	await reconcileChangeArtifacts(store, repo, SESSION, async () => ["a.ts"]);
	putReviewRecord(repo, SESSION, todo.id, {
		state: "reviewed",
		reviewedShas: [],
		at: "2026-01-01T00:00:00Z",
	});
	// Re-open and re-work, landing in the fallback again — the stale decision is dropped.
	store.update(todo.id, { status: "in_progress" });
	await reconcileChangeArtifacts(store, repo, SESSION, async () => []);
	store.update(todo.id, { status: "done" });
	await reconcileChangeArtifacts(store, repo, SESSION, async () => ["b.ts"]);
	expect(readReviewRecords(repo, SESSION)[todo.id]).toBeUndefined();
});

test("todo.remove prunes the item's review record; the plan summary rides listTodos", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id });
	await removeTodo({ workspaceId: "w1", sessionId: SESSION, id });
	expect(readReviewRecords(repo, SESSION)).toEqual({});

	store.setSummary("Everything landed; suite green.");
	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(plan.summary).toBe("Everything landed; suite green.");
});

test("todo.remove rejects while the item is pending an agent review, leaving it in place", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	startTodoReview({ workspaceId: "w1", sessionId: SESSION, id });

	// Removing a `reviewing` item would strand the host's in-flight registration (currentReview,
	// the per-plan latch) until the reviewer's turn settles, and let a stray add_review_comment file
	// an orphan finding against an id that no longer exists — see host/SPEC.md.
	await expect(removeTodo({ workspaceId: "w1", sessionId: SESSION, id })).rejects.toThrow(
		/currently under review/,
	);
	expect(store.get(id)).toBeDefined();
});

test("todo.remove rechecks the host's active-review guard after waiting in the mutation queue", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const blocker = enqueueTodoMutation("w1", () => gate);
	let active = false;
	const removal = removeTodo({ workspaceId: "w1", sessionId: SESSION, id }, () => active);
	active = true;
	release();
	await blocker;

	await expect(removal).rejects.toThrow(/currently under review/);
	expect(store.get(id)).toBeDefined();
});

test("renderFixPackage names changed paths for the fallback change set", () => {
	const item = {
		id: "t_1",
		title: "step",
		status: "done" as const,
		origin: "agent" as const,
		artifacts: [
			{ kind: "change" as const, path: "a.ts" },
			{ kind: "change" as const, path: "b.ts" },
		],
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
	};
	const pkg = renderFixPackage(item, "fix it");
	expect(pkg).toContain("changed paths: a.ts, b.ts");
});

test("reviewer sidecar meta: pin + pending marks + reverse lookup; decoration ships reviewing/reviewedBy", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	// Pin the plan's reviewer chat and find the plan back from the reviewer (the verdict seam's lookup).
	const { pinReviewerSession, reviewerSessionFor, workerSessionForReviewer, startTodoReview } =
		await import("./todos");
	pinReviewerSession({ workspaceId: "w1", sessionId: SESSION }, "reviewer-1");
	expect(reviewerSessionFor({ workspaceId: "w1", sessionId: SESSION })).toBe("reviewer-1");
	expect(workerSessionForReviewer("w1", "reviewer-1")).toBe(SESSION);
	expect(workerSessionForReviewer("w1", "someone-else")).toBeUndefined();

	// Start review marks the item in flight (the `reviewing` decoration) and renders the package.
	const { pkg } = startTodoReview({ workspaceId: "w1", sessionId: SESSION, id });
	expect(pkg).toContain(`plan step ${id}`);
	expect(pkg).toContain("review_verdict");
	let plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(plan.todos.find((t) => t.id === id)?.review?.reviewing).toBe(true);

	// An agent approve settles it, labeled, and clears the mark.
	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id }, "agent");
	plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	const review = plan.todos.find((t) => t.id === id)?.review;
	expect(review?.state).toBe("reviewed");
	expect(review?.reviewedBy).toBe("agent");
	expect(review?.reviewing).toBeUndefined();
});

test("recordAgentChangesRequested stores the verdict note + autoCycles for the 1-cycle cap", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	const { recordAgentChangesRequested, todoReviewAutoCycles, todoReviewRecord, startTodoReview } =
		await import("./todos");
	startTodoReview({ workspaceId: "w1", sessionId: SESSION, id });
	recordAgentChangesRequested({
		workspaceId: "w1",
		sessionId: SESSION,
		id,
		note: "propagate RetryAfter",
		autoCycles: 1,
	});
	const record = todoReviewRecord({ workspaceId: "w1", sessionId: SESSION, id });
	expect(record?.state).toBe("changes_requested");
	expect(record?.feedback).toBe("propagate RetryAfter");
	expect(todoReviewAutoCycles({ workspaceId: "w1", sessionId: SESSION, id })).toBe(1);
	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(plan.todos.find((t) => t.id === id)?.review?.reviewing).toBeUndefined();
});

test("clearAllPendingReviews clears every session's stale in-flight mark under a workspace root, leaving a prior verdict untouched (host-restart reconciliation)", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");

	// A settled EARLIER round already recorded a verdict...
	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id }, "agent");
	// ...then a re-review starts (a later commit added an unreviewed delta) and marks the item
	// in-flight, but — this is the crash being simulated — no verdict is ever recorded for it: that's
	// exactly what makes the mark "stuck" (nothing durable or in-memory will ever settle it).
	startTodoReview({ workspaceId: "w1", sessionId: SESSION, id });

	let plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(plan.todos.find((t) => t.id === id)?.review?.reviewing).toBe(true);

	// Simulates the boot-time sweep finding a mark from a process that no longer exists: nothing was
	// registered in this call's (fresh) in-memory maps, so every mark it finds predates it by construction.
	expect(clearAllPendingReviews(repo)).toEqual([{ sessionId: SESSION, itemIds: [id] }]);

	plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	const review = plan.todos.find((t) => t.id === id)?.review;
	expect(review?.reviewing).toBeUndefined();
	// Only the spinner is a lease — the verdict already recorded (from before the interrupted
	// re-review) survives, same as the live per-session crash path (maybeCleanupStuckReviewSession)
	// this mirrors at boot: clearing `pending` never touches `items`.
	expect(review?.state).toBe("reviewed");

	// Idempotent: nothing left pending, so a repeat sweep (or a workspace with no reviews at all) is a
	// cheap no-op rather than an error.
	expect(clearAllPendingReviews(repo)).toEqual([]);
});

test("the path-list fallback drops the review verdict but preserves the spent auto-cycle count", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");

	// A request_changes verdict already spent its one auto cycle.
	putReviewRecord(repo, SESSION, id, { state: "changes_requested", reviewedShas: [], at: "t0" });
	setAutoCycles(repo, SESSION, id, 1);

	// The worker's redo can't be committed (e.g. a shared window or pre-existing dirty paths), so
	// reconcile falls back to a `change` path-list artifact instead of a new commit.
	store.update(id, { status: "in_progress" });
	await reconcileChangeArtifacts(store, repo, SESSION, async () => []);
	store.update(id, { status: "done" });
	await reconcileChangeArtifacts(store, repo, SESSION, async () => ["fix.ts"]);

	// The sha-based verdict is honestly reset (no sha to watermark a path-list delta against)...
	expect(readReviewRecords(repo, SESSION)[id]).toBeUndefined();
	// ...but the auto-cycle bookkeeping must survive: a later manual review must not read this as a
	// fresh item and grant a second automated cycle past the 1-cycle cap.
	expect(todoReviewAutoCycles({ workspaceId: "w1", sessionId: SESSION, id })).toBe(1);

	// This is exactly the (state, reviewing, autoCycles) triple host/todoReview.ts's maybeAutoReReview
	// reads to decide whether to fire a re-review: `state: "unreviewed"` with no reviewing flag, but a
	// spent auto cycle still on record — the signal that a path-list fix landed and must be re-reviewed.
	const review = (await listTodos({ workspaceId: "w1", sessionId: SESSION })).todos.find(
		(t) => t.id === id,
	)?.review;
	expect(review?.state).toBe("unreviewed");
	expect(review?.reviewing).toBeUndefined();
});
