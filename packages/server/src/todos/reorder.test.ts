import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TodoChangedPayload } from "@thinkrail/contracts";
import { addTodo, listTodos, reorderTodos, setTodoPublisher, updateTodo } from "./todos";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const SESSION = "sess-queue";
const OTHER_SESSION = "sess-other";

function sh(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-todos-queue-"));
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
	setTodoPublisher(() => {});
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

const ws = { workspaceId: "w1", sessionId: SESSION };

test("added tasks persist in order, a valid reorder rewrites and re-reads deterministically, and mutations publish todo.changed", async () => {
	const published: TodoChangedPayload[] = [];
	setTodoPublisher((payload) => published.push(payload));

	const a = await addTodo({ ...ws, title: "user A" });
	const b = await addTodo({ ...ws, title: "user B" });
	const c = await addTodo({ ...ws, title: "user C" });
	expect((await listTodos(ws)).todos.map((t) => t.title)).toEqual(["user A", "user B", "user C"]);

	await reorderTodos({ ...ws, ids: [c.id, a.id, b.id] });
	expect((await listTodos(ws)).todos.map((t) => t.title)).toEqual(["user C", "user A", "user B"]);
	expect((await listTodos(ws)).todos.map((t) => t.title)).toEqual(["user C", "user A", "user B"]);

	expect(published).toHaveLength(4);
	expect(published.every((p) => p.workspaceId === "w1" && p.sessionId === SESSION)).toBe(true);
});

test("the server rejects reorders that cross the execution boundary or name a partial set", async () => {
	const a = await addTodo({ ...ws, title: "user A" });
	const b = await addTodo({ ...ws, title: "user B" });
	await updateTodo({ ...ws, id: a.id, status: "in_progress" });

	await expect(reorderTodos({ ...ws, ids: [b.id, a.id] })).rejects.toThrow();
	await expect(reorderTodos({ ...ws, ids: [] })).rejects.toThrow(/exactly once/);
	await expect(reorderTodos({ ...ws, ids: [b.id, "t_missing"] })).rejects.toThrow(/exactly once/);

	await updateTodo({ ...ws, id: a.id, status: "done" });
	await expect(reorderTodos({ ...ws, ids: [b.id, a.id] })).rejects.toThrow();
	expect((await listTodos(ws)).todos.map((t) => t.title)).toEqual(["user A", "user B"]);
});

test("queues are isolated per session in the same workspace", async () => {
	await addTodo({ ...ws, title: "session one task" });
	const other = { workspaceId: "w1", sessionId: OTHER_SESSION };
	const x = await addTodo({ ...other, title: "session two X" });
	const y = await addTodo({ ...other, title: "session two Y" });

	await reorderTodos({ ...other, ids: [y.id, x.id] });

	expect((await listTodos(ws)).todos.map((t) => t.title)).toEqual(["session one task"]);
	expect((await listTodos(other)).todos.map((t) => t.title)).toEqual([
		"session two Y",
		"session two X",
	]);
});
