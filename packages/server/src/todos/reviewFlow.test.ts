import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { gitCommitPaths } from "../git";
import { reconcileChangeArtifacts } from "./artifacts";
import { dropReviewRecord, putReviewRecord, readReviewRecords } from "./reviews";
import {
	approveTodoReview,
	listTodos,
	removeTodo,
	renderFixPackage,
	requestTodoFix,
	rollbackTodoFix,
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
	const committed = gitCommitPaths("w1", `todo: ${title}`, [file]);
	if (!committed) throw new Error("commit failed");
	const todo = store.add({
		title,
		artifacts: [{ kind: "commit", sha: committed.sha, label: title }],
	});
	store.update(todo.id, { status: "done" });
	return { id: todo.id, sha: committed.sha };
}

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
	const second = gitCommitPaths("w1", "todo: step", ["impl2.ts"]);
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

test("requestTodoFix records changes_requested + feedback and renders the context package", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id, sha } = committedItem(store, "Implement FloodWait handling", "flood.ts");
	store.update(id, { summary: "Added throttling and fallback for failed batch sends." });

	const { pkg, previous } = requestTodoFix({
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
	rollbackTodoFix({ workspaceId: "w1", sessionId: SESSION, id }, previous);
	const after = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(after.todos.find((t) => t.id === id)?.review?.state).toBe("unreviewed");
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

test("a path-list fallback redo resets the review record (no sha to watermark against)", () => {
	const store = new TodoStore(repo, SESSION);
	const todo = store.add({ title: "step" });
	store.update(todo.id, { status: "in_progress" });
	reconcileChangeArtifacts(store, repo, SESSION, () => []); // window (clean start)
	store.update(todo.id, { status: "done" });
	// No commit fn → path-list fallback.
	reconcileChangeArtifacts(store, repo, SESSION, () => ["a.ts"]);
	putReviewRecord(repo, SESSION, todo.id, {
		state: "reviewed",
		reviewedShas: [],
		at: "2026-01-01T00:00:00Z",
	});
	// Re-open and re-work, landing in the fallback again — the stale decision is dropped.
	store.update(todo.id, { status: "in_progress" });
	reconcileChangeArtifacts(store, repo, SESSION, () => []);
	store.update(todo.id, { status: "done" });
	reconcileChangeArtifacts(store, repo, SESSION, () => ["b.ts"]);
	expect(readReviewRecords(repo, SESSION)[todo.id]).toBeUndefined();
});

test("todo.remove prunes the item's review record; the plan summary rides listTodos", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = committedItem(store, "step", "impl.ts");
	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id });
	removeTodo({ workspaceId: "w1", sessionId: SESSION, id });
	expect(readReviewRecords(repo, SESSION)).toEqual({});

	store.setSummary("Everything landed; suite green.");
	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(plan.summary).toBe("Everything landed; suite green.");
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
