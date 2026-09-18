import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { gitCommitPaths } from "../git";
import { approveTodoReview, listTodos, startTodoReview } from "./todos";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const SESSION = "sess-adopt";

function sh(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function headSha(cwd: string): string {
	const r = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "HEAD"]);
	return r.stdout.toString().trim();
}

function commitFile(name: string, body: string, subject: string): string {
	writeFileSync(join(repo, name), body);
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", subject);
	return headSha(repo);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-todos-adopt-"));
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
	sh(repo, "checkout", "-b", "feature");
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
				branch: "feature",
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

test("a branch commit no item owns surfaces as an adopted, unreviewed commit — even with an empty plan", async () => {
	const sha = commitFile("loose.ts", "export const a = 1;\n", "feat: loose work");

	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });

	expect(plan.todos).toEqual([]);
	expect(plan.groups).toEqual([]);
	expect(plan.adoptedCommits?.length).toBe(1);
	const adopted = plan.adoptedCommits?.[0];
	expect(adopted?.id).toBe(`commit:${sha}`);
	expect(adopted?.origin).toBe("adopted");
	expect(adopted?.status).toBe("done");
	expect(adopted?.title).toBe("feat: loose work");
	expect(adopted?.artifacts?.[0]).toMatchObject({ kind: "commit", sha });
	expect(adopted?.artifacts?.[0]?.files?.map((f) => f.path)).toEqual(["loose.ts"]);
	expect(adopted?.review?.state).toBe("unreviewed");
});

test("a commit owned by a todo item is NOT adopted (no double-counting)", async () => {
	const store = new TodoStore(repo, SESSION);
	writeFileSync(join(repo, "owned.ts"), "export const b = 2;\n");
	const owned = gitCommitPaths("w1", "feat: owned step", ["owned.ts"]);
	if (!owned) throw new Error("commit failed");
	store.add({
		title: "owned step",
		artifacts: [{ kind: "commit", sha: owned.sha, label: "owned step" }],
	});
	const looseSha = commitFile("loose.ts", "export const a = 1;\n", "feat: loose work");

	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });

	const adoptedShas = (plan.adoptedCommits ?? []).map((t) => t.artifacts?.[0]?.sha);
	expect(adoptedShas).toEqual([looseSha]);
});

test("an adopted commit is reviewable by its commit:<sha> id and settles like an item", async () => {
	const sha = commitFile("loose.ts", "export const a = 1;\n", "feat: loose work");
	const id = `commit:${sha}`;

	const started = startTodoReview({ workspaceId: "w1", sessionId: SESSION, id });
	expect(started.pkg).toContain(sha.slice(0, 12));
	expect(started.reviewedSha).toBe(sha);

	const reviewing = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(reviewing.adoptedCommits?.[0]?.review?.reviewing).toBe(true);

	approveTodoReview({ workspaceId: "w1", sessionId: SESSION, id });

	const settled = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(settled.adoptedCommits?.[0]?.review?.state).toBe("reviewed");
});

test("review resolution rejects a commit:<sha> outside base..HEAD or owned by an item", () => {
	const baseSha = headSha(repo);
	expect(() =>
		startTodoReview({ workspaceId: "w1", sessionId: SESSION, id: `commit:${baseSha}` }),
	).toThrow(/No TODO with id/);

	const store = new TodoStore(repo, SESSION);
	writeFileSync(join(repo, "owned.ts"), "export const b = 2;\n");
	const owned = gitCommitPaths("w1", "feat: owned step", ["owned.ts"]);
	if (!owned) throw new Error("commit failed");
	store.add({
		title: "owned step",
		artifacts: [{ kind: "commit", sha: owned.sha, label: "owned step" }],
	});
	expect(() =>
		startTodoReview({ workspaceId: "w1", sessionId: SESSION, id: `commit:${owned.sha}` }),
	).toThrow(/No TODO with id/);
});

test("review resolution rejects an abbreviated commit:<short-sha> id", () => {
	const sha = commitFile("loose.ts", "export const a = 1;\n", "feat: loose work");
	expect(() =>
		startTodoReview({ workspaceId: "w1", sessionId: SESSION, id: `commit:${sha.slice(0, 10)}` }),
	).toThrow(/No TODO with id/);
	expect(() =>
		startTodoReview({ workspaceId: "w1", sessionId: SESSION, id: `commit:${sha}` }),
	).not.toThrow();
});

test("review resolution rejects a commit past the newest-200 listCommits cap", () => {
	const oldest = commitFile("first.ts", "export const f = 0;\n", "feat: first");
	const loop = Bun.spawnSync([
		"bash",
		"-c",
		`for i in $(seq 1 200); do git -C "${repo}" commit --allow-empty -m e$i -q; done`,
	]);
	if (!loop.success) throw new Error("bulk commits failed");
	const newest = headSha(repo);
	expect(() =>
		startTodoReview({ workspaceId: "w1", sessionId: SESSION, id: `commit:${oldest}` }),
	).toThrow(/No TODO with id/);
	expect(() =>
		startTodoReview({ workspaceId: "w1", sessionId: SESSION, id: `commit:${newest}` }),
	).not.toThrow();
});
