import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	initProject,
	inspectProjectPath,
	isProjectTrusted,
	listProjects,
	setProjectTrust,
} from "./projects";

function gitOut(cwd: string, ...args: string[]): string {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
	return new TextDecoder().decode(r.stdout).trim();
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

/** A committed git repo at `path` (own identity, one commit) — the baseline "already a repo" fixture. */
function makeRepo(path: string): void {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-b", "main");
	git(path, "config", "user.email", "t@thinkrail.test");
	git(path, "config", "user.name", "test");
	writeFileSync(join(path, "README.md"), "# repo\n");
	git(path, "add", "-A");
	git(path, "commit", "-m", "init");
}

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	// Isolated data dir so persisted projects.json never touches the real ~/.thinkrail; it is *not* a git
	// repo, so a plain folder created inside it reads as `initable`.
	dataDir = mkdtempSync(join(tmpdir(), "trpi-proj-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("inspectProjectPath: a path that doesn't exist is `missing`", () => {
	expect(inspectProjectPath(join(dataDir, "nope"))).toEqual({ kind: "missing" });
});

test("inspectProjectPath: a file is `notDirectory`", () => {
	const file = join(dataDir, "a-file.txt");
	writeFileSync(file, "not a dir\n");
	expect(inspectProjectPath(file)).toEqual({ kind: "notDirectory" });
});

test("inspectProjectPath: a plain directory is `initable`", () => {
	const dir = join(dataDir, "plain");
	mkdirSync(dir);
	expect(inspectProjectPath(dir)).toEqual({ kind: "initable" });
});

test("inspectProjectPath: a git repo (and any subdirectory) is `repo`", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const sub = join(repo, "src", "deep");
	mkdirSync(sub, { recursive: true });
	expect(inspectProjectPath(repo)).toEqual({ kind: "repo" });
	expect(inspectProjectPath(sub)).toEqual({ kind: "repo" });
});

test("initProject: initialises a plain folder, commits its contents, and opens it", () => {
	const dir = join(dataDir, "plain");
	mkdirSync(dir);
	writeFileSync(join(dir, "hello.txt"), "hi\n");

	const project = initProject(dir);
	// `openProject` records the git toplevel, which is a realpath (on macOS /tmp → /private/tmp).
	expect(project.path).toBe(realpathSync(dir));
	expect(existsSync(join(dir, ".git"))).toBe(true);
	// A resolvable HEAD, and the folder's file is in the committed tree.
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "ls-tree", "-r", "HEAD", "--name-only")).toContain("hello.txt");
	expect(listProjects()).toHaveLength(1);
});

test("initProject: an empty folder gets an empty initial commit (a HEAD), so worktrees work", () => {
	const dir = join(dataDir, "empty");
	mkdirSync(dir);

	initProject(dir);
	// The empty commit still gives a HEAD (the whole point — `git worktree add` needs one) but an empty tree.
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "ls-tree", "-r", "HEAD", "--name-only")).toBe("");
	// The end goal: a worktree can now be cut from HEAD.
	const wt = join(dataDir, "wt");
	git(dir, "worktree", "add", wt, "-b", "feature");
	expect(existsSync(wt)).toBe(true);
});

test("initProject: commits even with no configured git identity (the -c fallback)", () => {
	const dir = join(dataDir, "noid");
	mkdirSync(dir);
	writeFileSync(join(dir, "file.txt"), "x\n");

	// Neutralise any global/system git identity so the commit would fail without our `-c` fallback.
	const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
	const savedSystem = process.env.GIT_CONFIG_SYSTEM;
	process.env.GIT_CONFIG_GLOBAL = "/dev/null";
	process.env.GIT_CONFIG_SYSTEM = "/dev/null";
	try {
		initProject(dir);
		expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
		expect(gitOut(dir, "log", "-1", "--format=%an")).toBe("ThinkRail");
	} finally {
		if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
		if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
		else process.env.GIT_CONFIG_SYSTEM = savedSystem;
	}
});

test("initProject: an existing repo is opened, not re-initialised (dedupe, history preserved)", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const originalHead = gitOut(repo, "rev-parse", "HEAD");

	const first = initProject(repo);
	const second = initProject(repo);
	expect(second.id).toBe(first.id);
	expect(listProjects()).toHaveLength(1);
	// No fresh commit was layered on top — the original history is intact.
	expect(gitOut(repo, "rev-parse", "HEAD")).toBe(originalHead);
});

test("setProjectTrust: persists a revocable, fail-closed trust decision", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = initProject(repo);

	// Undecided by default — fail closed.
	expect(project.trusted).toBeUndefined();
	expect(isProjectTrusted(project.id)).toBe(false);

	const trusted = setProjectTrust(project.id, true);
	expect(trusted.trusted).toBe(true);
	expect(isProjectTrusted(project.id)).toBe(true);
	// Persisted: a fresh read from projects.json reflects it.
	expect(listProjects().find((p) => p.id === project.id)?.trusted).toBe(true);

	// Revocable, and an unknown id fails loudly rather than silently trusting nothing.
	setProjectTrust(project.id, false);
	expect(isProjectTrusted(project.id)).toBe(false);
	expect(() => setProjectTrust("nope", true)).toThrow();
});
