import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { gitCommitPaths } from "../git";
import { addComment, deleteComment, getReviewSnapshot, updateComment } from "../reviews";
import { recordAgentChangesRequested, todoReviewRecord } from "../todos";
import { clearChangesRequestedIfResolved } from "./todoReview";

// A changes_requested verdict must not outlive its findings: deleting the item's last open finding
// drops its review record back to unreviewed. A verdict that never had a finding is untouched.

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const WS = "w1";
const SESSION = "sess-cr";

function sh(cwd: string, ...args: string[]): void {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!r.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-cr-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	sh(repo, "init", "-b", "main");
	sh(repo, "config", "user.email", "t@thinkrail.test");
	sh(repo, "config", "user.name", "test");
	sh(repo, "config", "commit.gpgsign", "false");
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
				id: WS,
				projectId: "p1",
				name: WS,
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

function flaggedItem(store: TodoStore, title: string, file: string): { id: string; sha: string } {
	writeFileSync(join(repo, file), "export const x = 1;\n");
	const committed = gitCommitPaths(WS, title, [file]);
	if (!committed) throw new Error("commit failed");
	const todo = store.add({
		title,
		artifacts: [{ kind: "commit", sha: committed.sha, label: title }],
	});
	store.update(todo.id, { status: "done" });
	recordAgentChangesRequested({ workspaceId: WS, sessionId: SESSION, id: todo.id, autoCycles: 2 });
	return { id: todo.id, sha: committed.sha };
}

test("a changes_requested item with no open findings is dropped to unreviewed", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = flaggedItem(store, "step", "f.ts");
	expect(todoReviewRecord({ workspaceId: WS, sessionId: SESSION, id })?.state).toBe(
		"changes_requested",
	);

	await clearChangesRequestedIfResolved({ workspaceId: WS, sessionId: SESSION, id });
	expect(todoReviewRecord({ workspaceId: WS, sessionId: SESSION, id })).toBeUndefined();
});

test("keeps the verdict while a finding remains, drops it once the last one is deleted", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id, sha } = flaggedItem(store, "step", "f.ts");
	const comment = await addComment({
		workspaceId: WS,
		kind: "inline",
		author: "agent",
		anchor: {
			path: "f.ts",
			side: "worktree",
			selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
		},
		body: "fix this",
		origin: { todoId: id, reviewedSha: sha, sessionId: SESSION },
	});
	expect((await getReviewSnapshot(WS)).comments).toHaveLength(1);

	// A finding is still open → the verdict stays.
	await clearChangesRequestedIfResolved({ workspaceId: WS, sessionId: SESSION, id });
	expect(todoReviewRecord({ workspaceId: WS, sessionId: SESSION, id })?.state).toBe(
		"changes_requested",
	);

	// Delete the last finding → the verdict clears.
	await deleteComment(WS, comment.id);
	await clearChangesRequestedIfResolved({ workspaceId: WS, sessionId: SESSION, id });
	expect(todoReviewRecord({ workspaceId: WS, sessionId: SESSION, id })).toBeUndefined();
});

test("resolving (not just deleting) the last finding clears the verdict", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id, sha } = flaggedItem(store, "step", "f.ts");
	const comment = await addComment({
		workspaceId: WS,
		kind: "inline",
		author: "agent",
		anchor: {
			path: "f.ts",
			side: "worktree",
			selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
		},
		body: "fix this",
		origin: { todoId: id, reviewedSha: sha, sessionId: SESSION },
	});

	await updateComment({ workspaceId: WS, id: comment.id, status: "resolved" });
	await clearChangesRequestedIfResolved({ workspaceId: WS, sessionId: SESSION, id });
	expect(todoReviewRecord({ workspaceId: WS, sessionId: SESSION, id })).toBeUndefined();
});

test("an unrelated id leaves a flagged item untouched", async () => {
	const store = new TodoStore(repo, SESSION);
	const { id } = flaggedItem(store, "step", "f.ts");
	const other = store.add({ title: "not reviewed" });
	store.update(other.id, { status: "done" });
	await clearChangesRequestedIfResolved({ workspaceId: WS, sessionId: SESSION, id: other.id });
	expect(todoReviewRecord({ workspaceId: WS, sessionId: SESSION, id: other.id })).toBeUndefined();
	expect(todoReviewRecord({ workspaceId: WS, sessionId: SESSION, id })?.state).toBe(
		"changes_requested",
	);
});
