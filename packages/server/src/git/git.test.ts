import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listBranches } from "./git";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_PI_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-git-test-"));
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

test("listBranches with no remote returns local branches and falls back to the repo HEAD", () => {
	git(repo, "branch", "feature/x");
	const { local, remote, defaultBranch } = listBranches("p1");
	expect(local.sort()).toEqual(["feature/x", "main"]);
	expect(remote).toEqual([]);
	expect(defaultBranch).toBe("main");
});

test("listBranches surfaces origin branches and the origin default", () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo); // `git -C repo init --bare <path>` inits at <path>
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	// Record origin's default branch so `symbolic-ref refs/remotes/origin/HEAD` resolves.
	git(repo, "remote", "set-head", "origin", "main");

	const { remote, defaultBranch } = listBranches("p1");
	expect(remote).toContain("origin/main");
	expect(remote).not.toContain("origin/HEAD");
	// `origin/HEAD` shortens to a bare `origin` — it must be filtered out (the symref drop), not listed.
	expect(remote).not.toContain("origin");
	expect(defaultBranch).toBe("origin/main");
});

test("listBranches throws on an unknown project", () => {
	expect(() => listBranches("nope")).toThrow(/Unknown project/);
});
