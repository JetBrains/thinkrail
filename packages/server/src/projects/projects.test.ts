import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Project } from "@thinkrail/contracts";
import {
	approveProjectMcpServer,
	closeProject,
	createProject,
	getProjects,
	grantProjectMcpTool,
	initProject,
	inspectProjectPath,
	isProjectTrusted,
	listProjects,
	listRecentProjects,
	openProject,
	refreshRecentProjectFolders,
	renameProject,
	revokeProjectMcpTool,
	setPiTrustSeed,
	setProjectMcpOverride,
	setProjectPublisher,
	setProjectTrust,
} from "./projects";

const realStat = fsPromises.stat;
const hungStatPaths = new Set<string>();
let hungStatCalls = 0;
mock.module("node:fs/promises", () => ({
	...fsPromises,
	stat: (path: string, ...rest: []) => {
		if (!hungStatPaths.has(path)) return realStat(path, ...rest);
		hungStatCalls += 1;
		return new Promise(() => {});
	},
}));

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

async function withoutUserGitConfig<T>(run: () => T | Promise<T>): Promise<Awaited<T>> {
	const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
	const savedSystem = process.env.GIT_CONFIG_SYSTEM;
	process.env.GIT_CONFIG_GLOBAL = "/dev/null";
	process.env.GIT_CONFIG_SYSTEM = "/dev/null";
	try {
		return await run();
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
	dataDir = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-proj-test-")));
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

test("host-home paths resolve consistently across inspect, open, and init", async () => {
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
		expect((await withoutUserGitConfig(() => initProject("~/plain"))).path).toBe(
			realpathSync(plain),
		);
	} finally {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = savedUserProfile;
	}
});

test.skipIf(process.platform !== "win32")(
	"on Windows a home path may use the native separator",
	() => {
		const home = join(dataDir, "host-home");
		const repo = join(home, "repo");
		makeRepo(repo);
		const savedUserProfile = process.env.USERPROFILE;
		process.env.USERPROFILE = home;
		try {
			expect(inspectProjectPath("~\\repo")).toEqual({ kind: "repo" });
			expect(openProject("~\\repo").path).toBe(realpathSync(repo));
			expect(() => openProject("relative\\project")).toThrow(
				"must be absolute or start with ~/ or ~\\",
			);
		} finally {
			if (savedUserProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = savedUserProfile;
		}
	},
);

test("relative project paths are rejected instead of using the host process cwd", async () => {
	for (const operation of [openProject, inspectProjectPath]) {
		expect(() => operation("relative/project")).toThrow("must be absolute or start with ~/");
	}
	await expect(initProject("relative/project")).rejects.toThrow(
		"must be absolute or start with ~/",
	);
});

test("initProject: initialises a plain folder, commits its contents, and opens it", async () => {
	const dir = join(dataDir, "plain");
	mkdirSync(dir);
	writeFileSync(join(dir, "hello.txt"), "hi\n");

	const project = await withoutUserGitConfig(() => initProject(dir));
	expect(project.path).toBe(realpathSync(dir));
	expect(existsSync(join(dir, ".git"))).toBe(true);
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "ls-tree", "-r", "HEAD", "--name-only")).toContain("hello.txt");
	expect(listProjects()).toHaveLength(1);
});

test("initProject: an empty folder gets an empty initial commit (a HEAD), so worktrees work", async () => {
	const dir = join(dataDir, "empty");
	mkdirSync(dir);

	await withoutUserGitConfig(() => initProject(dir));
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "ls-tree", "-r", "HEAD", "--name-only")).toBe("");
	const wt = join(dataDir, "wt");
	git(dir, "worktree", "add", wt, "-b", "feature");
	expect(existsSync(wt)).toBe(true);
});

test("createProject: makes the folder and missing parents, bootstraps a repo, and opens it", async () => {
	const parent = join(dataDir, "nested", "parent");

	const project = await withoutUserGitConfig(() => createProject(parent, " my-app ", " My  App "));
	const path = join(parent, "my-app");
	expect(project.path).toBe(realpathSync(path));
	expect(project.name).toBe("My App");
	expect(gitOut(path, "rev-parse", "HEAD")).not.toBe("");
	expect(listProjects().map((p) => p.id)).toEqual([project.id]);
});

test("createProject: reuses an empty folder but rejects a non-empty one or a file", async () => {
	mkdirSync(join(dataDir, "empty"));
	expect((await withoutUserGitConfig(() => createProject(dataDir, "empty"))).path).toBe(
		realpathSync(join(dataDir, "empty")),
	);

	mkdirSync(join(dataDir, "full"));
	writeFileSync(join(dataDir, "full", "a.txt"), "a\n");
	await expect(createProject(dataDir, "full")).rejects.toThrow("already exists and isn't empty");
	expect(existsSync(join(dataDir, "full", ".git"))).toBe(false);

	writeFileSync(join(dataDir, "file"), "x\n");
	await expect(createProject(dataDir, "file")).rejects.toThrow("Not a folder");
});

test("createProject: a folder inside an enclosing repo becomes its own project", async () => {
	const outer = join(dataDir, "outer");
	makeRepo(outer);

	const project = await withoutUserGitConfig(() => createProject(outer, "inner"));
	expect(project.path).toBe(realpathSync(join(outer, "inner")));
	expect(resolve(gitOut(join(outer, "inner"), "rev-parse", "--show-toplevel"))).toBe(
		realpathSync(join(outer, "inner")),
	);
});

async function withFailingCommitHook<T>(
	hookBody: string,
	run: () => T | Promise<T>,
): Promise<Awaited<T>> {
	const hooks = join(dataDir, "hooks");
	mkdirSync(hooks, { recursive: true });
	writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\n${hookBody}\nexit 1\n`, { mode: 0o755 });
	const config = join(dataDir, "gitconfig");
	writeFileSync(config, `[core]\n\thooksPath = "${hooks.replaceAll("\\", "/")}"\n`);
	const keys = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"] as const;
	const saved = keys.map((key) => process.env[key]);
	process.env.GIT_CONFIG_GLOBAL = config;
	delete process.env.GIT_CONFIG_COUNT;
	delete process.env.GIT_CONFIG_PARAMETERS;
	try {
		return await run();
	} finally {
		keys.forEach((key, index) => {
			const value = saved[index];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		});
	}
}

test("createProject: a failed bootstrap removes the folder it made, but nothing written into it meanwhile", async () => {
	const parent = join(dataDir, "parent");
	await expect(withFailingCommitHook(":", () => createProject(parent, "clean"))).rejects.toThrow(
		"git commit failed",
	);
	expect(existsSync(join(parent, "clean"))).toBe(false);

	await expect(
		withFailingCommitHook("echo kept > hook-output.txt", () => createProject(parent, "busy")),
	).rejects.toThrow("git commit failed");
	expect(existsSync(join(parent, "busy", ".git"))).toBe(false);
	expect(readFileSync(join(parent, "busy", "hook-output.txt"), "utf8")).toBe("kept\n");
	expect(listProjects()).toEqual([]);
});

test("createProject: rejects names that are not one plain folder name", async () => {
	for (const name of ["", "  ", ".", "..", "a/b", "a\\b"]) {
		await expect(createProject(dataDir, name)).rejects.toThrow("Invalid project folder name");
	}
	await expect(createProject("relative", "app")).rejects.toThrow(
		"must be absolute or start with ~/",
	);
});

test("initProject: commits even with no configured git identity (the -c fallback)", async () => {
	const dir = join(dataDir, "noid");
	mkdirSync(dir);
	writeFileSync(join(dir, "file.txt"), "x\n");

	await withoutUserGitConfig(() => initProject(dir));
	expect(gitOut(dir, "rev-parse", "HEAD")).not.toBe("");
	expect(gitOut(dir, "log", "-1", "--format=%an")).toBe("ThinkRail");
});

const SLOW_GIT_MS = 600;

async function withGitShim(
	dir: string,
	run: () => Promise<void> | void,
	opts: { slowBulkCommands?: boolean; recordFile?: string } = {},
): Promise<void> {
	const realGit = Bun.which("git");
	const sleep = opts.slowBulkCommands
		? `if [ "$1" = "-C" ] && { [ "$3" = "add" ] || [ "$3" = "commit" ]; }; then sleep ${
				SLOW_GIT_MS / 1000
			}; fi\n`
		: "";
	const record = opts.recordFile
		? `printf '%s\n' "$*" >> ${JSON.stringify(opts.recordFile)}\n`
		: "";
	writeFileSync(join(dir, "git"), `#!/bin/sh\n${sleep}${record}exec "${realGit}" "$@"\n`);
	chmodSync(join(dir, "git"), 0o755);
	const savedPath = process.env.PATH;
	process.env.PATH = `${dir}:${savedPath}`;
	try {
		await run();
	} finally {
		if (savedPath === undefined) delete process.env.PATH;
		else process.env.PATH = savedPath;
	}
}

test.skipIf(process.platform === "win32")(
	"initProject: keeps the host event loop responsive while add/commit run",
	async () => {
		const shimDir = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-proj-shim-")));
		const dir = join(dataDir, "slow-init");
		mkdirSync(dir);
		writeFileSync(join(dir, "hello.txt"), "hi\n");
		try {
			let wokeBeforeBulkGitFinished = false;
			await withGitShim(
				shimDir,
				async () => {
					const started = performance.now();
					const init = withoutUserGitConfig(() => initProject(dir));
					await Bun.sleep(150);
					wokeBeforeBulkGitFinished = performance.now() - started < SLOW_GIT_MS;
					await init;
				},
				{ slowBulkCommands: true },
			);
			expect(wokeBeforeBulkGitFinished).toBe(true);
		} finally {
			rmSync(shimDir, { recursive: true, force: true });
		}
	},
);

test.skipIf(process.platform === "win32")(
	"initProject: opts out of git auto-gc for the initial commit",
	async () => {
		const shimDir = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-proj-shim-")));
		const recordFile = join(shimDir, "calls.log");
		const dir = join(dataDir, "no-gc");
		mkdirSync(dir);
		writeFileSync(join(dir, "hello.txt"), "hi\n");
		try {
			await withGitShim(
				shimDir,
				async () => {
					await withoutUserGitConfig(() => initProject(dir));
				},
				{ recordFile },
			);
			const commitCall = readFileSync(recordFile, "utf8")
				.trim()
				.split("\n")
				.find((call) => call.includes(" commit "));
			expect(commitCall).toBeDefined();
			expect(commitCall).toContain("-c maintenance.auto=false");
			expect(commitCall).toContain("-c gc.auto=0");
		} finally {
			rmSync(shimDir, { recursive: true, force: true });
		}
	},
);

test("initProject: an existing repo is opened, not re-initialised (dedupe, history preserved)", async () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const originalHead = gitOut(repo, "rev-parse", "HEAD");

	const first = await initProject(repo);
	const second = await initProject(repo);
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

test("renameProject changes only the display name, publishes it, and survives close/reopen", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);
	const published: string[] = [];
	setProjectPublisher((snapshot) => published.push(snapshot.name));

	const renamed = renameProject(project.id, "  My\n  Project  ");

	expect(renamed).toMatchObject({
		id: project.id,
		name: "My Project",
		path: project.path,
		slug: project.slug,
	});
	expect(published).toEqual(["My Project"]);
	closeProject(project.id);
	expect(openProject(repo).name).toBe("My Project");
	expect(() => renameProject(project.id, "   ")).toThrow("Invalid project name");
	expect(() => renameProject(project.id, "x".repeat(101))).toThrow("Invalid project name");
	expect(() => renameProject("missing", "Name")).toThrow("Unknown project: missing");
});

test("setProjectTrust: persists a revocable, fail-closed trust decision", async () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = await initProject(repo);

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

test("setProjectTrust: pi-level resource trust needs its own explicit grant, and a revoke clears both", async () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = await initProject(repo);
	const published: Array<{ trusted: boolean | undefined; piResourceTrust: string | undefined }> =
		[];
	setProjectPublisher(({ trusted, piResourceTrust }) =>
		published.push({ trusted, piResourceTrust }),
	);
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
	expect(published).toEqual([
		{ trusted: true, piResourceTrust: "untrusted" },
		{ trusted: true, piResourceTrust: "granted" },
		{ trusted: true, piResourceTrust: "granted" },
		{ trusted: false, piResourceTrust: "untrusted" },
	]);
});

function writeProjects(records: object[]): void {
	writeFileSync(join(dataDir, "projects.json"), JSON.stringify(records));
}

function storedProjects(): Array<
	Pick<Project, "mcpToolGrants"> & { id: string; piResourceTrust?: string; trusted?: boolean }
> {
	return JSON.parse(readFileSync(join(dataDir, "projects.json"), "utf8"));
}

test("a record that predates pi-level trust is not grandfathered: it stays as stored and reads untrusted", () => {
	const repo = join(dataDir, "legacy");
	makeRepo(repo);
	const root = realpathSync(repo);
	writeProjects([{ id: "legacy", name: "legacy", path: root, slug: "legacy", lastOpened: 1 }]);
	const asked: string[] = [];
	setPiTrustSeed((path) => {
		asked.push(path);
		return true;
	});
	expect(getProjects()[0]?.piResourceTrust).toBeUndefined();
	expect(storedProjects()[0]?.piResourceTrust).toBeUndefined();
	expect(openProject(repo)).toMatchObject({ id: "legacy" });
	expect(storedProjects()[0]?.piResourceTrust).toBeUndefined();
	expect(asked).toEqual([]);
});

test("a newly added project starts untrusted unless pi already trusts its path", async () => {
	const plain = join(dataDir, "plain");
	const piTrusted = join(dataDir, "pi-trusted");
	makeRepo(plain);
	makeRepo(piTrusted);
	const trustedRoot = realpathSync(piTrusted);
	setPiTrustSeed((path) => realpathSync(path) === trustedRoot);

	expect(openProject(plain).piResourceTrust).toBe("untrusted");
	expect(openProject(piTrusted).piResourceTrust).toBe("granted");
	expect((await initProject(plain)).piResourceTrust).toBe("untrusted");
});

test("MCP approvals and per-project overrides persist in the project record and clear cleanly", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);

	approveProjectMcpServer(project.id, "linear", "fp-1");
	expect(approveProjectMcpServer(project.id, "linear", "fp-2").mcpApprovals).toEqual({
		linear: "fp-2",
	});

	const before = readFileSync(join(dataDir, "projects.json"), "utf8");
	expect(setProjectMcpOverride(project.id, "missing", {}).mcpOverrides).toBeUndefined();
	expect(readFileSync(join(dataDir, "projects.json"), "utf8")).toBe(before);
	setProjectMcpOverride(project.id, "context7", { enabled: false });
	const exposed = setProjectMcpOverride(project.id, "sentry", { exposure: "direct" });
	expect(exposed.mcpOverrides).toEqual({
		context7: { enabled: false },
		sentry: { exposure: "direct" },
	});
	setProjectMcpOverride(project.id, "context7", { exposure: "hidden" });
	expect(setProjectMcpOverride(project.id, "context7", {}).mcpOverrides?.context7).toEqual({
		enabled: false,
		exposure: "hidden",
	});
	setProjectMcpOverride(project.id, "context7", null);
	const cleared = setProjectMcpOverride(project.id, "sentry", null);
	expect(cleared.mcpOverrides).toBeUndefined();
	expect(storedProjects()[0]).not.toHaveProperty("mcpOverrides");
	expect(() => approveProjectMcpServer("nope", "x", "y")).toThrow();
});

test("MCP tool grants: deduplicated per server, reset by a new target, removed with the last tool", () => {
	const repo = join(dataDir, "mcp-grants");
	makeRepo(repo);
	const project = openProject(repo);

	grantProjectMcpTool(project.id, "linear", "t1", "mcp__linear__create_issue");
	grantProjectMcpTool(project.id, "linear", "t1", "mcp__linear__create_issue");
	grantProjectMcpTool(project.id, "linear", "t1", "mcp__linear__comment");
	grantProjectMcpTool(project.id, "__proto__", "t9", "mcp____proto____x");
	expect(storedProjects()[0]?.mcpToolGrants).toEqual({
		linear: { target: "t1", tools: ["mcp__linear__create_issue", "mcp__linear__comment"] },
		["__proto__"]: { target: "t9", tools: ["mcp____proto____x"] },
	});

	const moved = grantProjectMcpTool(project.id, "linear", "t2", "mcp__linear__comment");
	expect(moved.mcpToolGrants?.linear).toEqual({ target: "t2", tools: ["mcp__linear__comment"] });

	expect(
		revokeProjectMcpTool(project.id, "linear", "missing").mcpToolGrants?.linear?.tools,
	).toEqual(["mcp__linear__comment"]);
	revokeProjectMcpTool(project.id, "linear", "mcp__linear__comment");
	const cleared = revokeProjectMcpTool(project.id, "__proto__", "mcp____proto____x");
	expect(cleared.mcpToolGrants).toBeUndefined();
	expect(storedProjects()[0]).not.toHaveProperty("mcpToolGrants");
});

test("recent projects omit closed records whose folders are definitively gone", async () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const blocker = join(dataDir, "blocker");
	writeFileSync(blocker, "not a folder");
	const closed = (id: string, path: string, lastOpened: number) => ({
		id,
		name: id,
		path,
		slug: id,
		lastOpened,
		closed: true,
	});
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			closed("missing", join(dataDir, "missing"), 5),
			closed("file", blocker, 4),
			closed("nested", join(blocker, "child"), 3),
			closed("kept", repo, 2),
			{ id: "open-gone", name: "o", path: join(dataDir, "unplugged"), slug: "o", lastOpened: 1 },
		]),
	);

	await refreshRecentProjectFolders(1_000);

	expect(listRecentProjects().map((project) => project.id)).toEqual(["kept", "open-gone"]);
	expect(getProjects()).toHaveLength(5);
});

test("recent projects follow the last completed folder check of a closed record", async () => {
	const folder = join(dataDir, "moved");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "moved", name: "moved", path: folder, slug: "moved", lastOpened: 1, closed: true },
		]),
	);
	expect(listRecentProjects().map((project) => project.id)).toEqual(["moved"]);

	await refreshRecentProjectFolders(1_000);
	expect(listRecentProjects()).toEqual([]);

	mkdirSync(folder);
	await refreshRecentProjectFolders(1_000);
	expect(listRecentProjects().map((project) => project.id)).toEqual(["moved"]);
});

test("a folder check that outlasts the budget neither blocks the refresh nor repeats", async () => {
	const hung = join(dataDir, "hung");
	hungStatPaths.add(hung);
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "hung", name: "hung", path: hung, slug: "hung", lastOpened: 1, closed: true },
		]),
	);
	const calls = hungStatCalls;

	await refreshRecentProjectFolders(10);
	await refreshRecentProjectFolders(10);

	expect(hungStatCalls - calls).toBe(1);
	expect(listRecentProjects().map((project) => project.id)).toEqual(["hung"]);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"recent projects keep a closed record whose folder cannot be inspected",
	async () => {
		const locked = join(dataDir, "locked");
		const folder = join(locked, "repo");
		mkdirSync(folder, { recursive: true });
		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([
				{ id: "locked", name: "locked", path: folder, slug: "locked", lastOpened: 1, closed: true },
			]),
		);
		chmodSync(locked, 0o000);
		try {
			await refreshRecentProjectFolders(1_000);
		} finally {
			chmodSync(locked, 0o755);
		}

		expect(listRecentProjects().map((project) => project.id)).toEqual(["locked"]);
	},
);
