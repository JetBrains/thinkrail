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
	approveProjectMcpServer,
	closeProject,
	getProjects,
	initProject,
	inspectProjectPath,
	isProjectTrusted,
	listProjects,
	listRecentProjects,
	openProject,
	setPiTrustSeed,
	setProjectMcpOverride,
	setProjectPublisher,
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

function makeRepo(path: string): void {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-b", "main");
	git(path, "config", "user.email", "t@thinkrail.test");
	git(path, "config", "user.name", "test");
	git(path, "config", "commit.gpgsign", "false");
	writeFileSync(join(path, "README.md"), "# repo\n");
	git(path, "add", "-A");
	git(path, "commit", "-m", "init");
}

function withoutUserGitConfig<T>(run: () => T): T {
	const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
	const savedSystem = process.env.GIT_CONFIG_SYSTEM;
	process.env.GIT_CONFIG_GLOBAL = "/dev/null";
	process.env.GIT_CONFIG_SYSTEM = "/dev/null";
	try {
		return run();
	} finally {
		if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
		if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
		else process.env.GIT_CONFIG_SYSTEM = savedSystem;
	}
}

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-proj-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	setProjectPublisher(null);
	setPiTrustSeed(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function seedWorkspace(worktreePath: string, kind?: "default" | "external"): void {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws-1",
				projectId: "p-other",
				name: "seeded",
				branch: "feature/seeded",
				worktreePath,
				baseBranch: "main",
				renamed: true,
				...(kind ? { kind } : {}),
			},
		]),
	);
}

test("openProject refuses a checkout already attached as an external workspace", () => {
	const attached = join(dataDir, "auth checkout");
	makeRepo(attached);
	seedWorkspace(attached, "external");

	expect(() => openProject(attached)).toThrow("already open in ThinkRail");
	expect(listProjects()).toHaveLength(0);
});

test("openProject refuses a ThinkRail-managed worktree dir, whatever symlinks the path carries", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const managed = join(dataDir, "worktrees", "repo", "workspace-1");
	git(repo, "worktree", "add", "-b", "workspace-1", managed);
	seedWorkspace(managed);

	expect(() => openProject(managed)).toThrow("already open in ThinkRail");
	expect(openProject(repo).path).toBe(realpathSync(repo));
});

test("openProject still reopens a closed project whose own Default workspace holds its cwd", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);
	seedWorkspace(project.path, "default");
	closeProject(project.id);

	expect(openProject(repo).id).toBe(project.id);
	expect(listProjects().map((p) => p.id)).toEqual([project.id]);
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

test("host-home paths resolve consistently across inspect, open, and init", () => {
	const home = join(dataDir, "host-home");
	const repo = join(home, "repo");
	const plain = join(home, "plain");
	makeRepo(repo);
	mkdirSync(plain);
	const savedHome = process.env.HOME;
	const savedUserProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		expect(inspectProjectPath("~")).toEqual({ kind: "initable" });
		expect(inspectProjectPath("~/repo")).toEqual({ kind: "repo" });
		expect(openProject("~/repo").path).toBe(realpathSync(repo));
		expect(inspectProjectPath("~/plain")).toEqual({ kind: "initable" });
		expect(withoutUserGitConfig(() => initProject("~/plain")).path).toBe(realpathSync(plain));
	} finally {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = savedUserProfile;
	}
});

test("relative project paths are rejected instead of using the host process cwd", () => {
	for (const operation of [openProject, inspectProjectPath, initProject]) {
		expect(() => operation("relative/project")).toThrow("must be absolute or start with ~/");
	}
});

test("initProject: initialises a plain folder, commits its contents, and opens it", () => {
	const dir = join(dataDir, "plain");
	mkdirSync(dir);
	writeFileSync(join(dir, "hello.txt"), "hi\n");

	const project = withoutUserGitConfig(() => initProject(dir));
	expect(project.path).toBe(realpathSync(dir));
	expect(existsSync(join(dir, ".git"))).toBe(true);
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "ls-tree", "-r", "HEAD", "--name-only")).toContain("hello.txt");
	expect(listProjects()).toHaveLength(1);
});

test("initProject: an empty folder gets an empty initial commit (a HEAD), so worktrees work", () => {
	const dir = join(dataDir, "empty");
	mkdirSync(dir);

	withoutUserGitConfig(() => initProject(dir));
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "ls-tree", "-r", "HEAD", "--name-only")).toBe("");
	const wt = join(dataDir, "wt");
	git(dir, "worktree", "add", wt, "-b", "feature");
	expect(existsSync(wt)).toBe(true);
});

test("initProject: commits even with no configured git identity (the -c fallback)", () => {
	const dir = join(dataDir, "noid");
	mkdirSync(dir);
	writeFileSync(join(dir, "file.txt"), "x\n");

	withoutUserGitConfig(() => initProject(dir));
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "log", "-1", "--format=%an")).toBe("ThinkRail");
});

test("initProject: an existing repo is opened, not re-initialised (dedupe, history preserved)", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const originalHead = gitOut(repo, "rev-parse", "HEAD");

	const first = initProject(repo);
	const second = initProject(repo);
	expect(second.id).toBe(first.id);
	expect(listProjects()).toHaveLength(1);
	expect(gitOut(repo, "rev-parse", "HEAD")).toBe(originalHead);
});

test("legacy project records default to open in both projections", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "legacy", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);

	expect(listProjects().map((project) => project.id)).toEqual(["legacy"]);
	expect(listRecentProjects().map((project) => project.id)).toEqual(["legacy"]);
});

test("close/reopen preserves the stable project identity and workspace associations", async () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);
	const workspaceRecord = { id: "ws1", projectId: project.id, worktreePath: "/kept" };
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify([workspaceRecord]));

	const published: Array<{ id: string; closed?: true }> = [];
	setProjectPublisher((snapshot) => published.push(snapshot));
	const closed = closeProject(project.id);

	expect(closed.closed).toBe(true);
	expect(listProjects()).toEqual([]);
	expect(listRecentProjects().map(({ id, closed: state }) => ({ id, closed: state }))).toEqual([
		{ id: project.id, closed: true },
	]);
	expect(JSON.parse(readFileSync(join(dataDir, "workspaces.json"), "utf8"))).toEqual([
		workspaceRecord,
	]);
	expect(published).toEqual([expect.objectContaining({ id: project.id, closed: true })]);

	await Bun.sleep(2);
	const reopened = openProject(repo);
	expect(reopened.id).toBe(project.id);
	expect(reopened.closed).toBeUndefined();
	expect(reopened.lastOpened).toBeGreaterThan(closed.lastOpened);
	expect(listProjects().map((candidate) => candidate.id)).toEqual([project.id]);
	expect(listRecentProjects().map((candidate) => candidate.id)).toEqual([project.id]);
	expect(published).toEqual([
		expect.objectContaining({ id: project.id, closed: true }),
		expect.not.objectContaining({ closed: true }),
	]);
});

test("closeProject rejects an unknown id instead of reporting a success with no lifecycle event", () => {
	const published: string[] = [];
	setProjectPublisher((snapshot) => published.push(snapshot.id));
	expect(() => closeProject("missing")).toThrow("Unknown project: missing");
	expect(published).toEqual([]);
});

test("setProjectTrust: persists a revocable, fail-closed trust decision", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = initProject(repo);

	expect(project.trusted).toBeUndefined();
	expect(isProjectTrusted(project.id)).toBe(false);

	const trusted = setProjectTrust(project.id, true);
	expect(trusted.trusted).toBe(true);
	expect(isProjectTrusted(project.id)).toBe(true);
	expect(listProjects().find((p) => p.id === project.id)?.trusted).toBe(true);

	const revoked = setProjectTrust(project.id, false);
	expect(revoked.piResourceTrust).toBe("untrusted");
	expect(isProjectTrusted(project.id)).toBe(false);
	expect(() => setProjectTrust("nope", true)).toThrow();
});

test("setProjectTrust: pi-level resource trust needs its own explicit grant, and a revoke clears both", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = initProject(repo);
	expect(project.piResourceTrust).toBe("untrusted");

	const aliasOnly = setProjectTrust(project.id, true, ["a"]);
	expect(aliasOnly).toMatchObject({
		trusted: true,
		piResourceTrust: "untrusted",
		acknowledgedSkills: ["a"],
	});

	const both = setProjectTrust(project.id, true, ["a"], { resources: true });
	expect(both).toMatchObject({ trusted: true, piResourceTrust: "granted" });
	expect(setProjectTrust(project.id, true).piResourceTrust).toBe("granted");

	const revoked = setProjectTrust(project.id, false, undefined, { resources: true });
	expect(revoked).toMatchObject({ trusted: false, piResourceTrust: "untrusted" });
	expect(storedProjects().find((stored) => stored.id === project.id)).toMatchObject({
		trusted: false,
		piResourceTrust: "untrusted",
	});
});

function writeProjects(records: object[]): void {
	writeFileSync(join(dataDir, "projects.json"), JSON.stringify(records));
}

function storedProjects(): Array<{ id: string; piResourceTrust?: string; trusted?: boolean }> {
	return JSON.parse(readFileSync(join(dataDir, "projects.json"), "utf8"));
}

test("pi-level trust migration grandfathers legacy records unless pi's own trust store denies them", () => {
	writeProjects([
		{ id: "legacy", name: "a", path: "/repos/a", slug: "a", lastOpened: 1 },
		{ id: "denied", name: "b", path: "/repos/b", slug: "b", lastOpened: 1 },
		{ id: "pi-trusted", name: "c", path: "/repos/c", slug: "c", lastOpened: 1 },
		{
			id: "explicit",
			name: "d",
			path: "/repos/d",
			slug: "d",
			lastOpened: 1,
			piResourceTrust: "untrusted",
		},
		{ id: "alias-only", name: "e", path: "/repos/e", slug: "e", lastOpened: 1, trusted: false },
		{ id: "unreadable", name: "f", path: "/repos/f", slug: "f", lastOpened: 1 },
	]);
	const asked: string[] = [];
	setPiTrustSeed((path) => {
		asked.push(path);
		if (path === "/repos/f") return undefined;
		return path === "/repos/b" ? false : path === "/repos/c" ? true : null;
	});

	const migrated = getProjects();
	expect(Object.fromEntries(migrated.map((p) => [p.id, p.piResourceTrust]))).toEqual({
		legacy: "granted",
		denied: "untrusted",
		"pi-trusted": "granted",
		explicit: "untrusted",
		"alias-only": "granted",
		unreadable: undefined,
	});
	expect(storedProjects().find((p) => p.id === "unreadable")?.piResourceTrust).toBeUndefined();
	setPiTrustSeed((path) => (path === "/repos/f" ? false : null));
	expect(getProjects().find((p) => p.id === "unreadable")?.piResourceTrust).toBe("untrusted");
	expect(storedProjects().find((p) => p.id === "alias-only")?.trusted).toBe(false);
	expect(asked).not.toContain("/repos/d");

	asked.length = 0;
	setPiTrustSeed(() => false);
	expect(getProjects().find((p) => p.id === "legacy")?.piResourceTrust).toBe("granted");
	expect(asked).toEqual([]);
});

test("without a configured seed no migration runs and a legacy record reads as untrusted", () => {
	writeProjects([{ id: "legacy", name: "a", path: "/repos/a", slug: "a", lastOpened: 1 }]);
	expect(getProjects()[0]?.piResourceTrust).toBeUndefined();
	expect(storedProjects()[0]?.piResourceTrust).toBeUndefined();
});

test("a project added after the migration starts untrusted unless pi already trusts its path", () => {
	const plain = join(dataDir, "plain");
	const piTrusted = join(dataDir, "pi-trusted");
	makeRepo(plain);
	makeRepo(piTrusted);
	const trustedRoot = realpathSync(piTrusted);
	setPiTrustSeed((path) => (realpathSync(path) === trustedRoot ? true : null));

	expect(openProject(plain).piResourceTrust).toBe("untrusted");
	expect(openProject(piTrusted).piResourceTrust).toBe("granted");
	expect(initProject(plain).piResourceTrust).toBe("untrusted");
});

test("MCP approvals and per-project overrides persist in the project record and clear cleanly", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);

	approveProjectMcpServer(project.id, "linear", "fp-1");
	expect(approveProjectMcpServer(project.id, "linear", "fp-2").mcpApprovals).toEqual({
		linear: "fp-2",
	});

	setProjectMcpOverride(project.id, "context7", { enabled: false });
	const exposed = setProjectMcpOverride(project.id, "sentry", { exposure: "direct" });
	expect(exposed.mcpOverrides).toEqual({
		context7: { enabled: false },
		sentry: { exposure: "direct" },
	});
	setProjectMcpOverride(project.id, "context7", null);
	const cleared = setProjectMcpOverride(project.id, "sentry", {});
	expect(cleared.mcpOverrides).toBeUndefined();
	expect(storedProjects()[0]).not.toHaveProperty("mcpOverrides");
	expect(() => approveProjectMcpServer("nope", "x", "y")).toThrow();
});
