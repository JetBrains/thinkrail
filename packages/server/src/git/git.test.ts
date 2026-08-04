import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitDiffScope, Workspace } from "@thinkrail/contracts";
import { changedFileArgs, diffBaseRef, resolveDiffRange } from "./diffScope";
import {
	gitDiffFile,
	gitStatus,
	listBranches,
	listCommits,
	numstatPath,
	prefetchBranch,
	tryCurrentBranch,
} from "./git";
import { gitArgv, gitAsync, REMOTE_ENV } from "./gitExec";
import { isSafeRef } from "./refs";

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

/**
 * Put the repo into a real merge conflict on `file`: two branches each change the SAME line, so the merge
 * is a genuine content conflict (`CONFLICT (content)`, `git status` prints `UU <file>`) with all three
 * stages present — verified empirically to be the shape where `git diff --name-status` (no revs) prints
 * *two* rows for the one path (a generic `U` marker plus a real comparison against stage 2), unlike a
 * modify/delete conflict, which prints only one. Leaves the repo checked out on `conflict-a` with the
 * failed merge still in progress, and seeds workspace `w1` on it. Returns `file`.
 */
function conflictedMerge(file: string): string {
	writeFileSync(join(repo, file), "base\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", `${file}: base`);
	git(repo, "switch", "-c", "conflict-a");
	writeFileSync(join(repo, file), "a-version\n");
	git(repo, "commit", "-am", "a change");
	git(repo, "switch", "main");
	git(repo, "switch", "-c", "conflict-b");
	writeFileSync(join(repo, file), "b-version\n");
	git(repo, "commit", "-am", "b change");
	git(repo, "switch", "conflict-a");
	// The merge is EXPECTED to fail (that's the whole point of the fixture) — the throwing `git()` helper
	// would blow up on it, so spawn directly and ignore the exit code.
	Bun.spawnSync(["git", "-C", repo, "merge", "conflict-b"], { stdout: "ignore", stderr: "ignore" });
	seedWorkspace({ branch: "conflict-a" });
	return file;
}

/**
 * Put the repo into a real modify/delete conflict on `file`: our side deletes it, theirs modifies it, so
 * the merge fails with `CONFLICT (modify/delete)` and the index has stages 1 (base) and 3 (theirs) but no
 * stage 2 ("ours") — verified empirically: `git show :2:<path>` itself fails with "is in the index, but not
 * at stage 2" (a real git message, not a guess). Leaves the repo checked out on `delete-ours` with the
 * failed merge still in progress, and seeds workspace `w1` on it. Returns `file`.
 */
function conflictedModifyDelete(file: string): string {
	writeFileSync(join(repo, file), "base\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", `${file}: base`);
	git(repo, "switch", "-c", "delete-ours");
	git(repo, "rm", file);
	git(repo, "commit", "-m", "we delete it");
	git(repo, "switch", "main");
	git(repo, "switch", "-c", "modify-theirs");
	writeFileSync(join(repo, file), "modified\n");
	git(repo, "commit", "-am", "they modify it");
	git(repo, "switch", "delete-ours");
	// The merge is EXPECTED to fail (that's the whole point of the fixture) — the throwing `git()` helper
	// would blow up on it, so spawn directly and ignore the exit code.
	Bun.spawnSync(["git", "-C", repo, "merge", "modify-theirs"], {
		stdout: "ignore",
		stderr: "ignore",
	});
	seedWorkspace({ branch: "delete-ours" });
	return file;
}

test("a conflicted (unmerged) path is listed exactly once in working-tree scope", () => {
	// Regression pin: `git diff --name-status` (the working-tree list command) prints TWO rows for one
	// unmerged path (`U` then `M`) — without a dedupe, the Changes list renders the file twice and
	// `ChangesPanel`'s `<li key={change.path}>` collides.
	const file = conflictedMerge("f.txt");
	const matches = gitStatus("w1", { kind: "working-tree" }).changes.filter((c) => c.path === file);
	expect(matches).toHaveLength(1);
});

test("a conflicted path's working-tree diff has a real (non-empty) original side, not an add-style lie", () => {
	// `git show :<path>` (stage 0) fails for an unmerged path — "is in the index, but not at stage 0" — so an
	// original side that just accepts that failure as empty renders the file as a whole-file ADDITION, a
	// false claim about a conflicted file. Stage 2 ("ours") is real content that must be read instead.
	const file = conflictedMerge("f.txt");
	const { original } = gitDiffFile("w1", file, { kind: "working-tree" });
	expect(original).not.toBe("");
});

test("reading a conflicted path never spams console.warn", () => {
	// `showIndexBlob`'s expected-absence regex must recognise "is in the index, but not at stage 0" — the
	// message `git show :<path>` prints for an unmerged path — as expected, not a broken read.
	const file = conflictedMerge("f.txt");
	const warnings: string[] = [];
	const realWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.join(" "));
	};
	try {
		gitStatus("w1", { kind: "working-tree" });
		gitDiffFile("w1", file, { kind: "working-tree" });
	} finally {
		console.warn = realWarn;
	}
	expect(warnings).toEqual([]);
});

test("a modify/delete conflict (no stage 2) reads as an honest empty index side, with no console.warn", () => {
	// Regression pin: `showIndexBlob`'s stage-2 retry can itself fail — "is in the index, but not at stage
	// 2" — for a path our side deleted. Before `isExpectedAbsence`'s stage clause was generalised to `\d`,
	// that retry failure didn't match the (stage-0-only) regex, so it fell through to `console.warn` even
	// though an empty side here is the honest answer, not a broken read.
	const file = conflictedModifyDelete("f.txt");
	const warnings: string[] = [];
	const realWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.join(" "));
	};
	try {
		const workingTree = gitDiffFile("w1", file, { kind: "working-tree" });
		const staged = gitDiffFile("w1", file, { kind: "staged" });
		expect(workingTree.original).toBe("");
		expect(staged.modified).toBe("");
	} finally {
		console.warn = realWarn;
	}
	expect(warnings).toEqual([]);
});

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

test("tryCurrentBranch distinguishes a detached checkout from an invalid workspace root", () => {
	expect(tryCurrentBranch(repo)).toBe("main");
	git(repo, "switch", "--detach");
	expect(tryCurrentBranch(repo)).toBe("HEAD");
	const nested = join(repo, "nested");
	mkdirSync(nested);
	expect(tryCurrentBranch(nested)).toBeNull();
	expect(tryCurrentBranch(join(dataDir, "missing"))).toBeNull();
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

	// The fetch advances the local remote-tracking ref → `moved` (the handler's fanout trigger).
	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: true });
	expect(gitOut(repo, "rev-parse", "origin/main")).toBe(remoteTip);

	// Fetching again with nothing new is ok but NOT a move — no invalidation fans out for a no-op fetch.
	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: false });

	// A ref's *first appearance* counts as moved: siblings measuring against it were failing their reads.
	git(repo, "update-ref", "-d", "refs/remotes/origin/main");
	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: true });

	// Move detection reads the FULLY-QUALIFIED remote-tracking ref: a local branch literally named
	// `origin/main` sits earlier in git's DWIM resolution (`refs/heads/…`) and never moves on a fetch — it
	// must not shadow the comparison into a missed nudge.
	git(repo, "update-ref", "refs/heads/origin/main", "HEAD");
	writeFileSync(join(clone, "remote-only-2.txt"), "more\n");
	git(clone, "add", "-A");
	git(clone, "commit", "-m", "remote-only-2");
	git(clone, "push", "origin", "main");
	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: true });
	git(repo, "update-ref", "-d", "refs/heads/origin/main");

	// A local ref never touches the network; an unknown project can't fetch — both are quiet no-ops.
	expect(await prefetchBranch("p1", "main")).toEqual({ ok: false, moved: false });
	expect(await prefetchBranch("nope", "origin/main")).toEqual({ ok: false, moved: false });
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

test("gitStatus reads an external workspace's branch live, not the persisted snapshot", () => {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w-external",
				projectId: "p1",
				kind: "external",
				name: "existing checkout",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
				renamed: true,
			},
		]),
	);
	git(repo, "switch", "-c", "feature/external-live");
	expect(gitStatus("w-external").branch).toBe("feature/external-live");
});

test("diffBaseRef resolves the re-pointed diff target over the creation base", () => {
	expect(diffBaseRef({ baseBranch: "main" })).toBe("main");
	expect(diffBaseRef({ baseBranch: "main", diffBase: "origin/release" })).toBe("origin/release");
});

test("resolveDiffRange: one definition per scope (branch / commit)", () => {
	const ws = { baseBranch: "main", worktreePath: repo };

	// Default (and explicit `branch`): what the workspace changed since diverging from the diff base —
	// the range starts at the MERGE-BASE of base and HEAD (here HEAD is on main, so it's main's tip oid),
	// never at the base ref's own tip.
	expect(resolveDiffRange(ws)).toEqual(resolveDiffRange(ws, { kind: "branch" }));
	const branch = resolveDiffRange(ws, { kind: "branch" });
	const forkPoint = branch.original.kind === "ref" ? branch.original.ref : "";
	expect(forkPoint).toMatch(/^[0-9a-f]{40,}$/);
	// `--end-of-options` brackets the revs so a flag-shaped ref can't be parsed as one; the trailing `--`
	// closes the other side, so a rev that also names a path isn't an "ambiguous argument".
	expect(changedFileArgs(branch, "--name-status")).toEqual([
		"diff",
		"--name-status",
		"--end-of-options",
		forkPoint,
		"--",
	]);
	expect(branch).toMatchObject({
		untracked: true,
		listRevs: [forkPoint],
		modified: { kind: "worktree" },
	});
	// The re-pointed target is what a branch range spans — and a target with no merge-base to resolve
	// (this ref doesn't exist here) FALLS BACK to the raw ref, preserving the old error surfaces: a
	// missing base still fails the downstream diff loudly instead of reading as "no changes".
	expect(resolveDiffRange({ ...ws, diffBase: "origin/release" }, { kind: "branch" })).toMatchObject(
		{
			listRevs: ["origin/release"],
			original: { kind: "ref", ref: "origin/release" },
		},
	);

	// One commit: `sha^` vs `sha`, both sides from history, no untracked files.
	const sha = commitOnFeature("second.txt", "second\n", "second");
	const commit = resolveDiffRange(ws, { kind: "commit", sha });
	const parent = commit.original.kind === "ref" ? commit.original.ref : "";
	expect(parent).toMatch(/^[0-9a-f]{40,}$/);
	expect(parent).not.toBe(sha);
	expect(commit).toMatchObject({
		untracked: false,
		modified: { kind: "ref", ref: sha },
		listRevs: [parent, sha],
	});
	// An abbreviated sha resolves to the same full-oid range.
	expect(resolveDiffRange(ws, { kind: "commit", sha: sha.slice(0, 8) })).toEqual(commit);

	// Pinned: one IMMUTABLE commit vs the worktree — the review sidebar's base-side navigation. Same
	// shape/existence validation as `commit`, but the WORKTREE is the modified side (untracked included).
	const pinned = resolveDiffRange(ws, { kind: "pinned", baseRef: sha });
	expect(pinned).toMatchObject({
		untracked: true,
		original: { kind: "ref", ref: sha },
		modified: { kind: "worktree" },
		listRevs: [sha],
	});
	expect(resolveDiffRange(ws, { kind: "pinned", baseRef: sha.slice(0, 8) })).toEqual(pinned);
	expect(() => resolveDiffRange(ws, { kind: "pinned", baseRef: "--output=x" })).toThrow(
		/Not a commit id/,
	);
	expect(() => resolveDiffRange(ws, { kind: "pinned", baseRef: "deadbeefcafe" })).toThrow(
		/Unknown commit/,
	);
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
	expect(range).toMatchObject({
		untracked: false,
		original: { kind: "empty" },
		modified: { kind: "ref", ref: root },
	});
	// `git show` (not `git diff`), since there is no `sha^` — the range's changed files are still listable.
	expect(changedFileArgs(range, "--name-status")).toEqual([
		"show",
		"--format=",
		"--name-status",
		"--end-of-options",
		root,
		"--",
	]);
	const listed = Bun.spawnSync(["git", "-C", repo, ...changedFileArgs(range, "--name-status")], {
		stdout: "pipe",
	});
	expect(new TextDecoder().decode(listed.stdout)).toContain("README.md");
});

test("resolveDiffRange: an unrecognised scope kind resolves to the branch range, deliberately", () => {
	// A kind this host doesn't know — e.g. a client ahead of the host, or a persisted/replayed scope from a
	// future version. This value arrives from outside the type system, so the cast is deliberate: it models
	// an out-of-band value, not a shortcut around the type checker for one we could construct honestly.
	// `apps/web/src/store/selectors.test.ts`'s degradation test does the same, through `unknown`, never `any`.
	const ws = { baseBranch: "main", worktreePath: repo };
	const futureScope = { kind: "future-scope" } as unknown as GitDiffScope;
	expect(resolveDiffRange(ws, futureScope)).toEqual(resolveDiffRange(ws, { kind: "branch" }));
});

test("resolveDiffRange rejects a non-oid sha before it reaches git, and an unknown commit", () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	expect(() => resolveDiffRange(ws, { kind: "commit", sha: "--output=/tmp/pwn" })).toThrow(
		/Not a commit id/,
	);
	expect(() => resolveDiffRange(ws, { kind: "commit", sha: "HEAD" })).toThrow(/Not a commit id/);
	expect(() => resolveDiffRange(ws, { kind: "commit", sha: "deadbeef" })).toThrow(/Unknown commit/);
});

test("working-tree scope diffs the index against the worktree, including untracked", () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	const range = resolveDiffRange(ws, { kind: "working-tree" });
	expect(range.listPrefix).toEqual(["diff"]);
	expect(range.listRevs).toEqual([]);
	expect(range.untracked).toBe(true);
	expect(range.original).toEqual({ kind: "index" });
	expect(range.modified).toEqual({ kind: "worktree" });
});

test("staged scope diffs HEAD against the index and excludes untracked", () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	const range = resolveDiffRange(ws, { kind: "staged" });
	expect(range.listPrefix).toEqual(["diff", "--cached"]);
	expect(range.listRevs).toEqual(["HEAD"]);
	expect(range.untracked).toBe(false);
	expect(range.original).toEqual({ kind: "ref", ref: "HEAD" });
	expect(range.modified).toEqual({ kind: "index" });
});

test("DiffSide: a branch scope reads a ref against the worktree", () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	const range = resolveDiffRange(ws, { kind: "branch" });
	expect(range.original.kind).toBe("ref");
	expect(range.modified).toEqual({ kind: "worktree" });
});

test("DiffSide: a root commit's original side is empty, not a ref", () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	const root = new TextDecoder()
		.decode(
			Bun.spawnSync(["git", "-C", repo, "rev-list", "--max-parents=0", "HEAD"], {
				stdout: "pipe",
			}).stdout,
		)
		.trim();
	const range = resolveDiffRange(ws, { kind: "commit", sha: root });
	expect(range.original).toEqual({ kind: "empty" });
	expect(range.modified).toEqual({ kind: "ref", ref: root });
});

test("gitStatus scopes: branch spans the base range, working-tree only the dirty worktree", () => {
	git(repo, "switch", "-c", "feature");
	commitOnFeature("committed.txt", "committed\n", "add committed.txt");
	seedWorkspace({ branch: "feature" });
	writeFileSync(join(repo, "dirty.txt"), "dirty\n");

	const branchPaths = gitStatus("w1").changes.map((c) => c.path);
	expect(branchPaths).toEqual(["committed.txt", "dirty.txt"]);

	const workingTree = gitStatus("w1", { kind: "working-tree" }).changes.map((c) => c.path);
	expect(workingTree).toEqual(["dirty.txt"]);
});

test("staged and working-tree split a partially-staged worktree", () => {
	seedWorkspace();
	writeFileSync(join(repo, "staged-only.txt"), "staged\n");
	git(repo, "add", "staged-only.txt");
	writeFileSync(join(repo, "README.md"), "dirty, unstaged\n");

	const staged = gitStatus("w1", { kind: "staged" }).changes.map((c) => c.path);
	const working = gitStatus("w1", { kind: "working-tree" }).changes.map((c) => c.path);

	expect(staged).toContain("staged-only.txt");
	expect(staged).not.toContain("README.md");
	expect(working).toContain("README.md");
	expect(working).not.toContain("staged-only.txt");
});

test("a staged file's diff sides read HEAD and the index, not the dirty worktree", () => {
	seedWorkspace();
	writeFileSync(join(repo, "README.md"), "staged content\n");
	git(repo, "add", "README.md");
	writeFileSync(join(repo, "README.md"), "later worktree edit\n");

	const staged = gitDiffFile("w1", "README.md", { kind: "staged" });
	expect(staged.modified).toBe("staged content\n");
	expect(staged.modified).not.toBe("later worktree edit\n");

	const working = gitDiffFile("w1", "README.md", { kind: "working-tree" });
	expect(working.original).toBe("staged content\n");
	expect(working.modified).toBe("later worktree edit\n");
});

test("a staged deletion reads as an empty modified side, without warning", () => {
	// This is the case that makes `showIndexBlob`'s expected-absence detection load-bearing: `git show
	// :<path>` for a staged deletion prints `fatal: path 'x' does not exist (neither on disk nor in the
	// index)`. If that is not recognised as an expected absence, every ordinary staged deletion logs a
	// warning — burying the real broken-read signal the warning exists for.
	//
	// The fixture's own committed file (README.md) stands in for the brief's `notes.txt`, which this
	// suite's `beforeEach` never seeds.
	seedWorkspace();
	git(repo, "rm", "-q", "README.md");

	const warnings: string[] = [];
	const realWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.join(" "));
	};
	try {
		const staged = gitDiffFile("w1", "README.md", { kind: "staged" });
		expect(staged.original).not.toBe(""); // it existed at HEAD
		expect(staged.modified).toBe(""); // gone from the index — the deletion
	} finally {
		console.warn = realWarn;
	}
	expect(warnings).toEqual([]);
});

test("branch scope measures from the merge-base: upstream commits on the base are never phantom changes", () => {
	git(repo, "switch", "-c", "feature");
	commitOnFeature("feature.txt", "feature\n", "feature work");
	// The base advances AFTER the branch forked — upstream work landing on main (or a fetch moving it).
	git(repo, "switch", "main");
	writeFileSync(join(repo, "upstream.txt"), "upstream\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "upstream work");
	git(repo, "switch", "feature");
	seedWorkspace({ branch: "feature" });

	// Tip semantics would list upstream.txt as a phantom deletion; the merge-base range shows only the
	// workspace's own work — agreeing with listCommits' `base..HEAD`, which was always ancestry-based.
	expect(gitStatus("w1").changes.map((c) => c.path)).toEqual(["feature.txt"]);
	expect(listCommits("w1").commits.map((c) => c.subject)).toEqual(["feature work"]);
	// The per-file read agrees: the original side comes from the fork point, where the file didn't exist.
	expect(gitDiffFile("w1", "feature.txt")).toEqual({ original: "", modified: "feature\n" });
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

test("listCommits: a subject carrying the field separator can't shift author or timestamp", () => {
	git(repo, "switch", "-c", "feature");
	// The separator is a control char, but `%s` is repository-controlled and can contain it — the format's
	// field order (structured head, free-text tail) is what actually keeps the later fields in place.
	writeFileSync(join(repo, "spoof.txt"), "spoof\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "subject\u001fnot-the-author\u001f1999-01-01T00:00:00+00:00");
	seedWorkspace({ branch: "feature" });

	const commit = listCommits("w1").commits[0];
	expect(commit?.author).toBe("test"); // the real author, not the injected one
	expect(commit?.committedAt).not.toContain("1999"); // a real timestamp, so no NaN relative time
	expect(Number.isFinite(Date.parse(commit?.committedAt ?? ""))).toBe(true);
	// The whole subject survives, minus the control chars we never put on the wire.
	expect(commit?.subject).toBe("subjectnot-the-author1999-01-01T00:00:00+00:00");
});

test("an option-shaped ref reaches git as a rev, never as an option", () => {
	// `git update-ref` accepts a name the `git branch` porcelain refuses, so this ref is reachable from any
	// untrusted repo via `for-each-ref` → the BranchPicker. isSafeRef closes the mutation doors; the read
	// sites' `--end-of-options` is the second line of defense for a ref already persisted.
	const probe = join(dataDir, "pwn-probe.txt");
	git(repo, "update-ref", `refs/heads/--output=${probe}`, "HEAD");
	expect(isSafeRef(`--output=${probe}`)).toBe(false);
	expect(listBranches("p1").local).toContain(`--output=${probe}`);

	seedWorkspace({ diffBase: `--output=${probe}` });
	// It reaches git as a REV (this one resolves — the crafted ref points at HEAD, hence an empty diff), never
	// as an option: the file the "ref" names is not written. A *failed* read is asserted separately, where it
	// throws rather than reading as a clean worktree.
	expect(gitStatus("w1").changes).toEqual([]);
	expect(listCommits("w1").commits).toEqual([]);
	expect(existsSync(probe)).toBe(false);
});

test("isSafeRef accepts real refs and refuses anything git could re-read as more than a name", () => {
	for (const ok of [
		"main",
		"origin/main",
		"release-1.2",
		"feature/a_b",
		"HEAD",
		// Long, but every component is a name git accepts — `check-ref-format` caps no length, so neither do
		// we: such a branch is listable by `for-each-ref`, hence selectable as a base or a diff target.
		`feature/${"a".repeat(200)}/${"b".repeat(200)}`,
	])
		expect(isSafeRef(ok)).toBe(true);
	for (const bad of [
		"",
		"-main",
		"--output=/tmp/x",
		"main..HEAD",
		"main^",
		"main~1",
		"main:path",
		"with space",
		"tab\there",
		"ctrl\u001fchar",
		// Revision metadata git itself refuses inside a ref name — `check-ref-format`'s rules, reproduced.
		"main@{yesterday}",
		"@{u}",
		"@",
		"main.lock",
		"refs/heads/.hidden",
		"a//b",
		"/main",
		"main/",
		"main.",
	])
		expect(isSafeRef(bad)).toBe(false);
});

test("listCommits: a crafted AUTHOR name can't shift the timestamp or truncate itself", () => {
	git(repo, "switch", "-c", "feature");
	// `%an` is free text too, and it sits *between* the structured fields and the subject — the earlier
	// "structured fields first" framing did not protect it: an author carrying the old `\u001f` separator
	// shifted the subject one field over and truncated the author. NUL-separated fields of fixed arity do.
	writeFileSync(join(repo, "spoof.txt"), "spoof\n");
	git(repo, "add", "-A");
	git(
		repo,
		"-c",
		"user.name=ev\u001fil\u001f1999-01-01T00:00:00+00:00",
		"-c",
		"user.email=e@thinkrail.test",
		"commit",
		"-m",
		"real subject",
	);
	seedWorkspace({ branch: "feature" });

	const commit = listCommits("w1").commits[0];
	expect(commit?.author).toBe("evil1999-01-01T00:00:00+00:00"); // whole name, control chars stripped
	expect(commit?.subject).toBe("real subject"); // not shifted by the injected separators
	expect(commit?.committedAt).not.toContain("1999");
	expect(Number.isFinite(Date.parse(commit?.committedAt ?? ""))).toBe(true);
});

test("plainText strips invisible deception (bidi overrides, zero-width) from repo text", () => {
	git(repo, "switch", "-c", "feature");
	writeFileSync(join(repo, "bidi.txt"), "bidi\n");
	git(repo, "add", "-A");
	// A right-to-left override can make a subject *render* as something else entirely; a zero-width space
	// hides inside a name. Both go before the wire, while ordinary non-ASCII text stays.
	git(repo, "commit", "-m", "fix\u202egnisrever\u202c pa\u200bth — caf\u00e9 \u2713");
	seedWorkspace({ branch: "feature" });

	expect(listCommits("w1").commits[0]?.subject).toBe("fixgnisrever path — café ✓");
});

test("a base ref that also names a path still lists changes (the trailing `--`)", () => {
	// A branch and a file with the same name is an "ambiguous argument" for `git diff <rev>` — which used to
	// fail the whole read and surface as NO CHANGES. The `--` after the revs settles it as a rev.
	writeFileSync(join(repo, "docs"), "a file called docs\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "add a file named docs");
	git(repo, "branch", "docs");
	git(repo, "switch", "-c", "feature");
	commitOnFeature("feature.txt", "feature\n", "feature work");
	seedWorkspace({ branch: "feature", baseBranch: "docs" });

	expect(gitStatus("w1").changes.map((c) => c.path)).toEqual(["feature.txt"]);
	expect(listCommits("w1").commits.map((c) => c.subject)).toEqual(["feature work"]);
});

test("a failed diff throws — a broken read is never reported as a clean worktree", () => {
	seedWorkspace({ diffBase: "no-such-branch" });
	writeFileSync(join(repo, "dirty.txt"), "dirty\n");
	expect(() => gitStatus("w1")).toThrow(/Could not read the changed files/);
});

test("gitArgv puts --no-optional-locks before the subcommand, unconditionally", () => {
	// The flag is git-level, not subcommand-level: after the subcommand git rejects it. Asserting the exact
	// argv pins both its presence and its position — a behavioural assertion on `.ok` would pass whether or
	// not the flag were ever added. There is no opt-out: every writer this repo has succeeds under it, so
	// the flag is unconditional (see the SPEC / gitArgv doc comment).
	expect(gitArgv("/w", ["status", "--porcelain"])).toEqual([
		"git",
		"-C",
		"/w",
		"--no-optional-locks",
		"status",
		"--porcelain",
	]);
});

test("gitAsync kills a child that outlives its deadline and reports a failure", async () => {
	// `git hash-object --stdin` does NOT hang under this runner: Bun's default (inherited) stdin is already
	// at EOF inside `bun test` here, so the command returns in ~15ms with no timeout in play at all — a
	// vacuous test that would pass whether or not a deadline existed. `git ls-remote` against a black-holed
	// address (a reserved, non-routable IP: packets are silently dropped, no RST/ICMP) genuinely blocks —
	// verified empirically to still be running 3s in with no timeout implemented, and to die within ~150ms
	// of `proc.kill()`. It also matches the feature this primitive is for: a network probe against a remote
	// that never answers.
	const result = await gitAsync(repo, ["ls-remote", "http://10.255.255.1/x.git"], {
		timeoutMs: 150,
	});
	expect(result.ok).toBe(false);
	expect(result.err).toContain("timed out");
});

test("gitAsync still resolves normally well inside its deadline", async () => {
	const result = await gitAsync(repo, ["rev-parse", "--git-dir"], { timeoutMs: 10_000 });
	expect(result.ok).toBe(true);
	expect(result.out.length).toBeGreaterThan(0);
});

test("REMOTE_ENV disables every git-level prompt path", () => {
	expect(REMOTE_ENV.GIT_TERMINAL_PROMPT).toBe("0");
	expect(REMOTE_ENV.GIT_ASKPASS).toBe("");
	expect(REMOTE_ENV.SSH_ASKPASS).toBe("");
	expect(REMOTE_ENV.GIT_SSH_COMMAND).toContain("BatchMode=yes");
});

test("gitAsync's opts.env MERGES over process.env rather than replacing it", async () => {
	// Bun resolves the `git` binary using its OWN process's lookup, not the child's `env` — so a bare
	// `env: opts.env` (replacing, not merging) does NOT fail to find `git`, which would make a PATH-based
	// regression test pass vacuously either way (verified empirically before writing this test). HOME is a
	// real, observable difference instead: this repo has NO local `user.*` config, so `git config --get
	// user.name` can only succeed via a GLOBAL `~/.gitconfig` — which git can only find if HOME survives
	// into the child's env. Replacing (stripping HOME) makes this fail; merging (keeping the live HOME
	// alongside the override) makes it succeed.
	const noIdentityRepo = join(dataDir, "no-identity-repo");
	mkdirSync(noIdentityRepo);
	git(noIdentityRepo, "init", "-b", "main");
	const tempHome = join(dataDir, "temp-home");
	mkdirSync(tempHome);
	writeFileSync(join(tempHome, ".gitconfig"), "[user]\n\tname = home user\n");

	const savedHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		// Any truthy opts.env takes the merge branch; MARKER itself is irrelevant to the outcome.
		const result = await gitAsync(noIdentityRepo, ["config", "--get", "user.name"], {
			env: { MARKER: "1" },
		});
		expect(result.ok).toBe(true);
		expect(result.out).toBe("home user");
	} finally {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
	}
});
