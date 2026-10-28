import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Project } from "@thinkrail/contracts";
import {
	cancelProjectClone,
	cloneProject,
	inspectCloneDestination,
	startProjectClone,
} from "./clone";
import { getProjects, setPiTrustSeed, setProjectPublisher } from "./projects";

let root: string;
let source: string;
let url: string;
const savedData = process.env.THINKRAIL_DATA_DIR;
const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
const savedSystem = process.env.GIT_CONFIG_SYSTEM;

function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
	return new TextDecoder().decode(result.stdout).trim();
}

beforeEach(() => {
	root = realpathSync.native(mkdtempSync(join(tmpdir(), "thinkrail-clone-")));
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.GIT_CONFIG_GLOBAL = join(root, "no-global-config");
	process.env.GIT_CONFIG_SYSTEM = join(root, "no-system-config");
	source = join(root, "source");
	mkdirSync(source);
	git(source, "init", "-b", "main");
	git(source, "config", "user.name", "Test");
	git(source, "config", "user.email", "test@example.invalid");
	git(source, "config", "commit.gpgsign", "false");
	writeFileSync(join(source, "README.md"), "first\n");
	git(source, "add", ".");
	git(source, "commit", "-m", "first");
	writeFileSync(join(source, "README.md"), "second\n");
	git(source, "commit", "-am", "second");
	url = pathToFileURL(source).href;
});

afterEach(() => {
	setProjectPublisher(null);
	setPiTrustSeed(null);
	for (const [key, value] of Object.entries({
		THINKRAIL_DATA_DIR: savedData,
		GIT_CONFIG_GLOBAL: savedGlobal,
		GIT_CONFIG_SYSTEM: savedSystem,
	})) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

test("clones a complete repository and opens it exactly once without granting trust", async () => {
	const published: Project[] = [];
	setProjectPublisher((project) => published.push(project));
	const path = inspectCloneDestination(root, "copy");
	expect(existsSync(path)).toBe(false);
	const project = await cloneProject({ url, parentPath: root, name: "copy" });
	if (!project) throw new Error("Clone unexpectedly cancelled");
	expect(project.path).toBe(path);
	expect(project?.piResourceTrust).toBe("untrusted");
	expect(published).toEqual([project]);
	expect(getProjects()).toEqual([project]);
	expect(git(path, "remote", "get-url", "origin")).toBe(url);
	expect(git(path, "rev-list", "--count", "HEAD")).toBe("2");
	expect(readFileSync(join(path, "README.md"), "utf8")).toBe("second\n");
});

test("honors shallow depth for file URLs", async () => {
	const project = await cloneProject({ url, parentPath: root, name: "shallow", depth: 1 });
	expect(project).not.toBeNull();
	expect(git(join(root, "shallow"), "rev-list", "--count", "HEAD")).toBe("1");
	expect(git(join(root, "shallow"), "rev-parse", "--is-shallow-repository")).toBe("true");
});

test("rejects existing empty folders, files and symlinks without changing them", async () => {
	mkdirSync(join(root, "empty"));
	writeFileSync(join(root, "file"), "keep");
	symlinkSync(source, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
	for (const name of ["empty", "file", "link"]) {
		await expect(cloneProject({ url, parentPath: root, name })).rejects.toMatchObject({
			code: "PROJECT_CLONE_DESTINATION_EXISTS",
			errorParams: { path: join(root, name) },
		});
		expect(existsSync(join(root, name))).toBe(true);
	}
	expect(readFileSync(join(root, "file"), "utf8")).toBe("keep");
});

test("rejects invalid folder names and depths before creating anything", async () => {
	for (const name of [
		"",
		".",
		"..",
		"../outside",
		"a/b",
		"a\\b",
		"bad\0name",
		"NUL",
		"CON.txt",
		"name.",
	]) {
		await expect(cloneProject({ url, parentPath: root, name })).rejects.toMatchObject({
			code: "PROJECT_CLONE_NAME_INVALID",
		});
	}
	for (const depth of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
		await expect(
			cloneProject({ url, parentPath: root, name: "invalid", depth }),
		).rejects.toMatchObject({
			code: "PROJECT_CLONE_DEPTH_INVALID",
		});
	}
	expect(existsSync(join(root, "invalid"))).toBe(false);
	expect(() => inspectCloneDestination("relative", "copy")).toThrow("absolute");
	expect(() => inspectCloneDestination(join(root, "missing"), "copy")).toThrow();
});

test("rejects helpers, options and credential-bearing URLs before writing", async () => {
	for (const badUrl of [
		"--upload-pack=evil",
		"ext::evil",
		"foo::https://host/repo",
		"-host:repo",
		"https://token@host/repo",
		"http://DOMAIN\\user:synthetic-secret@127.0.0.1/repo",
		"https://host/repo?token=secret",
		"ssh://git:secret@host/repo",
		"https://host/",
		"https://host/repo\n--evil",
	]) {
		await expect(
			cloneProject({ url: badUrl, parentPath: root, name: "invalid" }),
		).rejects.toThrow();
	}
	expect(existsSync(join(root, "invalid"))).toBe(false);
	expect(getProjects()).toEqual([]);
});

test.each([
	["not a url", "PROJECT_CLONE_URL_INVALID"],
	["C:repo", "PROJECT_CLONE_URL_LOCAL"],
	["ftp://host/repo", "PROJECT_CLONE_URL_PROTOCOL"],
	["https://secret@host/repo", "PROJECT_CLONE_URL_CREDENTIALS"],
	["https://host/", "PROJECT_CLONE_URL_PATH"],
	["file://remote/repo", "PROJECT_CLONE_FILE_HOST"],
])("classifies rejected URL %s without echoing it", async (badUrl, code) => {
	let failure: unknown;
	try {
		await cloneProject({ url: badUrl, parentPath: root, name: "invalid" });
	} catch (error) {
		failure = error;
	}
	expect(failure).toMatchObject({ code, errorParams: undefined });
	expect(JSON.stringify(failure)).not.toContain("secret");
	expect(existsSync(join(root, "invalid"))).toBe(false);
});

test("failed clone cleans its reservation and never registers a project", async () => {
	await expect(
		cloneProject({
			url: pathToFileURL(join(root, "missing-repo")).href,
			parentPath: root,
			name: "failed",
		}),
	).rejects.toThrow("Git clone failed");
	expect(existsSync(join(root, "failed"))).toBe(false);
	expect(getProjects()).toEqual([]);
});

test("rewritten credential URLs are redacted before long diagnostics are truncated", async () => {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response("failed", { status: 500 }),
	});
	const secret = "SYNTHETIC_SECRET_MUST_NOT_LEAK";
	try {
		const target = `http://127.0.0.1:${server.port}/${"a".repeat(2300)}?token=${secret}`;
		git(
			root,
			"config",
			"--file",
			join(root, "no-global-config"),
			`url.${target}.insteadOf`,
			"https://example.invalid/repo",
		);
		let failure: unknown;
		try {
			await cloneProject({
				url: "https://example.invalid/repo",
				parentPath: root,
				name: "redacted",
			});
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(Error);
		const message = failure instanceof Error ? failure.message : "";
		expect(message).toContain("[redacted]");
		expect(message).not.toContain(secret);
		expect(existsSync(join(root, "redacted"))).toBe(false);
	} finally {
		await server.stop(true);
	}
});

test("pre-cancelled clone creates no directory", async () => {
	const controller = new AbortController();
	controller.abort();
	expect(
		await cloneProject({ url, parentPath: root, name: "cancelled" }, controller.signal),
	).toBeNull();
	expect(existsSync(join(root, "cancelled"))).toBe(false);
});

test("owner cancellation waits for cleanup and permits a fresh attempt", async () => {
	const input = { operationId: "cancel-me", url, parentPath: root, name: "cancelled" };
	const pending = startProjectClone(input, "owner");
	cancelProjectClone(input.operationId, "owner");
	expect(await pending).toBeNull();
	expect(existsSync(join(root, "cancelled"))).toBe(false);
	expect(getProjects()).toEqual([]);
	expect(await startProjectClone(input, "owner")).not.toBeNull();
});

test("another client cannot cancel or reuse the owner's active operation", async () => {
	const input = { operationId: "same-id", url, parentPath: root, name: "owned" };
	const pending = startProjectClone(input, "owner");
	cancelProjectClone(input.operationId, "other-client");
	await expect(startProjectClone(input, "owner")).rejects.toThrow("already running");
	expect(await pending).not.toBeNull();
	cancelProjectClone(input.operationId, "owner");
});

test("concurrent requests cannot overwrite the same destination", async () => {
	const input = { url, parentPath: root, name: "contended" };
	const pending = cloneProject(input);
	await expect(cloneProject(input)).rejects.toThrow("already exists");
	expect(await pending).not.toBeNull();
	expect(getProjects()).toHaveLength(1);
});

test("a project-opening failure preserves the successful checkout", async () => {
	setPiTrustSeed(() => {
		throw new Error("registration failed");
	});
	await expect(cloneProject({ url, parentPath: root, name: "preserved" })).rejects.toThrow(
		"registration failed",
	);
	expect(git(join(root, "preserved"), "rev-parse", "HEAD")).toBe(git(source, "rev-parse", "HEAD"));
	expect(getProjects()).toEqual([]);
});
