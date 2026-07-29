import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { changedFileArgs, diffBaseRef, resolveDiffRange } from "./diffScope";
import {
	gitDiffFile,
	gitStatus,
	listBranches,
	listCommits,
	numstatPath,
	prefetchBranch,
} from "./git";

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

/** Register the repo itself as workspace `w1` (branch = base = main) for the gitDiffFile tests. */
function seedWorkspace(extra: Partial<Workspace> = {}): void {
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
				...extra,
			},
		]),
	);
}

/** A commit on a `feature` branch off `main`, so the scopes have a real range to span. Returns its oid. */
function commitOnFeature(file: string, content: string, message: string): string {
	writeFileSync(join(repo, file), content);
	git(repo, "add", "-A");
	git(repo, "commit", "-m", message);
	return new TextDecoder()
		.decode(Bun.spawnSync(["git", "-C", repo, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout)
		.trim();
}

test("gitDiffFile returns both sides: base content vs worktree content (trailing newline intact)", () => {
	seedWorkspace();
	writeFileSync(join(repo, "README.md"), "# repo\n\nedited\n");
	const { original, modified } = gitDiffFile("w1", "README.md");
	expect(original).toBe("# repo\n");
	expect(modified).toBe("# repo\n\nedited\n");
});

test("gitDiffFile: untracked → empty original; deleted → empty modified", () => {
	seedWorkspace();
	writeFileSync(join(repo, "new.txt"), "fresh\n");
	const added = gitDiffFile("w1", "new.txt");
	expect(added.original).toBe("");
	expect(added.modified).toBe("fresh\n");

	rmSync(join(repo, "README.md"));
	const deleted = gitDiffFile("w1", "README.md");
	expect(deleted.original).toBe("# repo\n");
	expect(deleted.modified).toBe("");
});

test("gitStatus attaches per-file +/- counts, incl. untracked line counts", () => {
	seedWorkspace();
	// Base README.md is "# repo\n" (1 line): keep it, append two lines → +2 / −0.
	writeFileSync(join(repo, "README.md"), "# repo\nline two\nline three\n");
	writeFileSync(join(repo, "new.txt"), "a\nb\n"); // untracked, 2 lines

	const { changes } = gitStatus("w1");
	const readme = changes.find((c) => c.path === "README.md");
	expect(readme).toMatchObject({ status: "modified", added: 2, removed: 0 });
	const untracked = changes.find((c) => c.path === "new.txt");
	expect(untracked).toMatchObject({ status: "untracked", added: 2, removed: 0 });
});

test("gitStatus omits counts for untracked binary or oversized files (matches tracked binaries)", () => {
	seedWorkspace();
	// A binary untracked file (NUL byte in the head) → listed, but no count — like a tracked binary, which
	// `--numstat` reports as `-`/`-` and we skip. (Without the sniff this counted mojibake "lines".)
	writeFileSync(join(repo, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x0a, 0x0a]));
	// An oversized untracked text file (> 2 MiB) → no count, so a large artifact isn't re-read into memory
	// on every `git.status` tick.
	writeFileSync(join(repo, "big.txt"), `${"x".repeat(2 * 1024 * 1024 + 1)}\n`);
	// A small text untracked file still counts, to prove only the guarded cases drop out.
	writeFileSync(join(repo, "small.txt"), "one\ntwo\n");

	const { changes } = gitStatus("w1");
	const bin = changes.find((c) => c.path === "blob.bin");
	expect(bin).toMatchObject({ status: "untracked" });
	expect(bin?.added).toBeUndefined();
	expect(changes.find((c) => c.path === "big.txt")?.added).toBeUndefined();
	expect(changes.find((c) => c.path === "small.txt")).toMatchObject({ added: 2 });
});

test("numstatPath resolves rename/copy forms to the destination path", () => {
	expect(numstatPath("src/a.ts")).toBe("src/a.ts");
	expect(numstatPath("old.ts => new.ts")).toBe("new.ts");
	expect(numstatPath("src/{a => b}/x.ts")).toBe("src/b/x.ts");
});

test("gitDiffFile refuses a path escaping the worktree", () => {
	seedWorkspace();
	expect(() => gitDiffFile("w1", "../outside.txt")).toThrow("Path escapes the worktree");
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

test("diffBaseRef resolves the re-pointed diff target over the creation base", () => {
	expect(diffBaseRef({ baseBranch: "main" })).toBe("main");
	expect(diffBaseRef({ baseBranch: "main", diffBase: "origin/release" })).toBe("origin/release");
});

test("resolveDiffRange: one definition per scope (branch / uncommitted / commit)", () => {
	const ws = { baseBranch: "main", worktreePath: repo };

	// Default (and explicit `branch`): everything vs the diff base, ending at the worktree.
	expect(resolveDiffRange(ws)).toEqual(resolveDiffRange(ws, { kind: "branch" }));
	const branch = resolveDiffRange(ws, { kind: "branch" });
	expect(changedFileArgs(branch, "--name-status")).toEqual(["diff", "--name-status", "main"]);
	expect(branch).toMatchObject({ untracked: true, originalRef: "main", modifiedRef: null });
	// The re-pointed target is what a branch range spans.
	expect(resolveDiffRange({ ...ws, diffBase: "origin/release" }, { kind: "branch" })).toMatchObject(
		{
			listRevs: ["origin/release"],
			originalRef: "origin/release",
		},
	);

	// Uncommitted: worktree vs HEAD, untracked files included.
	const uncommitted = resolveDiffRange(ws, { kind: "uncommitted" });
	expect(changedFileArgs(uncommitted, "--numstat")).toEqual(["diff", "--numstat", "HEAD"]);
	expect(uncommitted).toMatchObject({ untracked: true, originalRef: "HEAD", modifiedRef: null });

	// One commit: `sha^` vs `sha`, both sides from history, no untracked files.
	const sha = commitOnFeature("second.txt", "second\n", "second");
	const commit = resolveDiffRange(ws, { kind: "commit", sha });
	const parent = commit.originalRef ?? "";
	expect(parent).toMatch(/^[0-9a-f]{40,}$/);
	expect(parent).not.toBe(sha);
	expect(commit).toMatchObject({ untracked: false, modifiedRef: sha, listRevs: [parent, sha] });
	// An abbreviated sha resolves to the same full-oid range.
	expect(resolveDiffRange(ws, { kind: "commit", sha: sha.slice(0, 8) })).toEqual(commit);
});

test("resolveDiffRange degrades a root commit to an add-style diff (no parent to subtract)", () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	const root = new TextDecoder()
		.decode(
			Bun.spawnSync(["git", "-C", repo, "rev-list", "--max-parents=0", "HEAD"], {
				stdout: "pipe",
			}).stdout,
		)
		.trim();
	const range = resolveDiffRange(ws, { kind: "commit", sha: root });
	expect(range).toMatchObject({ untracked: false, originalRef: null, modifiedRef: root });
	// `git show` (not `git diff`), since there is no `sha^` — the range's changed files are still listable.
	expect(changedFileArgs(range, "--name-status")).toEqual([
		"show",
		"--format=",
		"--name-status",
		root,
	]);
	const listed = Bun.spawnSync(["git", "-C", repo, ...changedFileArgs(range, "--name-status")], {
		stdout: "pipe",
	});
	expect(new TextDecoder().decode(listed.stdout)).toContain("README.md");
});

test("resolveDiffRange rejects a non-oid sha before it reaches git, and an unknown commit", () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	expect(() => resolveDiffRange(ws, { kind: "commit", sha: "--output=/tmp/pwn" })).toThrow(
		/Not a commit id/,
	);
	expect(() => resolveDiffRange(ws, { kind: "commit", sha: "HEAD" })).toThrow(/Not a commit id/);
	expect(() => resolveDiffRange(ws, { kind: "commit", sha: "deadbeef" })).toThrow(/Unknown commit/);
});

test("gitStatus scopes: branch spans the base range, uncommitted only the dirty worktree", () => {
	git(repo, "switch", "-c", "feature");
	commitOnFeature("committed.txt", "committed\n", "add committed.txt");
	seedWorkspace({ branch: "feature" });
	writeFileSync(join(repo, "dirty.txt"), "dirty\n");

	const branchPaths = gitStatus("w1").changes.map((c) => c.path);
	expect(branchPaths).toEqual(["committed.txt", "dirty.txt"]);

	const uncommitted = gitStatus("w1", { kind: "uncommitted" }).changes.map((c) => c.path);
	expect(uncommitted).toEqual(["dirty.txt"]);
});

test("gitStatus/gitDiffFile for a commit scope read only that commit, from history", () => {
	git(repo, "switch", "-c", "feature");
	commitOnFeature("script.ts", "export const one = 1;\n", "add script");
	const sha = commitOnFeature("script.ts", "export const two = 2;\n", "edit script");
	seedWorkspace({ branch: "feature" });
	// Worktree dirt (tracked + untracked) must not leak into a historical scope.
	writeFileSync(join(repo, "script.ts"), "export const three = 3;\n");
	writeFileSync(join(repo, "untracked.txt"), "nope\n");

	const scope = { kind: "commit", sha } as const;
	const changes = gitStatus("w1", scope).changes;
	expect(changes.map((c) => c.path)).toEqual(["script.ts"]);
	expect(changes[0]).toMatchObject({ status: "modified", added: 1, removed: 1 });

	expect(gitDiffFile("w1", "script.ts", scope)).toEqual({
		original: "export const one = 1;\n",
		modified: "export const two = 2;\n",
	});
});

test("gitStatus/listCommits measure against the re-pointed diffBase, not the creation base", () => {
	git(repo, "switch", "-c", "release");
	commitOnFeature("released.txt", "released\n", "release-only");
	git(repo, "switch", "-c", "feature");
	const sha = commitOnFeature("feature.txt", "feature\n", "feature-only");
	seedWorkspace({ branch: "feature", baseBranch: "main", diffBase: "release" });

	// vs `release`: only the feature commit's file (the release-only file is common to both).
	expect(gitStatus("w1").changes.map((c) => c.path)).toEqual(["feature.txt"]);
	const { commits } = listCommits("w1");
	expect(commits.map((c) => c.sha)).toEqual([sha]);
	expect(commits[0]).toMatchObject({ subject: "feature-only", author: "test" });
	expect(commits[0]?.shortSha).toBe(sha.slice(0, commits[0]?.shortSha.length));
	expect(commits[0]?.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

	// vs the creation base `main`: both commits' files, newest commit first.
	seedWorkspace({ branch: "feature", baseBranch: "main" });
	expect(gitStatus("w1").changes.map((c) => c.path)).toEqual(["feature.txt", "released.txt"]);
	expect(listCommits("w1").commits.map((c) => c.subject)).toEqual(["feature-only", "release-only"]);
});
