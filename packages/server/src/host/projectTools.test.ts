import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ClonePlan } from "../agent";
import { closeProject, listProjects, openProject, setProjectPublisher } from "../projects";
import { getConfig, resetConfigCache, updateConfig } from "../settings";
import {
	cloneOpenProject,
	expandRepository,
	isPathLike,
	type ProjectToolsDeps,
	planOpenProject,
	repositoryFolderName,
	repositoryKey,
} from "./projectTools";

let root: string;
let source: string;
let url: string;
let folder: string;
const saved = {
	THINKRAIL_DATA_DIR: process.env.THINKRAIL_DATA_DIR,
	GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
	GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
};

function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
	return new TextDecoder().decode(result.stdout).trim();
}

function repo(path: string): string {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-b", "main");
	git(path, "config", "user.name", "Test");
	git(path, "config", "user.email", "test@example.invalid");
	git(path, "config", "commit.gpgsign", "false");
	writeFileSync(join(path, "README.md"), "hello\n");
	git(path, "add", ".");
	git(path, "commit", "-m", "first");
	return path;
}

const deps = (cwd = root): ProjectToolsDeps => ({
	callerCwd: () => cwd,
	remoteUrls: async (path) =>
		git(path, "config", "--get-regexp", "^remote\\..*\\.url$")
			.split("\n")
			.filter(Boolean)
			.map((line) => line.slice(line.indexOf(" ") + 1)),
});

beforeEach(() => {
	root = realpathSync.native(mkdtempSync(join(tmpdir(), "thinkrail-open-project-")));
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.GIT_CONFIG_GLOBAL = join(root, "no-global-config");
	process.env.GIT_CONFIG_SYSTEM = join(root, "no-system-config");
	resetConfigCache();
	source = repo(join(root, "upstream", "widget"));
	url = pathToFileURL(source).href;
	folder = join(root, "projects");
	updateConfig({ projectsFolder: folder });
});

afterEach(() => {
	setProjectPublisher(null);
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	resetConfigCache();
	rmSync(root, { recursive: true, force: true });
});

test("one repository matches across HTTPS, SSH, scp-style and .git spellings", () => {
	const key = "github.com/fastify/fastify";
	for (const spelling of [
		"https://github.com/fastify/fastify",
		"https://github.com/Fastify/Fastify.git",
		"https://github.com/fastify/fastify/",
		"ssh://git@github.com/fastify/fastify.git",
		"ssh://git@github.com:22/fastify/fastify.git",
		"git@github.com:fastify/fastify.git",
		"git://github.com/fastify/fastify",
	]) {
		expect(repositoryKey(spelling)).toBe(key);
	}
	expect(repositoryKey("https://gitlab.com/fastify/fastify")).not.toBe(key);
	expect(repositoryKey("file:///srv/repos/widget.git")).toBe("file:/srv/repos/widget");
	expect(repositoryKey("https://host/a%zz")).toBeNull();
	expect(repositoryFolderName("git@github.com:fastify/fastify.git")).toBe("fastify");
	expect(repositoryFolderName("file:///srv/repos/widget.git")).toBe("widget");
	expect(repositoryFolderName("https://github.com/microsoft/TypeScript.git")).toBe("TypeScript");
	expect(repositoryFolderName("https://host/a%zz")).toBe("repository");
});

test("owner/repo means GitHub; paths need an explicit absolute, ~ or ./ start", () => {
	expect(expandRepository("fastify/fastify")).toBe("https://github.com/fastify/fastify.git");
	expect(expandRepository("fastify/fastify.git")).toBe("https://github.com/fastify/fastify.git");
	expect(expandRepository("https://example.com/a/b")).toBe("https://example.com/a/b");
	for (const path of ["/srv/app", "~", "~/code/app", "./app", "../app", "C:\\code\\app"]) {
		expect(isPathLike(path)).toBe(true);
	}
	for (const notPath of ["fastify/fastify", "git@github.com:a/b", "https://x/y"]) {
		expect(isPathLike(notPath)).toBe(false);
	}
});

test("a new repository plans a clone into the projects folder, with the notice only the first time", async () => {
	expect(getConfig().projectsFolderNoticeShown).toBe(false);
	const first = await planOpenProject("s-1", { repository: url }, deps());
	expect(first).toEqual({
		kind: "clone",
		url,
		parentPath: folder,
		name: "widget",
		destination: join(folder, "widget"),
		notice: true,
	});
	expect(existsSync(folder)).toBe(false);
	expect(getConfig().projectsFolderNoticeShown).toBe(true);
	const again = await planOpenProject("s-1", { repository: url }, deps());
	expect(again.kind === "clone" && again.notice).toBe(false);
});

test("the planned clone creates the folder, opens the project, and the next call reuses it", async () => {
	const plan = (await planOpenProject("s-1", { repository: url }, deps())) as ClonePlan;
	const cloned = await cloneOpenProject("s-1", plan, deps());
	expect(cloned).toMatchObject({ name: "widget", path: join(folder, "widget"), outcome: "cloned" });
	expect(git(cloned.path, "rev-list", "--count", "HEAD")).toBe("1");

	const reused = await planOpenProject("s-1", { repository: `${url}/` }, deps());
	expect(reused).toEqual({ kind: "ready", project: { ...cloned, outcome: "open" } });

	closeProject(cloned.projectId);
	const reopened = await planOpenProject("s-1", { repository: url }, deps());
	expect(reopened).toEqual({ kind: "ready", project: { ...cloned, outcome: "opened" } });
	expect(listProjects().map((project) => project.id)).toEqual([cloned.projectId]);
});

test("a project whose upstream remote is the repository counts as that repository", async () => {
	const fork = repo(join(root, "elsewhere", "my-fork"));
	git(fork, "remote", "add", "origin", "https://github.com/me/widget.git");
	git(fork, "remote", "add", "upstream", "git@github.com:acme/widget.git");
	const project = openProject(fork);
	const plan = await planOpenProject("s-1", { repository: "acme/widget" }, deps());
	expect(plan).toEqual({
		kind: "ready",
		project: {
			projectId: project.id,
			name: project.name,
			slug: project.slug,
			path: project.path,
			outcome: "open",
		},
	});
});

test("a clone of the repository already in the projects folder is opened, an unrelated folder is skipped", async () => {
	mkdirSync(join(folder, "widget"), { recursive: true });
	writeFileSync(join(folder, "widget", "notes.txt"), "not a repo\n");
	const skipped = await planOpenProject("s-1", { repository: url }, deps());
	expect(skipped).toMatchObject({ kind: "clone", name: "widget-2" });

	git(folder, "clone", "--quiet", url, "widget-2");
	const found = await planOpenProject("s-1", { repository: url }, deps());
	expect(found).toMatchObject({
		kind: "ready",
		project: { path: join(folder, "widget-2"), outcome: "opened" },
	});
});

test("a local repository opens without a prompt; a plain or missing folder is refused", async () => {
	const local = repo(join(root, "code", "app"));
	const opened = await planOpenProject("s-1", { repository: "./code/app" }, deps(root));
	expect(opened).toMatchObject({ kind: "ready", project: { path: local, outcome: "opened" } });
	const again = await planOpenProject("s-1", { repository: local }, deps());
	expect(again).toMatchObject({ kind: "ready", project: { path: local, outcome: "open" } });

	mkdirSync(join(root, "plain"));
	await expect(planOpenProject("s-1", { repository: join(root, "plain") }, deps())).rejects.toThrow(
		"is not a Git repository; open_project does not initialize folders.",
	);
	expect(existsSync(join(root, "plain", ".git"))).toBe(false);
	await expect(
		planOpenProject("s-1", { repository: join(root, "nowhere") }, deps()),
	).rejects.toThrow("No folder at");
});

test("one project with a malformed remote URL does not break matching for the others", async () => {
	const broken = repo(join(root, "elsewhere", "broken"));
	git(broken, "remote", "add", "origin", "https://host/a%zz");
	openProject(broken);
	const plan = await planOpenProject("s-1", { repository: url }, deps());
	expect(plan).toMatchObject({ kind: "clone", name: "widget" });
});

test("a malformed repository is refused before any prompt", async () => {
	await expect(planOpenProject("s-1", { repository: "  " }, deps())).rejects.toThrow(
		"Pass a repository",
	);
	await expect(planOpenProject("s-1", { repository: "ext::sh -c evil" }, deps())).rejects.toThrow();
	expect(getConfig().projectsFolderNoticeShown).toBe(false);
});

test("Stop during the clone leaves nothing behind", async () => {
	const plan = (await planOpenProject("s-1", { repository: url }, deps())) as ClonePlan;
	const controller = new AbortController();
	controller.abort();
	await expect(cloneOpenProject("s-1", plan, deps(), controller.signal)).rejects.toThrow(
		"Stopped; nothing was cloned.",
	);
	expect(existsSync(join(folder, "widget"))).toBe(false);
});
