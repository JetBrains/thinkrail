import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import type { PiPackageSummary, PiPackagesCatalog } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { setPiPackagesPublisher } from "../agent";
import { writeFixturePiPackage } from "../agent/packages/testFixtures";
import { getConfig, resetConfigCache, updateConfig } from "../settings";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "test-client" };
const saved = {
	data: process.env.THINKRAIL_DATA_DIR,
	agent: process.env.PI_CODING_AGENT_DIR,
	offline: process.env.PI_OFFLINE,
};
let root: string;
let repo: string;
let agentDir: string;
let pkg: string;
let published = 0;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "host-packages-"));
	repo = join(root, "repo");
	agentDir = join(root, "agent");
	pkg = join(root, "pkgs", "fixture-tools");
	mkdirSync(repo, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFixturePiPackage(pkg, { description: "Fixture tools", prompts: [] });
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	mkdirSync(join(root, "data"), { recursive: true });
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify([
			{
				id: "p1",
				name: "repo",
				path: repo,
				slug: "repo",
				lastOpened: 1,
				piResourceTrust: "granted",
			},
		]),
	);
	writeFileSync(
		join(root, "data", "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				kind: "default",
				name: "Default",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
			},
		]),
	);
	resetConfigCache();
	published = 0;
	setPiPackagesPublisher(() => {
		published += 1;
	});
});

afterEach(() => {
	setPiPackagesPublisher(null);
	rmSync(root, { recursive: true, force: true });
	for (const [name, value] of [
		["THINKRAIL_DATA_DIR", saved.data],
		["PI_CODING_AGENT_DIR", saved.agent],
		["PI_OFFLINE", saved.offline],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	resetConfigCache();
});

const list = (workspaceId?: string) =>
	handleRequest(
		"packages.list",
		workspaceId ? { workspaceId } : {},
		CTX,
	) as Promise<PiPackagesCatalog>;

test("lists user scope without a workspace and repository scope with a trusted one", async () => {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
	mkdirSync(join(repo, ".pi"), { recursive: true });
	writeFileSync(join(repo, ".pi", "settings.json"), JSON.stringify({ packages: [pkg] }));

	const userOnly = await list();
	expect(userOnly.projectSettingsPath).toBeUndefined();
	expect(userOnly.packages.map((p) => [p.name, p.scope])).toEqual([["@fixture/pi-tools", "user"]]);
	expect(userOnly.builtins.map((b) => b.name)).toEqual(["mcp", "tool-search"]);

	const withWorkspace = await list("w1");
	expect(withWorkspace.projectTrusted).toBe(true);
	expect(withWorkspace.projectSettingsPath).toBe(join(repo, ".pi", "settings.json"));
	expect(withWorkspace.packages.map((p) => [p.scope, p.shadowed ?? false])).toEqual([
		["user", true],
		["project", false],
	]);
});

test("installing for me a package the repository already declares returns a row instead of failing", async () => {
	mkdirSync(join(repo, ".pi"), { recursive: true });
	writeFileSync(join(repo, ".pi", "settings.json"), JSON.stringify({ packages: [pkg] }));
	const summary = (await handleRequest(
		"packages.install",
		{ source: pkg, scope: "user", workspaceId: "w1" },
		CTX,
	)) as PiPackageSummary;
	expect(summary).toMatchObject({ scope: "user", shadowed: true, enabled: true });
});

test("reveal opens a single-file package's folder, not the file, and a forced check bypasses the cache", async () => {
	const single = join(root, "pkgs", "single.ts");
	writeFileSync(single, "export default function () {}\n");
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [single] }));
	const revealed: string[] = [];
	const editors = await import("../editors");
	const reveal = spyOn(editors, "revealInFileManager").mockImplementation((path: string) => {
		revealed.push(path);
	});
	try {
		await handleRequest("packages.reveal", { path: single }, CTX);
		expect(revealed).toEqual([join(root, "pkgs")]);
	} finally {
		reveal.mockRestore();
	}
	const first = await handleRequest("packages.checkUpdates", {}, CTX);
	const forced = await handleRequest("packages.checkUpdates", { force: true }, CTX);
	expect(first).toEqual([]);
	expect(forced).toEqual([]);
});

test("install returns the new row, turns the package on, and publishes a change", async () => {
	updateConfig({ disabledPackages: [`local:${pkg}`] });
	const summary = (await handleRequest(
		"packages.install",
		{ source: pkg, scope: "user" },
		CTX,
	)) as PiPackageSummary;
	expect(summary).toMatchObject({ name: "@fixture/pi-tools", scope: "user", enabled: true });
	expect(summary.resources.find((r) => r.displayName === "hello.ts")?.tools).toEqual([
		"fixture_hello",
	]);
	expect(getConfig().disabledPackages).toEqual([]);
	expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages).toEqual([
		relative(agentDir, pkg),
	]);
	expect(published).toBeGreaterThan(0);

	await handleRequest("packages.remove", { source: relative(agentDir, pkg), scope: "user" }, CTX);
	expect((await list()).packages).toHaveLength(0);
});

test("a remove whose uninstall fails still reconciles chats and pages with the persisted declaration", async () => {
	await handleRequest("packages.install", { source: pkg, scope: "user" }, CTX);
	published = 0;
	const remove = spyOn(DefaultPackageManager.prototype, "remove").mockRejectedValue(
		new Error("EACCES"),
	);
	try {
		const error = await handleRequest(
			"packages.remove",
			{ source: relative(agentDir, pkg), scope: "user" },
			CTX,
		).catch((e) => e);
		expect(errorCodeOf(error)).toBe("PACKAGE_REMOVE_FAILED");
	} finally {
		remove.mockRestore();
	}
	expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages).toEqual([]);
	expect(published).toBeGreaterThan(0);
	expect((await list()).packages).toHaveLength(0);
});

test("a file:// source lists, removes and installs like the path it names", async () => {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [`file://${pkg}`] }));
	const listed = (await list()).packages;
	expect(listed).toHaveLength(1);
	expect(listed[0]).toMatchObject({ identity: `local:${pkg}`, source: `file://${pkg}` });
	await handleRequest("packages.remove", { source: `file://${pkg}`, scope: "user" }, CTX);
	expect((await list()).packages).toHaveLength(0);
	const summary = (await handleRequest(
		"packages.install",
		{ source: `file://${pkg}`, scope: "user" },
		CTX,
	)) as PiPackageSummary;
	expect(summary.identity).toBe(`local:${pkg}`);
	expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages).toEqual([
		relative(agentDir, pkg),
	]);
});

test("installing for the repository a folder the user already declares returns the one row and clears every key", async () => {
	const tools = join(repo, "tools");
	writeFixturePiPackage(tools, { prompts: [] });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [tools] }));
	updateConfig({ disabledPackages: ["local:project:tools"] });
	expect((await list("w1")).packages[0]).toMatchObject({
		scope: "user",
		enabled: true,
		switchKeys: [`local:${tools}`],
	});
	const summary = (await handleRequest(
		"packages.install",
		{ source: "./tools", scope: "project", workspaceId: "w1" },
		CTX,
	)) as PiPackageSummary;
	expect(summary).toMatchObject({ scope: "project", enabled: true });
	expect(summary.switchKeys.sort()).toEqual([`local:${tools}`, "local:project:tools"].sort());
	expect(getConfig().disabledPackages).toEqual([]);
	const rows = (await list("w1")).packages;
	expect(rows.map((row) => [row.scope, row.enabled, row.shadowed ?? false])).toEqual([
		["user", true, true],
		["project", true, false],
	]);
});

test("a failure after the declaration was written is not reported as an install failure", async () => {
	const listConfigured = spyOn(
		DefaultPackageManager.prototype,
		"listConfiguredPackages",
	).mockImplementationOnce(() => {
		throw new Error("catalog exploded");
	});
	try {
		const error = await handleRequest(
			"packages.install",
			{ source: pkg, scope: "user" },
			CTX,
		).catch((e) => e);
		expect(errorCodeOf(error)).toBe("PACKAGE_INSTALLED_UNLISTED");
		expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages).toEqual([
			relative(agentDir, pkg),
		]);
	} finally {
		listConfigured.mockRestore();
	}
	expect((await list()).packages).toHaveLength(1);
});

test("a repository install needs a trusted project", async () => {
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1, piResourceTrust: "unset" },
		]),
	);
	const error = await handleRequest(
		"packages.install",
		{ source: pkg, scope: "project", workspaceId: "w1" },
		CTX,
	).catch((e) => e);
	expect(errorCodeOf(error)).toBe("PACKAGE_UNTRUSTED");
});

test("built-in toggles write pi's format, in-package ones are refused, and reveal validates its target", async () => {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
	await handleRequest(
		"packages.setResourceEnabled",
		{ path: "builtin:tool-search", type: "extensions", scope: "user", enabled: false },
		CTX,
	);
	expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).extensions).toEqual([
		"-builtin:tool-search",
	]);
	const refused = await handleRequest(
		"packages.setResourceEnabled",
		{
			path: join(pkg, "extensions", "hello.ts"),
			type: "extensions",
			scope: "user",
			enabled: false,
		},
		CTX,
	).catch((e) => e);
	expect(errorCodeOf(refused)).toBe("PACKAGE_SOURCE_INVALID");
	expect((await list()).builtins.find((b) => b.name === "tool-search")?.enabled).toBe(false);
	const error = await handleRequest(
		"packages.reveal",
		{ path: join(root, "elsewhere") },
		CTX,
	).catch((e) => e);
	expect(errorCodeOf(error)).toBe("PACKAGE_UNKNOWN");
});
