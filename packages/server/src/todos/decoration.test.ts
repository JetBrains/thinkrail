import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { gitCommitPaths } from "../git";
import { maybeAttachChangeArtifacts } from "./artifacts";
import { listTodos } from "./todos";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const SESSION = "sess-decor";

function sh(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-todos-decor-"));
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

test("listTodos decorates a commit artifact with the commit's derived files; a dead sha ships none", async () => {
	const store = new TodoStore(repo, SESSION);
	writeFileSync(join(repo, "impl.ts"), "export {};\n");
	const committed = gitCommitPaths("w1", "todo: step", ["impl.ts"]);
	if (!committed) throw new Error("commit failed");
	const good = store.add({
		title: "committed step",
		artifacts: [{ kind: "commit", sha: committed.sha, label: "committed step" }],
	});
	const dead = store.add({
		title: "gc'd step",
		artifacts: [{ kind: "commit", sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }],
	});

	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	const wireGood = plan.todos.find((t) => t.id === good.id);
	const wireDead = plan.todos.find((t) => t.id === dead.id);
	const files = wireGood?.artifacts?.[0]?.files;
	expect(wireGood?.artifacts?.[0]).toMatchObject({
		kind: "commit",
		sha: committed.sha,
		label: "committed step",
	});
	expect(files?.map((f) => ({ path: f.path, status: f.status }))).toEqual([
		{ path: "impl.ts", status: "added" },
	]);
	expect(files?.[0]?.added).toBe(1);
	expect(store.get(good.id)?.artifacts).toEqual([
		{ kind: "commit", sha: committed.sha, label: "committed step" },
	]);
	expect(wireDead?.artifacts).toEqual([
		{ kind: "commit", sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
	]);
});

test("listTodos waits for an in-flight reconcile — a done item is never read before its change set", async () => {
	const store = new TodoStore(repo, SESSION);
	const todo = store.add({ title: "step" });
	store.update(todo.id, { status: "in_progress" });
	await maybeAttachChangeArtifacts("w1", SESSION);
	writeFileSync(join(repo, "impl.ts"), "export {};\n");
	store.update(todo.id, { status: "done" });

	void maybeAttachChangeArtifacts("w1", SESSION);
	const plan = await listTodos({ workspaceId: "w1", sessionId: SESSION });

	const artifact = plan.todos.find((t) => t.id === todo.id)?.artifacts?.[0];
	expect(artifact).toMatchObject({ kind: "commit", label: "step" });
	expect(artifact?.files?.map((f) => f.path)).toEqual(["impl.ts"]);
});
