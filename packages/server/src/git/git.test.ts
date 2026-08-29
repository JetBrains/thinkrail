import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { changedFileArgs, diffBaseRef, resolveDiffRange } from "./diffScope";
import {
	countUnpushedCommits,
	gitCommitPaths,
	gitDiffFile,
	gitHeadSha,
	gitStatus,
	listBranches,
	listCommits,
	numstatPath,
	prefetchBranch,
	tryCurrentBranch,
} from "./git";
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

function commitOnFeature(file: string, content: string, message: string): string {
	writeFileSync(join(repo, file), content);
	git(repo, "add", "-A");
	git(repo, "commit", "-m", message);
	return new TextDecoder()
		.decode(Bun.spawnSync(["git", "-C", repo, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout)
		.trim();
}

test("gitDiffFile returns both sides: base content vs worktree content (trailing newline intact)", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "README.md"), "# repo\n\nedited\n");
	const { original, modified } = await gitDiffFile("w1", "README.md");
	expect(original).toBe("# repo\n");
	expect(modified).toBe("# repo\n\nedited\n");
});

test("gitDiffFile: untracked → empty original; deleted → empty modified", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "new.txt"), "fresh\n");
	const added = await gitDiffFile("w1", "new.txt");
	expect(added.original).toBe("");
	expect(added.modified).toBe("fresh\n");

	rmSync(join(repo, "README.md"));
	const deleted = await gitDiffFile("w1", "README.md");
	expect(deleted.original).toBe("# repo\n");
	expect(deleted.modified).toBe("");
});

test("gitStatus attaches per-file +/- counts, incl. untracked line counts", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "README.md"), "# repo\nline two\nline three\n");
	writeFileSync(join(repo, "new.txt"), "a\nb\n");

	const { changes } = await gitStatus("w1");
	const readme = changes.find((c) => c.path === "README.md");
	expect(readme).toMatchObject({ status: "modified", added: 2, removed: 0 });
	const untracked = changes.find((c) => c.path === "new.txt");
	expect(untracked).toMatchObject({ status: "untracked", added: 2, removed: 0 });
});

test("gitStatus omits counts for untracked binary or oversized files (matches tracked binaries)", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x0a, 0x0a]));
	writeFileSync(join(repo, "big.txt"), `${"x".repeat(2 * 1024 * 1024 + 1)}\n`);
	writeFileSync(join(repo, "small.txt"), "one\ntwo\n");

	const { changes } = await gitStatus("w1");
	const bin = changes.find((c) => c.path === "blob.bin");
	expect(bin).toMatchObject({ status: "untracked" });
	expect(bin?.added).toBeUndefined();
	expect(changes.find((c) => c.path === "big.txt")?.added).toBeUndefined();
	expect(changes.find((c) => c.path === "small.txt")).toMatchObject({ added: 2 });
});

test("numstatPath resolves rename/copy forms to the destination path", async () => {
	expect(numstatPath("src/a.ts")).toBe("src/a.ts");
	expect(numstatPath("old.ts => new.ts")).toBe("new.ts");
	expect(numstatPath("src/{a => b}/x.ts")).toBe("src/b/x.ts");
});

test("gitDiffFile refuses a path escaping the worktree", async () => {
	seedWorkspace();
	await expect(gitDiffFile("w1", "../outside.txt")).rejects.toThrow("Path escapes the worktree");
});

test("listBranches with no remote returns local branches and falls back to the repo HEAD", async () => {
	git(repo, "branch", "feature/x");
	const { local, remote, defaultBranch } = await listBranches("p1");
	expect(local.sort()).toEqual(["feature/x", "main"]);
	expect(remote).toEqual([]);
	expect(defaultBranch).toBe("main");
});

test("tryCurrentBranch distinguishes a detached checkout from an invalid workspace root", async () => {
	expect(tryCurrentBranch(repo)).toBe("main");
	git(repo, "switch", "--detach");
	expect(tryCurrentBranch(repo)).toBe("HEAD");
	const nested = join(repo, "nested");
	mkdirSync(nested);
	expect(tryCurrentBranch(nested)).toBeNull();
	expect(tryCurrentBranch(join(dataDir, "missing"))).toBeNull();
});

test("listBranches surfaces origin branches and the origin default", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "remote", "set-head", "origin", "main");

	const { remote, defaultBranch } = await listBranches("p1");
	expect(remote).toContain("origin/main");
	expect(remote).not.toContain("origin/HEAD");
	expect(remote).not.toContain("origin");
	expect(defaultBranch).toBe("origin/main");
});

test("listBranches throws on an unknown project", async () => {
	await expect(listBranches("nope")).rejects.toThrow(/Unknown project/);
});

test("prefetchBranch fetches a remote ref and no-ops on a local ref or unknown project", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");

	const clone = join(dataDir, "clone");
	git(repo, "clone", remoteRepo, clone);
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

	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: true });
	expect(gitOut(repo, "rev-parse", "origin/main")).toBe(remoteTip);

	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: false });

	git(repo, "update-ref", "-d", "refs/remotes/origin/main");
	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: true });

	git(repo, "update-ref", "refs/heads/origin/main", "HEAD");
	writeFileSync(join(clone, "remote-only-2.txt"), "more\n");
	git(clone, "add", "-A");
	git(clone, "commit", "-m", "remote-only-2");
	git(clone, "push", "origin", "main");
	expect(await prefetchBranch("p1", "origin/main")).toEqual({ ok: true, moved: true });
	git(repo, "update-ref", "-d", "refs/heads/origin/main");

	expect(await prefetchBranch("p1", "main")).toEqual({ ok: false, moved: false });
	expect(await prefetchBranch("nope", "origin/main")).toEqual({ ok: false, moved: false });
});

test("prefetchBranch refuses a ref git would read as a refspec", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");

	for (const ref of [
		"origin/+main:refs/heads/victim",
		"origin/main:refs/heads/attacker-created",
		"origin/main~1",
		"origin/../../etc/passwd",
	]) {
		expect(await prefetchBranch("p1", ref)).toEqual({ ok: false, moved: false });
	}
	expect(existsSync(join(repo, ".git", "refs", "heads", "victim"))).toBe(false);
	expect(existsSync(join(repo, ".git", "refs", "heads", "attacker-created"))).toBe(false);
});

test("gitStatus reads the Default workspace's branch live, not the persisted snapshot", async () => {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w-default",
				projectId: "p1",
				kind: "default",
				name: "Default",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
				renamed: true,
			},
		]),
	);
	git(repo, "switch", "-c", "feature/live");
	expect(await (await gitStatus("w-default")).branch).toBe("feature/live");
});

test("gitStatus reads an external workspace's branch live, not the persisted snapshot", async () => {
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
	expect(await (await gitStatus("w-external")).branch).toBe("feature/external-live");
});

test("diffBaseRef resolves the re-pointed diff target over the creation base", async () => {
	expect(diffBaseRef({ baseBranch: "main" })).toBe("main");
	expect(diffBaseRef({ baseBranch: "main", diffBase: "origin/release" })).toBe("origin/release");
});

test("resolveDiffRange: one definition per scope (branch / uncommitted / commit)", async () => {
	const ws = { baseBranch: "main", worktreePath: repo };

	expect(await resolveDiffRange(ws)).toEqual(await resolveDiffRange(ws, { kind: "branch" }));
	const branch = await resolveDiffRange(ws, { kind: "branch" });
	const forkPoint = branch.originalRef ?? "";
	expect(forkPoint).toMatch(/^[0-9a-f]{40,}$/);
	expect(changedFileArgs(branch, "--name-status")).toEqual([
		"diff",
		"--name-status",
		"--end-of-options",
		forkPoint,
		"--",
	]);
	expect(branch).toMatchObject({ untracked: true, listRevs: [forkPoint], modifiedRef: null });
	expect(
		await resolveDiffRange({ ...ws, diffBase: "origin/release" }, { kind: "branch" }),
	).toMatchObject({
		listRevs: ["origin/release"],
		originalRef: "origin/release",
	});

	const uncommitted = await resolveDiffRange(ws, { kind: "uncommitted" });
	expect(changedFileArgs(uncommitted, "--numstat")).toEqual([
		"diff",
		"--numstat",
		"--end-of-options",
		"HEAD",
		"--",
	]);
	expect(uncommitted).toMatchObject({ untracked: true, originalRef: "HEAD", modifiedRef: null });

	const sha = commitOnFeature("second.txt", "second\n", "second");
	const commit = await resolveDiffRange(ws, { kind: "commit", sha });
	const parent = commit.originalRef ?? "";
	expect(parent).toMatch(/^[0-9a-f]{40,}$/);
	expect(parent).not.toBe(sha);
	expect(commit).toMatchObject({ untracked: false, modifiedRef: sha, listRevs: [parent, sha] });
	expect(await resolveDiffRange(ws, { kind: "commit", sha: sha.slice(0, 8) })).toEqual(commit);

	const pinned = await resolveDiffRange(ws, { kind: "pinned", baseRef: sha });
	expect(pinned).toMatchObject({
		untracked: true,
		originalRef: sha,
		modifiedRef: null,
		listRevs: [sha],
	});
	expect(await resolveDiffRange(ws, { kind: "pinned", baseRef: sha.slice(0, 8) })).toEqual(pinned);
	await expect(resolveDiffRange(ws, { kind: "pinned", baseRef: "--output=x" })).rejects.toThrow(
		/Not a commit id/,
	);
	await expect(resolveDiffRange(ws, { kind: "pinned", baseRef: "deadbeefcafe" })).rejects.toThrow(
		/Unknown commit/,
	);
});

test("resolveDiffRange degrades a root commit to an add-style diff (no parent to subtract)", async () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	const root = new TextDecoder()
		.decode(
			Bun.spawnSync(["git", "-C", repo, "rev-list", "--max-parents=0", "HEAD"], {
				stdout: "pipe",
			}).stdout,
		)
		.trim();
	const range = await resolveDiffRange(ws, { kind: "commit", sha: root });
	expect(range).toMatchObject({ untracked: false, originalRef: null, modifiedRef: root });
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

test("resolveDiffRange rejects a non-oid sha before it reaches git, and an unknown commit", async () => {
	const ws = { baseBranch: "main", worktreePath: repo };
	await expect(resolveDiffRange(ws, { kind: "commit", sha: "--output=/tmp/pwn" })).rejects.toThrow(
		/Not a commit id/,
	);
	await expect(resolveDiffRange(ws, { kind: "commit", sha: "HEAD" })).rejects.toThrow(
		/Not a commit id/,
	);
	await expect(resolveDiffRange(ws, { kind: "commit", sha: "deadbeef" })).rejects.toThrow(
		/Unknown commit/,
	);
});

test("gitStatus scopes: branch spans the base range, uncommitted only the dirty worktree", async () => {
	git(repo, "switch", "-c", "feature");
	commitOnFeature("committed.txt", "committed\n", "add committed.txt");
	seedWorkspace({ branch: "feature" });
	writeFileSync(join(repo, "dirty.txt"), "dirty\n");

	const branchPaths = (await gitStatus("w1")).changes.map((c) => c.path);
	expect(branchPaths).toEqual(["committed.txt", "dirty.txt"]);

	const uncommitted = (await gitStatus("w1", { kind: "uncommitted" })).changes.map((c) => c.path);
	expect(uncommitted).toEqual(["dirty.txt"]);
});

test("branch scope measures from the merge-base: upstream commits on the base are never phantom changes", async () => {
	git(repo, "switch", "-c", "feature");
	commitOnFeature("feature.txt", "feature\n", "feature work");
	git(repo, "switch", "main");
	writeFileSync(join(repo, "upstream.txt"), "upstream\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "upstream work");
	git(repo, "switch", "feature");
	seedWorkspace({ branch: "feature" });

	expect(await (await gitStatus("w1")).changes.map((c) => c.path)).toEqual(["feature.txt"]);
	expect(await (await listCommits("w1")).commits.map((c) => c.subject)).toEqual(["feature work"]);
	expect(await gitDiffFile("w1", "feature.txt")).toEqual({ original: "", modified: "feature\n" });
});

test("gitStatus/gitDiffFile for a commit scope read only that commit, from history", async () => {
	git(repo, "switch", "-c", "feature");
	commitOnFeature("script.ts", "export const one = 1;\n", "add script");
	const sha = commitOnFeature("script.ts", "export const two = 2;\n", "edit script");
	seedWorkspace({ branch: "feature" });
	writeFileSync(join(repo, "script.ts"), "export const three = 3;\n");
	writeFileSync(join(repo, "untracked.txt"), "nope\n");

	const scope = { kind: "commit", sha } as const;
	const changes = (await gitStatus("w1", scope)).changes;
	expect(changes.map((c) => c.path)).toEqual(["script.ts"]);
	expect(changes[0]).toMatchObject({ status: "modified", added: 1, removed: 1 });

	expect(await gitDiffFile("w1", "script.ts", scope)).toEqual({
		original: "export const one = 1;\n",
		modified: "export const two = 2;\n",
	});
});

test("gitStatus/listCommits measure against the re-pointed diffBase, not the creation base", async () => {
	git(repo, "switch", "-c", "release");
	commitOnFeature("released.txt", "released\n", "release-only");
	git(repo, "switch", "-c", "feature");
	const sha = commitOnFeature("feature.txt", "feature\n", "feature-only");
	seedWorkspace({ branch: "feature", baseBranch: "main", diffBase: "release" });

	expect(await (await gitStatus("w1")).changes.map((c) => c.path)).toEqual(["feature.txt"]);
	const { commits } = await listCommits("w1");
	expect(commits.map((c) => c.sha)).toEqual([sha]);
	expect(commits[0]).toMatchObject({ subject: "feature-only", author: "test" });
	expect(commits[0]?.shortSha).toBe(sha.slice(0, commits[0]?.shortSha.length));
	expect(commits[0]?.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

	seedWorkspace({ branch: "feature", baseBranch: "main" });
	expect(await (await gitStatus("w1")).changes.map((c) => c.path)).toEqual([
		"feature.txt",
		"released.txt",
	]);
	expect(await (await listCommits("w1")).commits.map((c) => c.subject)).toEqual([
		"feature-only",
		"release-only",
	]);
});

test("listCommits: a subject carrying the field separator can't shift author or timestamp", async () => {
	git(repo, "switch", "-c", "feature");
	writeFileSync(join(repo, "spoof.txt"), "spoof\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "subject\u001fnot-the-author\u001f1999-01-01T00:00:00+00:00");
	seedWorkspace({ branch: "feature" });

	const commit = (await listCommits("w1")).commits[0];
	expect(commit?.author).toBe("test");
	expect(commit?.committedAt).not.toContain("1999");
	expect(Number.isFinite(Date.parse(commit?.committedAt ?? ""))).toBe(true);
	expect(commit?.subject).toBe("subjectnot-the-author1999-01-01T00:00:00+00:00");
});

test("an option-shaped ref reaches git as a rev, never as an option", async () => {
	const probe = join(dataDir, "pwn-probe.txt");
	git(repo, "update-ref", `refs/heads/--output=${probe}`, "HEAD");
	expect(isSafeRef(`--output=${probe}`)).toBe(false);
	expect(await (await listBranches("p1")).local).toContain(`--output=${probe}`);

	seedWorkspace({ diffBase: `--output=${probe}` });
	expect(await (await gitStatus("w1")).changes).toEqual([]);
	expect(await (await listCommits("w1")).commits).toEqual([]);
	expect(existsSync(probe)).toBe(false);
});

test("isSafeRef accepts real refs and refuses anything git could re-read as more than a name", async () => {
	for (const ok of [
		"main",
		"origin/main",
		"release-1.2",
		"feature/a_b",
		"HEAD",
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

test("listCommits: a crafted AUTHOR name can't shift the timestamp or truncate itself", async () => {
	git(repo, "switch", "-c", "feature");
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

	const commit = (await listCommits("w1")).commits[0];
	expect(commit?.author).toBe("evil1999-01-01T00:00:00+00:00");
	expect(commit?.subject).toBe("real subject");
	expect(commit?.committedAt).not.toContain("1999");
	expect(Number.isFinite(Date.parse(commit?.committedAt ?? ""))).toBe(true);
});

test("plainText strips invisible deception (bidi overrides, zero-width) from repo text", async () => {
	git(repo, "switch", "-c", "feature");
	writeFileSync(join(repo, "bidi.txt"), "bidi\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "fix\u202egnisrever\u202c pa\u200bth — caf\u00e9 \u2713");
	seedWorkspace({ branch: "feature" });

	expect(await (await listCommits("w1")).commits[0]?.subject).toBe("fixgnisrever path — café ✓");
});

test("a base ref that also names a path still lists changes (the trailing `--`)", async () => {
	writeFileSync(join(repo, "docs"), "a file called docs\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "add a file named docs");
	git(repo, "branch", "docs");
	git(repo, "switch", "-c", "feature");
	commitOnFeature("feature.txt", "feature\n", "feature work");
	seedWorkspace({ branch: "feature", baseBranch: "docs" });

	expect(await (await gitStatus("w1")).changes.map((c) => c.path)).toEqual(["feature.txt"]);
	expect(await (await listCommits("w1")).commits.map((c) => c.subject)).toEqual(["feature work"]);
});

test("a failed diff throws — a broken read is never reported as a clean worktree", async () => {
	seedWorkspace({ diffBase: "no-such-branch" });
	writeFileSync(join(repo, "dirty.txt"), "dirty\n");
	await expect(gitStatus("w1")).rejects.toThrow(/Could not read the changed files/);
});

function stagedPaths(): string[] {
	return new TextDecoder()
		.decode(
			Bun.spawnSync(["git", "-C", repo, "diff", "--cached", "--name-only"], { stdout: "pipe" })
				.stdout,
		)
		.split("\n")
		.filter(Boolean);
}

test("gitCommitPaths commits EXACTLY the named paths and returns the sha; commit scope unfolds it", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "impl.ts"), "export {};\n");
	writeFileSync(join(repo, "other.ts"), "export const other = 1;\n");
	mkdirSync(join(repo, ".thinkrail", "context"), { recursive: true });
	writeFileSync(join(repo, ".thinkrail", "context", "todos.json"), "{}");

	const before = gitHeadSha("w1");
	const committed = gitCommitPaths("w1", "todo: step\n\nThinkRail-Todo: s/t1", ["impl.ts"]);
	expect(committed).not.toBeNull();
	expect(committed?.sha).not.toBe(before);
	expect(gitHeadSha("w1")).toBe(committed?.sha ?? "");
	const unfolded = await gitStatus("w1", { kind: "commit", sha: committed?.sha ?? "" });
	expect(unfolded.changes.map((c) => c.path)).toEqual(["impl.ts"]);
	const status = await gitStatus("w1", { kind: "uncommitted" });
	expect(status.changes.map((c) => c.path).sort()).toEqual([
		".thinkrail/context/todos.json",
		"other.ts",
	]);
	expect(stagedPaths()).toEqual([]);
});

test("gitCommitPaths stages a deletion, and returns null for an empty set or paths with nothing to commit", async () => {
	seedWorkspace();
	expect(gitCommitPaths("w1", "todo: nothing named", [])).toBeNull();
	expect(gitCommitPaths("w1", "todo: clean path", ["README.md"])).toBeNull();

	rmSync(join(repo, "README.md"));
	const committed = gitCommitPaths("w1", "todo: drop the readme", ["README.md"]);
	expect(committed).not.toBeNull();
	expect(
		await (await gitStatus("w1", { kind: "commit", sha: committed?.sha ?? "" })).changes[0],
	).toMatchObject({
		path: "README.md",
		status: "deleted",
	});
});

test("gitCommitPaths leaves the user's own staged work staged (never in the item's commit)", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "impl.ts"), "export {};\n");
	writeFileSync(join(repo, "mine.ts"), "export const mine = 1;\n");
	git(repo, "add", "--", "mine.ts");

	const committed = gitCommitPaths("w1", "todo: step", ["impl.ts"]);
	expect(
		(await gitStatus("w1", { kind: "commit", sha: committed?.sha ?? "" })).changes.map(
			(c) => c.path,
		),
	).toEqual(["impl.ts"]);
	expect(stagedPaths()).toEqual(["mine.ts"]);
});

test("gitCommitPaths treats paths literally — a pathspec-magic filename never expands beyond itself", async () => {
	seedWorkspace();
	const magic = ":(top)*";
	writeFileSync(join(repo, magic), "the item's own work\n");
	writeFileSync(join(repo, "other.ts"), "export const other = 1;\n");
	mkdirSync(join(repo, ".thinkrail", "context"), { recursive: true });
	writeFileSync(join(repo, ".thinkrail", "context", "todos.json"), "{}");

	const committed = gitCommitPaths("w1", "todo: magic name", [magic]);
	expect(committed).not.toBeNull();
	expect(
		(await gitStatus("w1", { kind: "commit", sha: committed?.sha ?? "" })).changes.map(
			(c) => c.path,
		),
	).toEqual([magic]);
	expect(
		(await gitStatus("w1", { kind: "uncommitted" })).changes.map((c) => c.path).sort(),
	).toEqual([".thinkrail/context/todos.json", "other.ts"]);
	expect(stagedPaths()).toEqual([]);
});

test("a failed commit restores the index — the user's staging area is never left mutated", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "impl.ts"), "export {};\n");
	writeFileSync(join(repo, "mine.ts"), "export const mine = 1;\n");
	git(repo, "add", "--", "mine.ts");
	git(repo, "config", "commit.gpgsign", "true");
	git(repo, "config", "gpg.program", join(dataDir, "no-such-gpg"));

	const head = gitHeadSha("w1");
	expect(gitCommitPaths("w1", "todo: unsignable", ["impl.ts"])).toBeNull();
	expect(gitHeadSha("w1")).toBe(head ?? "");
	expect(stagedPaths()).toEqual(["mine.ts"]);
});

test("a failed commit preserves index-only state — an intent-to-add entry survives byte-for-byte", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "impl.ts"), "export {};\n");
	writeFileSync(join(repo, "intent.txt"), "later\n");
	git(repo, "add", "-N", "--", "intent.txt");
	git(repo, "config", "commit.gpgsign", "true");
	git(repo, "config", "gpg.program", join(dataDir, "no-such-gpg"));

	const head = gitHeadSha("w1");
	expect(gitCommitPaths("w1", "todo: unsignable", ["impl.ts"])).toBeNull();
	expect(gitHeadSha("w1")).toBe(head ?? "");
	const tracked = new TextDecoder()
		.decode(
			Bun.spawnSync(["git", "-C", repo, "ls-files", "--", "intent.txt"], { stdout: "pipe" }).stdout,
		)
		.trim();
	expect(tracked).toBe("intent.txt");
	expect(stagedPaths()).toEqual([]);
});

test("gitCommitPaths refuses to commit over a conflicted index (unmerged entries)", async () => {
	seedWorkspace();
	writeFileSync(join(repo, "conflict.txt"), "base\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "add conflict.txt");
	git(repo, "switch", "-c", "side");
	writeFileSync(join(repo, "conflict.txt"), "side\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "side edit");
	git(repo, "switch", "main");
	writeFileSync(join(repo, "conflict.txt"), "main\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "main edit");
	Bun.spawnSync(["git", "-C", repo, "merge", "side"], { stdout: "ignore", stderr: "ignore" });

	writeFileSync(join(repo, "impl.ts"), "export {};\n");
	const head = gitHeadSha("w1");
	expect(gitCommitPaths("w1", "todo: mid-merge", ["impl.ts"])).toBeNull();
	expect(gitHeadSha("w1")).toBe(head ?? "");
});

test("countUnpushedCommits counts what origin/<branch> lacks; null without the remote ref", async () => {
	expect(await countUnpushedCommits(repo, "main")).toBeNull();
	git(dataDir, "init", "--bare", "origin.git");
	git(repo, "remote", "add", "origin", join(dataDir, "origin.git"));
	git(repo, "push", "-u", "origin", "main");
	expect(await countUnpushedCommits(repo, "main")).toBe(0);
	writeFileSync(join(repo, "next.txt"), "next\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "next");
	expect(await countUnpushedCommits(repo, "main")).toBe(1);
});
