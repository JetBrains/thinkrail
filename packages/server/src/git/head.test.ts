import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headBranchAt, parseHead } from "./head";

let dir: string;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function initRepo(path: string, ...initArgs: string[]): void {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-b", "trunk", ...initArgs);
	git(path, "config", "user.email", "t@thinkrail.test");
	git(path, "config", "user.name", "test");
	git(path, "commit", "--allow-empty", "-m", "init");
}

const gitVersion = new TextDecoder()
	.decode(Bun.spawnSync(["git", "--version"]).stdout)
	.match(/(\d+)\.(\d+)/);
const supportsReftable =
	gitVersion !== null &&
	(Number(gitVersion[1]) > 2 || (Number(gitVersion[1]) === 2 && Number(gitVersion[2]) >= 45));

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "trpi-head-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

test("parseHead reads a branch ref, treats anything else as detached, and flags the reftable stub", () => {
	expect(parseHead("ref: refs/heads/feature/x\n")).toEqual({ ref: "branch", name: "feature/x" });
	expect(parseHead("ref: refs/heads/main\r\n")).toEqual({ ref: "branch", name: "main" });
	expect(parseHead("ref: refs/heads/main  \t\n")).toEqual({ ref: "branch", name: "main" });
	expect(parseHead("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n")).toEqual({ ref: "detached" });
	expect(parseHead("ref: refs/remotes/origin/main\n")).toEqual({ ref: "detached" });
	expect(parseHead("")).toEqual({ ref: "detached" });
	expect(parseHead("ref: refs/heads/.invalid\n")).toEqual({ ref: "reftable" });
});

test("headBranchAt reads a repo root and a linked worktree from files", () => {
	const repo = join(dir, "repo");
	initRepo(repo);
	const wt = join(dir, "wt");
	git(repo, "worktree", "add", "-b", "side", wt);

	expect(headBranchAt(repo)).toBe("trunk");
	expect(headBranchAt(wt)).toBe("side");

	git(wt, "switch", "--detach");
	expect(headBranchAt(wt)).toBeNull();
});

test("headBranchAt follows a relative gitfile and never answers for an enclosing repo", () => {
	const repo = join(dir, "repo");
	initRepo(repo);
	const wt = join(dir, "wt");
	git(repo, "worktree", "add", "-b", "rel", wt);
	writeFileSync(join(wt, ".git"), "gitdir: ../repo/.git/worktrees/wt\r\n");
	expect(headBranchAt(wt)).toBe("rel");

	const nested = join(repo, "plain");
	mkdirSync(nested);
	expect(headBranchAt(nested)).toBeNull();
	writeFileSync(join(nested, ".git"), "not a gitfile\n");
	expect(headBranchAt(nested)).toBeNull();
});

test.skipIf(!supportsReftable)(
	"a reftable worktree reads its real branch, never the .invalid stub",
	() => {
		const repo = join(dir, "table");
		initRepo(repo, "--ref-format=reftable");
		const wt = join(dir, "table-wt");
		git(repo, "worktree", "add", "-b", "table-branch", wt);
		expect(readFileSync(join(repo, ".git", "HEAD"), "utf8")).toContain(".invalid");

		expect(headBranchAt(repo)).toBe("trunk");
		expect(headBranchAt(wt)).toBe("table-branch");
		git(wt, "switch", "--detach");
		expect(headBranchAt(wt)).toBeNull();
	},
);
