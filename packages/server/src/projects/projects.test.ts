import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	commitProjectFile,
	initProject,
	inspectProjectPath,
	isPathIgnored,
	listProjects,
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

test("commitProjectFile commits a brand-new untracked file", () => {
	const repo = mkdtempSync(join(tmpdir(), "trpi-projects-test-"));
	makeRepo(repo);
	mkdirSync(join(repo, ".thinkrail"), { recursive: true });
	writeFileSync(join(repo, ".thinkrail", "hooks.json"), '{"onCreate":"npm install"}\n');

	commitProjectFile(repo, ".thinkrail/hooks.json", "chore: update workspace hooks");

	expect(gitOut(repo, "log", "-1", "--format=%s")).toBe("chore: update workspace hooks");
	expect(gitOut(repo, "status", "--short")).toBe("");
	rmSync(repo, { recursive: true, force: true });
});

test("commitProjectFile commits a change to an already-tracked file", () => {
	const repo = mkdtempSync(join(tmpdir(), "trpi-projects-test-"));
	makeRepo(repo);
	mkdirSync(join(repo, ".thinkrail"), { recursive: true });
	writeFileSync(join(repo, ".thinkrail", "hooks.json"), '{"onCreate":"npm install"}\n');
	git(repo, "add", "--", ".thinkrail/hooks.json");
	git(repo, "commit", "-m", "add hooks.json");

	writeFileSync(join(repo, ".thinkrail", "hooks.json"), '{"onCreate":"pnpm install"}\n');
	commitProjectFile(repo, ".thinkrail/hooks.json", "chore: update workspace hooks");

	expect(JSON.parse(readFileSync(join(repo, ".thinkrail", "hooks.json"), "utf8"))).toEqual({
		onCreate: "pnpm install",
	});
	expect(gitOut(repo, "log", "-1", "--format=%s")).toBe("chore: update workspace hooks");
	rmSync(repo, { recursive: true, force: true });
});

test("commitProjectFile is a no-op (doesn't throw) when the file is unchanged", () => {
	const repo = mkdtempSync(join(tmpdir(), "trpi-projects-test-"));
	makeRepo(repo);
	mkdirSync(join(repo, ".thinkrail"), { recursive: true });
	writeFileSync(join(repo, ".thinkrail", "hooks.json"), '{"onCreate":"npm install"}\n');
	git(repo, "add", "--", ".thinkrail/hooks.json");
	git(repo, "commit", "-m", "add hooks.json");
	const before = gitOut(repo, "rev-parse", "HEAD");

	expect(() =>
		commitProjectFile(repo, ".thinkrail/hooks.json", "chore: update workspace hooks"),
	).not.toThrow();
	expect(gitOut(repo, "rev-parse", "HEAD")).toBe(before); // no new commit was made
	rmSync(repo, { recursive: true, force: true });
});

test("commitProjectFile never sweeps up an unrelated file already staged", () => {
	const repo = mkdtempSync(join(tmpdir(), "trpi-projects-test-"));
	makeRepo(repo);
	mkdirSync(join(repo, ".thinkrail"), { recursive: true });
	writeFileSync(join(repo, ".thinkrail", "hooks.json"), '{"onCreate":"npm install"}\n');
	git(repo, "add", "--", ".thinkrail/hooks.json");
	git(repo, "commit", "-m", "add hooks.json");

	writeFileSync(join(repo, "unrelated.txt"), "pre-staged by something else\n");
	git(repo, "add", "--", "unrelated.txt"); // simulates unrelated staged work already in the index

	writeFileSync(join(repo, ".thinkrail", "hooks.json"), '{"onCreate":"pnpm install"}\n');
	commitProjectFile(repo, ".thinkrail/hooks.json", "chore: update workspace hooks");

	// unrelated.txt must still be staged, not committed alongside our file.
	expect(gitOut(repo, "status", "--short")).toBe("A  unrelated.txt");
	rmSync(repo, { recursive: true, force: true });
});

test("isPathIgnored: true for a path covered by a committed .gitignore rule", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	writeFileSync(join(repo, ".gitignore"), ".thinkrail/\n");

	expect(isPathIgnored(repo, ".thinkrail/hooks.json")).toBe(true);
});

test("isPathIgnored: false in a plain repo with no matching ignore rule", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);

	expect(isPathIgnored(repo, ".thinkrail/hooks.json")).toBe(false);
});

test("isPathIgnored: false (never throws) when git itself errors, e.g. not a repo at all", () => {
	const notARepo = join(dataDir, "not-a-repo");
	mkdirSync(notARepo, { recursive: true });

	expect(() => isPathIgnored(notARepo, ".thinkrail/hooks.json")).not.toThrow();
	expect(isPathIgnored(notARepo, ".thinkrail/hooks.json")).toBe(false);
});
