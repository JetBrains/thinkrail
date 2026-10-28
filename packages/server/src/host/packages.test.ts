import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { PiPackageSummary, PiPackagesCatalog } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { setPiPackagesPublisher } from "../agent";
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

function writeFixturePackage(dir: string): void {
	mkdirSync(join(dir, "extensions"), { recursive: true });
	mkdirSync(join(dir, "skills", "triage"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "@fixture/pi-tools",
			version: "0.1.0",
			description: "Fixture tools",
			pi: { extensions: ["./extensions/*.ts"], skills: ["./skills"] },
		}),
	);
	writeFileSync(
		join(dir, "extensions", "hello.ts"),
		[
			"export default function (pi) {",
			'  pi.registerTool({ name: "fixture_hello", label: "fixture_hello", description: "fixture",',
			'    parameters: { type: "object", properties: {} },',
			'    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) });',
			"}",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(dir, "skills", "triage", "SKILL.md"),
		"---\nname: triage\ndescription: Triage fixture.\n---\n\n# triage\n",
	);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "host-packages-"));
	repo = join(root, "repo");
	agentDir = join(root, "agent");
	pkg = join(root, "pkgs", "fixture-tools");
	mkdirSync(repo, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFixturePackage(pkg);
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
	expect(withWorkspace.packages.map((p) => p.scope)).toEqual(["project"]);
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

test("resource toggles write pi's format and reveal validates its target", async () => {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
	await handleRequest(
		"packages.setResourceEnabled",
		{
			path: join(pkg, "extensions", "hello.ts"),
			type: "extensions",
			scope: "user",
			enabled: false,
		},
		CTX,
	);
	expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages).toEqual([
		{ source: pkg, extensions: ["-extensions/hello.ts"] },
	]);
	const catalog = await list();
	expect(catalog.packages[0]?.resources.find((r) => r.displayName === "hello.ts")?.enabled).toBe(
		false,
	);
	const error = await handleRequest(
		"packages.reveal",
		{ path: join(root, "elsewhere") },
		CTX,
	).catch((e) => e);
	expect(errorCodeOf(error)).toBe("PACKAGE_UNKNOWN");
});
