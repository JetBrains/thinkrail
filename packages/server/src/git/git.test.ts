import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitStatus, listBranches, prefetchBranch } from "./git";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-git-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
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
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
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

test("prefetchBranch fetches a remote ref and no-ops on a local ref or unknown project", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");

	// A commit that only exists on the remote (pushed from a throwaway clone), so a successful prefetch is
	// observable: origin/main advances locally only if the fetch actually ran.
	const clone = join(dataDir, "clone");
	git(repo, "clone", remoteRepo, clone);
	// Pin the clone to `main` from origin/main rather than trusting its checked-out default branch — the
	// remote's default depends on the runner's `init.defaultBranch` (may be `master` on CI), which would
	// otherwise leave no local `main` for the push below.
	git(clone, "checkout", "-B", "main", "origin/main");
	git(clone, "config", "user.email", "t@thinkrail.test");
	git(clone, "config", "user.name", "test");
	writeFileSync(join(clone, "remote-only.txt"), "remote\n");
	git(clone, "add", "-A");
	git(clone, "commit", "-m", "remote-only");
	git(clone, "push", "origin", "main");

	const gitOut = (cwd: string, ...args: string[]): string =>
		new TextDecoder()
			.decode(Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe" }).stdout)
			.trim();
	const remoteTip = gitOut(remoteRepo, "rev-parse", "main");
	expect(gitOut(repo, "rev-parse", "origin/main")).not.toBe(remoteTip);

	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true });
	expect(gitOut(repo, "rev-parse", "origin/main")).toBe(remoteTip);

	// A local ref never touches the network; an unknown project can't fetch — both are quiet no-ops.
	expect(await prefetchBranch("p1", "main")).toEqual({ ok: false });
	expect(await prefetchBranch("nope", "origin/main")).toEqual({ ok: false });
});

test("gitStatus reads the Default workspace's branch live, not the persisted snapshot", () => {
	// A default-kind record whose persisted branch is already stale (the folder moved on).
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w-default",
				projectId: "p1",
				kind: "default",
				name: "Default",
				branch: "main", // stale — the checkout below moves to feature/live
				worktreePath: repo,
				baseBranch: "main",
				renamed: true,
			},
		]),
	);
	git(repo, "switch", "-c", "feature/live");
	expect(gitStatus("w-default").branch).toBe("feature/live");
});
