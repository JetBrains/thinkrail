import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { invalidatePiPackageCatalog, listPiPackageCatalog } from "./catalog";
import { piPackageIdentity, piPackageSourceKind } from "./identity";

function extensionSource(toolName: string, command?: string): string {
	return [
		"export default function (pi) {",
		"  pi.registerTool({",
		`    name: ${JSON.stringify(toolName)}, label: ${JSON.stringify(toolName)}, description: "fixture",`,
		'    parameters: { type: "object", properties: {} },',
		'    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),',
		"  });",
		command
			? `  pi.registerCommand(${JSON.stringify(command)}, { description: "fixture", handler: async () => {} });`
			: "",
		"}",
		"",
	].join("\n");
}

function writeFixturePackage(root: string): string {
	const pkg = join(root, "pkgs", "fixture-tools");
	mkdirSync(join(pkg, "extensions"), { recursive: true });
	mkdirSync(join(pkg, "skills", "triage"), { recursive: true });
	mkdirSync(join(pkg, "prompts"), { recursive: true });
	writeFileSync(
		join(pkg, "package.json"),
		JSON.stringify({
			name: "@fixture/pi-tools",
			version: "0.1.0",
			description: "Fixture tools for the catalog",
			pi: { extensions: ["./extensions/*.ts"], skills: ["./skills"], prompts: ["./prompts/*.md"] },
		}),
	);
	writeFileSync(join(pkg, "extensions", "hello.ts"), extensionSource("fixture_hello", "hello"));
	writeFileSync(join(pkg, "extensions", "legacy.ts"), extensionSource("fixture_legacy"));
	writeFileSync(
		join(pkg, "skills", "triage", "SKILL.md"),
		"---\nname: triage\ndescription: Triage fixture.\n---\n\n# triage\n",
	);
	writeFileSync(join(pkg, "prompts", "standup.md"), "---\ndescription: standup\n---\nstandup\n");
	return pkg;
}

describe("piPackageIdentity", () => {
	const resolveLocal = (path: string) => `/abs/${path}`;
	it("keys npm by name, git by host/path without ref, local by resolved path", () => {
		expect(piPackageIdentity("npm:@acme/pi-jira@1.4.2", resolveLocal)).toBe("npm:@acme/pi-jira");
		expect(piPackageIdentity("npm:pi-plain", resolveLocal)).toBe("npm:pi-plain");
		expect(piPackageIdentity("git:github.com/acme/pi-tools@v2", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(piPackageIdentity("https://GitHub.com/acme/pi-tools.git", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(piPackageIdentity("git@github.com:acme/pi-tools@main", resolveLocal)).toBe(
			"git:github.com/acme/pi-tools",
		);
		expect(piPackageIdentity("./tools", resolveLocal)).toBe("local:/abs/./tools");
	});
	it("classifies sources the way pi does", () => {
		expect(piPackageSourceKind("npm:x")).toBe("npm");
		expect(piPackageSourceKind("git:github.com/a/b")).toBe("git");
		expect(piPackageSourceKind("https://github.com/a/b")).toBe("git");
		expect(piPackageSourceKind("git@github.com:a/b")).toBe("git");
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

		const catalog = await listPiPackageCatalog({
			agentDir,
			projectTrusted: false,
			builtinExtensions: ["mcp", "tool-search"],
			disabledPackages: new Set(),
		});

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

	it("reports a disabled package as off and does not run its code", async () => {
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

	it("never installs a declared package that is missing on disk, even online", async () => {
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
			expect(catalog.packages.map((p) => p.name)).toEqual(["@fixture/pi-tools"]);
			expect(installNpm).not.toHaveBeenCalled();
			expect(install).not.toHaveBeenCalled();
		} finally {
			installNpm.mockRestore();
			install.mockRestore();
		}
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
		expect(trusted.loose[0]).toMatchObject({ scope: "project", tools: ["repo_tool"] });
	});
});
