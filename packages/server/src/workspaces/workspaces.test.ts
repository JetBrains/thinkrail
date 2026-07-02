import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, listWorkspaces, removeWorkspace } from "./workspaces";

function gitOut(cwd: string, ...args: string[]): string {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
	return new TextDecoder().decode(r.stdout).trim();
}

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

test("createWorkspace cuts a fresh branch from baseRef and records it as the base", async () => {
	// A second branch with its own commit, so "branched from here" is verifiable by commit sha.
	git(repo, "branch", "feature/base");
	git(repo, "switch", "feature/base");
	writeFileSync(join(repo, "feature.txt"), "feature\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "feature commit");
	git(repo, "switch", "main");
	const baseSha = gitOut(repo, "rev-parse", "feature/base");

	const ws = await createWorkspace("p1", undefined, "feature/base");
	expect(ws.baseBranch).toBe("feature/base");
	// The worktree's new branch was cut from feature/base's tip, not main's.
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(baseSha);
	// And it's its own fresh local branch (not a detached checkout of the base).
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(ws.branch);
	expect(ws.branch).not.toBe("feature/base");
});

test("createWorkspace branches off a locally-present remote ref without a network fetch", async () => {
	// A bare remote whose main is already fetched locally as origin/main. Create off origin/main must
	// branch from the local remote-tracking ref (no `git fetch` on the critical path).
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "fetch", "origin"); // origin/main now present locally
	const originSha = gitOut(repo, "rev-parse", "origin/main");

	const ws = await createWorkspace("p1", undefined, "origin/main");
	expect(ws.baseBranch).toBe("origin/main");
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(originSha);
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(ws.branch);
});

test("removeWorkspace cleans up even when the worktree dir is already gone", async () => {
	const ws = await createWorkspace("p1");
	expect(listWorkspaces("p1")).toHaveLength(1);

	// Simulate drift: delete the worktree dir behind git's back so `git worktree remove` can't.
	rmSync(ws.worktreePath, { recursive: true, force: true });

	expect(() => removeWorkspace(ws.id)).not.toThrow();
	expect(listWorkspaces("p1")).toHaveLength(0);

	// git's worktree registration is pruned — no orphan left behind.
	const list = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(list.stdout)).not.toContain(ws.worktreePath);
});
