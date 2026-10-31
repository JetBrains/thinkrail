import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { invalidatePiPackageCatalog, listPiPackageCatalog } from "./catalog";
import {
	forgetExtensionInfo,
	probeExtensionInfo,
	recordLoadedExtensions,
	setExtensionInfoListener,
} from "./extensionInfo";
import { piPackageIdentity, piPackageSourceKind } from "./identity";
import { createPiSettings, setDisabledPackagesResolver } from "./settingsView";
import { fixtureExtensionSource, writeFixturePiPackage } from "./testFixtures";

const extensionSource = fixtureExtensionSource;

function writeFixturePackage(root: string): string {
	return writeFixturePiPackage(join(root, "pkgs", "fixture-tools"), {
		description: "Fixture tools for the catalog",
	});
}

describe("piPackageIdentity", () => {
	const resolveLocal = (path: string) => `/abs/${path}`;
	it("keys npm by name, git by host/path without ref, local by resolved path", () => {
		expect(piPackageIdentity("npm:@acme/pi-jira@1.4.2", resolveLocal)).toBe("npm:@acme/pi-jira");
		expect(piPackageIdentity("npm:pi-plain", resolveLocal)).toBe("npm:pi-plain");
		expect(piPackageIdentity("git:github.com/acme/pi-tools@v2", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(piPackageIdentity("git:github.com/acme/pi-tools@feature/foo", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(piPackageIdentity("https://GitHub.com/acme/pi-tools.git", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(
			piPackageIdentity("https://user:token@github.com/acme/pi-tools@feature/x", resolveLocal),
		).toBe("git:github.com/acme/pi-tools");
		expect(piPackageIdentity("git:git@github.com:acme/pi-tools@main", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(piPackageIdentity("git:github:acme/pi-tools", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(piPackageIdentity("git:gitlab:acme/pi-tools@v1", resolveLocal)).toBe(
			"git:gitlab.com/acme/pi-tools",
		);
		expect(piPackageIdentity("./tools", resolveLocal)).toBe("local:/abs/./tools");
	});
	it("classifies sources the way pi does: only git: and scheme URLs are git, everything else is a path", () => {
		expect(piPackageSourceKind("npm:x")).toBe("npm");
		expect(piPackageSourceKind("git:github.com/a/b")).toBe("git");
		expect(piPackageSourceKind("https://github.com/a/b")).toBe("git");
		expect(piPackageSourceKind("ssh://git@github.com/a/b")).toBe("git");
		expect(piPackageSourceKind("git@github.com:a/b")).toBe("local");
		expect(piPackageSourceKind("github:a/b")).toBe("local");
		expect(piPackageSourceKind("~/pi/tools")).toBe("local");
		expect(piPackageSourceKind("./tools")).toBe("local");
	});
});

describe("listPiPackageCatalog", () => {
	let root: string;
	let agentDir: string;
	let pkg: string;
	const originalOffline = process.env.PI_OFFLINE;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "thinkrail-pi-packages-"));
		agentDir = join(root, "agent");
		mkdirSync(join(agentDir, "extensions"), { recursive: true });
		pkg = writeFixturePackage(root);
		invalidatePiPackageCatalog();
		forgetExtensionInfo();
	});
	afterEach(() => {
		if (originalOffline === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = originalOffline;
		rmSync(root, { recursive: true, force: true });
	});

	it("lists packages with their resources and chips, loose files, and built-ins", async () => {
		writeFileSync(join(agentDir, "extensions", "guard.ts"), extensionSource("guard_tool"));
		writeFileSync(
			join(agentDir, "extensions", "broken.ts"),
			"export default function (pi) {\n  throw new Error('boom');\n}\n",
		);
		const explicitDir = join(root, "custom");
		mkdirSync(explicitDir, { recursive: true });
		writeFileSync(join(explicitDir, "x.ts"), extensionSource("explicit_tool"));
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				packages: [{ source: pkg, extensions: ["-extensions/legacy.ts"] }],
				extensions: [join(explicitDir, "x.ts"), "-builtin:mcp"],
			}),
		);

		const options = {
			agentDir,
			projectTrusted: false,
			builtinExtensions: ["mcp", "tool-search"],
			disabledPackages: new Set<string>(),
		};
		const bare = await listPiPackageCatalog(options);
		expect(bare.packages[0]?.resources.every((r) => r.tools === undefined)).toBe(true);
		expect(
			bare.loose.every((entry) => entry.tools === undefined && entry.error === undefined),
		).toBe(true);

		await probeExtensionInfo(agentDir, agentDir, [
			join(pkg, "extensions", "hello.ts"),
			join(agentDir, "extensions", "guard.ts"),
			join(agentDir, "extensions", "broken.ts"),
			join(explicitDir, "x.ts"),
		]);
		invalidatePiPackageCatalog();
		const catalog = await listPiPackageCatalog(options);

		expect(catalog.agentDir).toBe(agentDir);
		expect(catalog.settingsPath).toBe(join(agentDir, "settings.json"));
		expect(catalog.projectSettingsPath).toBeUndefined();

		expect(catalog.packages).toHaveLength(1);
		const summary = catalog.packages[0];
		expect(summary).toMatchObject({
			identity: `local:${pkg}`,
			source: pkg,
			kind: "local",
			scope: "user",
			name: "@fixture/pi-tools",
			version: "0.1.0",
			description: "Fixture tools for the catalog",
			installedPath: pkg,
			enabled: true,
		});
		expect(summary?.shadowed).toBeUndefined();
		const byName = Object.fromEntries((summary?.resources ?? []).map((r) => [r.displayName, r]));
		expect(byName["hello.ts"]).toMatchObject({
			type: "extensions",
			enabled: true,
			tools: ["fixture_hello"],
			commands: ["hello"],
		});
		expect(byName["legacy.ts"]).toMatchObject({ type: "extensions", enabled: false });
		expect(byName["legacy.ts"]?.tools).toBeUndefined();
		expect(byName.triage).toMatchObject({ type: "skills", enabled: true });
		expect(byName["standup.md"]).toMatchObject({ type: "prompts", enabled: true });

		const loose = Object.fromEntries(catalog.loose.map((entry) => [entry.displayName, entry]));
		expect(loose["guard.ts"]).toMatchObject({
			scope: "user",
			explicit: false,
			enabled: true,
			tools: ["guard_tool"],
		});
		expect(loose["broken.ts"]?.error).toContain("boom");
		expect(loose["custom/x.ts"]).toMatchObject({ explicit: true, tools: ["explicit_tool"] });

		expect(catalog.builtins).toEqual([
			{ name: "mcp", enabled: false, scope: "user" },
			{ name: "tool-search", enabled: true, scope: "user" },
		]);
	});

	it("reports a disabled package as off and never needs its code to list it", async () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		const catalog = await listPiPackageCatalog({
			agentDir,
			projectTrusted: false,
			builtinExtensions: [],
			disabledPackages: new Set([`local:${pkg}`]),
		});
		expect(catalog.packages[0]).toMatchObject({ enabled: false });
		const hello = catalog.packages[0]?.resources.find((r) => r.displayName === "hello.ts");
		expect(hello?.enabled).toBe(true);
		expect(hello?.tools).toBeUndefined();
	});

	it("takes chips from what a loader last recorded and forgets them once the file changes", async () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		const options = {
			agentDir,
			projectTrusted: false,
			builtinExtensions: [],
			disabledPackages: new Set<string>(),
		};
		const hello = join(pkg, "extensions", "hello.ts");
		const toolsOfHello = async () =>
			(await listPiPackageCatalog(options)).packages[0]?.resources.find(
				(r) => r.displayName === "hello.ts",
			)?.tools;
		expect(await toolsOfHello()).toBeUndefined();
		recordLoadedExtensions({
			extensions: [
				{ resolvedPath: hello, tools: new Map([["from_session", 1]]), commands: new Map() },
			],
			errors: [],
		});
		invalidatePiPackageCatalog();
		expect(await toolsOfHello()).toEqual(["from_session"]);
		await new Promise((done) => setTimeout(done, 20));
		writeFileSync(hello, extensionSource("fixture_hello_v2"));
		invalidatePiPackageCatalog();
		expect(await toolsOfHello()).toBeUndefined();
	});

	it("lists a declared package that is missing on disk as not installed, and never installs it", async () => {
		delete process.env.PI_OFFLINE;
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: ["npm:@fixture/not-installed@1.0.0", pkg] }),
		);
		const prototype = DefaultPackageManager.prototype as unknown as Record<string, unknown>;
		const installNpm = spyOn(prototype as { installNpm: () => Promise<void> }, "installNpm");
		const install = spyOn(DefaultPackageManager.prototype, "install");
		try {
			const catalog = await listPiPackageCatalog({
				agentDir,
				projectTrusted: false,
				builtinExtensions: [],
				disabledPackages: new Set(),
			});
			expect(catalog.packages.map((p) => [p.name, p.installedPath !== undefined])).toEqual([
				["@fixture/not-installed", false],
				["@fixture/pi-tools", true],
			]);
			expect(catalog.packages[0]).toMatchObject({
				kind: "npm",
				identity: "npm:@fixture/not-installed",
				resources: [],
			});
			expect(installNpm).not.toHaveBeenCalled();
			expect(install).not.toHaveBeenCalled();
		} finally {
			installNpm.mockRestore();
			install.mockRestore();
		}
	});

	it("lists a declared package even when it contributes nothing, and a single-file package", async () => {
		const empty = join(root, "pkgs", "empty");
		mkdirSync(empty, { recursive: true });
		writeFileSync(join(empty, "package.json"), JSON.stringify({ name: "@fixture/empty", pi: {} }));
		const single = join(root, "pkgs", "single.ts");
		writeFileSync(single, extensionSource("single_tool"));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [empty, single] }));
		const catalog = await listPiPackageCatalog({
			agentDir,
			projectTrusted: false,
			builtinExtensions: [],
			disabledPackages: new Set(),
		});
		const byName = Object.fromEntries(catalog.packages.map((p) => [p.name, p]));
		expect(byName["@fixture/empty"]).toMatchObject({ resources: [] });
		expect(byName["single.ts"]).toMatchObject({ installedPath: single });
		expect(byName["single.ts"]?.resources[0]).toMatchObject({ type: "extensions" });
	});

	it("keeps a user declaration pi shadows behind the repository's, marked as such", async () => {
		const project = join(root, "project");
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ packages: [pkg] }));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		const catalog = await listPiPackageCatalog({
			cwd: project,
			agentDir,
			projectTrusted: true,
			builtinExtensions: [],
			disabledPackages: new Set(),
		});
		const user = catalog.packages.find((p) => p.scope === "user");
		const repo = catalog.packages.find((p) => p.scope === "project");
		expect(user).toMatchObject({ shadowed: true, resources: [] });
		expect(repo?.shadowed).toBeUndefined();
		expect(repo?.resources.length).toBeGreaterThan(0);
	});

	it("puts a repository autoload:false override's resources on the user row, which is not shadowed", async () => {
		const project = join(root, "project");
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		writeFileSync(
			join(project, ".pi", "settings.json"),
			JSON.stringify({
				packages: [{ source: pkg, autoload: false, extensions: ["-extensions/legacy.ts"] }],
			}),
		);
		const catalog = await listPiPackageCatalog({
			cwd: project,
			agentDir,
			projectTrusted: true,
			builtinExtensions: [],
			disabledPackages: new Set(),
		});
		expect(catalog.packages).toHaveLength(1);
		const user = catalog.packages[0];
		expect(user).toMatchObject({ scope: "user" });
		expect(user?.shadowed).toBeUndefined();
		const byName = Object.fromEntries((user?.resources ?? []).map((r) => [r.displayName, r]));
		expect(byName["legacy.ts"]).toMatchObject({ enabled: false });
		expect(byName["hello.ts"]).toMatchObject({ enabled: true });
	});

	it("switching off a repository's local package also covers a user declaration of the same folder", async () => {
		const project = join(root, "project");
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFixturePiPackage(join(project, "tools"));
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: [join(project, "tools")] }),
		);
		writeFileSync(
			join(project, ".pi", "settings.json"),
			JSON.stringify({
				packages: [{ source: "../tools", autoload: false, extensions: ["-extensions/legacy.ts"] }],
			}),
		);
		const options = { cwd: project, agentDir, projectTrusted: true, builtinExtensions: [] };
		const on = await listPiPackageCatalog({ ...options, disabledPackages: new Set() });
		expect(on.packages).toHaveLength(1);
		expect(on.packages[0]).toMatchObject({
			scope: "user",
			identity: `local:${join(project, "tools")}`,
			enabled: true,
		});
		expect(on.packages[0]?.resources.find((r) => r.displayName === "legacy.ts")?.enabled).toBe(
			false,
		);
		invalidatePiPackageCatalog();
		const projectKey = `local:project:${project}:tools`;
		const off = await listPiPackageCatalog({
			...options,
			disabledPackages: new Set([projectKey]),
		});
		expect(off.packages[0]?.enabled).toBe(false);
		const view = createPiSettings(project, agentDir, { projectTrusted: true, packages: "enabled" });
		setDisabledPackagesResolver(() => new Set([projectKey]));
		try {
			expect(view.getGlobalSettings().packages).toEqual([]);
			expect(view.getProjectSettings().packages).toEqual([]);
		} finally {
			setDisabledPackagesResolver(() => new Set());
		}
	});

	it("re-lists after a chat records a file it already showed without chips", async () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		const hello = join(pkg, "extensions", "hello.ts");
		const options = {
			agentDir,
			projectTrusted: false,
			builtinExtensions: [],
			disabledPackages: new Set<string>(),
		};
		let published = 0;
		setExtensionInfoListener(() => {
			invalidatePiPackageCatalog();
			published += 1;
		});
		try {
			expect(
				(await listPiPackageCatalog(options)).packages[0]?.resources[0]?.tools,
			).toBeUndefined();
			recordLoadedExtensions({
				extensions: [{ resolvedPath: hello, tools: new Map([["late", 1]]), commands: new Map() }],
				errors: [],
			});
			expect(published).toBe(1);
			const hello2 = (await listPiPackageCatalog(options)).packages[0]?.resources.find(
				(r) => r.displayName === "hello.ts",
			);
			expect(hello2?.tools).toEqual(["late"]);
			recordLoadedExtensions({
				extensions: [{ resolvedPath: hello, tools: new Map([["late", 1]]), commands: new Map() }],
				errors: [],
			});
			expect(published).toBe(1);
		} finally {
			setExtensionInfoListener(null);
		}
	});

	it("keys a repository's local package by repository and worktree path: shared across worktrees, not across repositories", async () => {
		const main = join(root, "repo");
		const linked = join(root, "repo-wt-b");
		const other = join(root, "other-repo");
		mkdirSync(join(main, ".git", "worktrees", "repo-wt-b"), { recursive: true });
		mkdirSync(linked, { recursive: true });
		writeFileSync(
			join(linked, ".git"),
			`gitdir: ${join(main, ".git", "worktrees", "repo-wt-b")}\n`,
		);
		mkdirSync(join(other, ".git"), { recursive: true });
		for (const worktree of [main, linked, other]) {
			mkdirSync(join(worktree, ".pi"), { recursive: true });
			writeFixturePiPackage(join(worktree, "tools"));
			writeFileSync(
				join(worktree, ".pi", "settings.json"),
				JSON.stringify({ packages: ["../tools"] }),
			);
		}
		const key = `local:project:${main}:tools`;
		const rows = await Promise.all(
			[main, linked, other].map(async (cwd) => {
				const catalog = await listPiPackageCatalog({
					cwd,
					agentDir,
					projectTrusted: true,
					builtinExtensions: [],
					disabledPackages: new Set([key]),
				});
				return catalog.packages.map((p) => [p.identity, p.enabled]);
			}),
		);
		expect(rows[0]).toEqual([[key, false]]);
		expect(rows[1]).toEqual([[key, false]]);
		expect(rows[2]).toEqual([[`local:project:${other}:tools`, true]]);
	});

	it("excludes the host's excluded extension path and reads repository packages only when trusted", async () => {
		const project = join(root, "project");
		mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
		writeFileSync(join(project, ".pi", "extensions", "repo.ts"), extensionSource("repo_tool"));
		writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ packages: [pkg] }));
		const central = join(agentDir, "extensions", "jetbrains-central.ts");
		writeFileSync(central, extensionSource("central_tool"));

		const untrusted = await listPiPackageCatalog({
			cwd: project,
			agentDir,
			projectTrusted: false,
			builtinExtensions: [],
			excludedExtensionPaths: [central],
			disabledPackages: new Set(),
		});
		expect(untrusted.projectSettingsPath).toBe(join(project, ".pi", "settings.json"));
		expect(untrusted.packages).toHaveLength(0);
		expect(untrusted.loose).toHaveLength(0);

		const trusted = await listPiPackageCatalog({
			cwd: project,
			agentDir,
			projectTrusted: true,
			builtinExtensions: [],
			excludedExtensionPaths: [central],
			disabledPackages: new Set(),
		});
		expect(trusted.packages[0]).toMatchObject({ scope: "project", name: "@fixture/pi-tools" });
		expect(trusted.loose.map((entry) => entry.displayName)).toEqual(["repo.ts"]);
		expect(trusted.loose[0]).toMatchObject({ scope: "project" });
	});
});
