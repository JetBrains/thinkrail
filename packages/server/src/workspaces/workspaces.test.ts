import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, listWorkspaces, removeWorkspace } from "./workspaces";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_PI_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-ws-test-"));
	process.env.THINKRAIL_PI_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_PI_DATA_DIR;
	else process.env.THINKRAIL_PI_DATA_DIR = savedDataDir;
});

test("removeWorkspace cleans up even when the worktree dir is already gone", () => {
	const ws = createWorkspace("p1");
	expect(listWorkspaces("p1")).toHaveLength(1);

	// Simulate drift: delete the worktree dir behind git's back so `git worktree remove` can't.
	rmSync(ws.worktreePath, { recursive: true, force: true });

	expect(() => removeWorkspace(ws.id)).not.toThrow();
	expect(listWorkspaces("p1")).toHaveLength(0);

	// git's worktree registration is pruned — no orphan left behind.
	const list = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(list.stdout)).not.toContain(ws.worktreePath);
});
