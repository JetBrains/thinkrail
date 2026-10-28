import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { invalidatePiPackageCatalog, listPiPackageCatalog } from "./catalog";
import {
	installPiPackage,
	type PiPackageHostContext,
	removePiPackage,
	setPiResourceEnabled,
	updatePiPackages,
} from "./mutations";

function extensionSource(toolName: string): string {
	return [
		"export default function (pi) {",
		"  pi.registerTool({",
		`    name: ${JSON.stringify(toolName)}, label: ${JSON.stringify(toolName)}, description: "fixture",`,
		'    parameters: { type: "object", properties: {} },',
		'    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),',
		"  });",
		"}",
		"",
	].join("\n");
}

function writeFixturePackage(root: string): string {
	const pkg = join(root, "pkgs", "fixture-tools");
	mkdirSync(join(pkg, "extensions"), { recursive: true });
	mkdirSync(join(pkg, "skills", "triage"), { recursive: true });
	writeFileSync(
		join(pkg, "package.json"),
		JSON.stringify({
			name: "@fixture/pi-tools",
			version: "0.1.0",
			pi: { extensions: ["./extensions/*.ts"], skills: ["./skills"] },
		}),
	);
	writeFileSync(join(pkg, "extensions", "hello.ts"), extensionSource("fixture_hello"));
	writeFileSync(join(pkg, "extensions", "legacy.ts"), extensionSource("fixture_legacy"));
	writeFileSync(
		join(pkg, "skills", "triage", "SKILL.md"),
		"---\nname: triage\ndescription: Triage fixture.\n---\n\n# triage\n",
	);
	return pkg;
}

function readSettings(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

async function resolvedEnabled(
	ctx: PiPackageHostContext,
	type: "extensions" | "skills" | "prompts",
	path: string,
): Promise<boolean | undefined> {
	const settings = SettingsManager.create(ctx.cwd ?? ctx.agentDir, ctx.agentDir, {
		projectTrusted: ctx.projectTrusted(),
	});
	const packageManager = new DefaultPackageManager({
		cwd: ctx.cwd ?? ctx.agentDir,
		agentDir: ctx.agentDir,
		settingsManager: settings,
		builtinExtensions: [...ctx.builtinExtensions],
	});
	const resolved = await packageManager.resolve(async () => "skip");
	return resolved[type].find((resource) => resource.path === path)?.enabled;
}

describe("pi package mutations", () => {
	let root: string;
	let agentDir: string;
	let pkg: string;
	let settingsPath: string;
	let ctx: PiPackageHostContext;
	const originalOffline = process.env.PI_OFFLINE;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "thinkrail-pi-mutations-"));
		agentDir = join(root, "agent");
		mkdirSync(join(agentDir, "extensions"), { recursive: true });
		pkg = writeFixturePackage(root);
		settingsPath = join(agentDir, "settings.json");
		ctx = { agentDir, projectTrusted: () => false, builtinExtensions: ["mcp", "tool-search"] };
		invalidatePiPackageCatalog();
	});
	afterEach(() => {
		if (originalOffline === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = originalOffline;
		rmSync(root, { recursive: true, force: true });
	});

	it("installs a local package into user settings and lists it", async () => {
		const identity = await installPiPackage(ctx, { source: pkg, scope: "user" });
		expect(identity).toBe(`local:${pkg}`);
		expect(readSettings(settingsPath).packages).toEqual([relative(agentDir, pkg)]);
		const catalog = await listPiPackageCatalog({
			agentDir,
			projectTrusted: false,
			builtinExtensions: [],
			disabledPackages: new Set(),
		});
		expect(catalog.packages.map((p) => p.name)).toEqual(["@fixture/pi-tools"]);
		expect(catalog.packages[0]?.identity).toBe(identity);
	});

	it("refuses an unknown local path, an npm install offline, and a repository write without trust", async () => {
		await expect(
			installPiPackage(ctx, { source: join(root, "nope"), scope: "user" }),
		).rejects.toMatchObject({ code: "PACKAGE_SOURCE_INVALID" });
		process.env.PI_OFFLINE = "1";
		await expect(
			installPiPackage(ctx, { source: "npm:@fixture/anything", scope: "user" }),
		).rejects.toMatchObject({ code: "PACKAGE_OFFLINE" });
		await expect(installPiPackage(ctx, { source: pkg, scope: "project" })).rejects.toMatchObject({
			code: "PACKAGE_UNTRUSTED",
		});
		expect(existsSync(settingsPath)).toBe(false);
	});

	it("blocks the repository persist when trust is revoked during the install", async () => {
		const project = join(root, "project");
		mkdirSync(join(project, ".pi"), { recursive: true });
		let trusted = true;
		const projectCtx: PiPackageHostContext = {
			cwd: project,
			agentDir,
			projectTrusted: () => trusted,
			builtinExtensions: [],
		};
		const install = spyOn(DefaultPackageManager.prototype, "install").mockImplementation(
			async () => {
				trusted = false;
			},
		);
		try {
			await expect(
				installPiPackage(projectCtx, { source: pkg, scope: "project" }),
			).rejects.toMatchObject({ code: "PACKAGE_UNTRUSTED" });
			expect(install).toHaveBeenCalledTimes(1);
			expect(existsSync(join(project, ".pi", "settings.json"))).toBe(false);
		} finally {
			install.mockRestore();
		}
	});

	it("surfaces a swallowed settings write error as a coded error", async () => {
		const drain = spyOn(SettingsManager.prototype, "drainErrors").mockImplementation(() => [
			{ scope: "global", error: new Error("disk full") },
		]);
		try {
			await expect(installPiPackage(ctx, { source: pkg, scope: "user" })).rejects.toMatchObject({
				code: "PACKAGE_SETTINGS_WRITE_FAILED",
				message: "disk full",
			});
		} finally {
			drain.mockRestore();
		}
	});

	it("removes the declaration before touching disk and refuses an unknown one", async () => {
		writeFileSync(settingsPath, JSON.stringify({ packages: [pkg] }));
		const remove = spyOn(DefaultPackageManager.prototype, "remove");
		try {
			await removePiPackage(ctx, { source: pkg, scope: "user" });
			expect(readSettings(settingsPath).packages).toEqual([]);
			expect(remove).toHaveBeenCalledTimes(1);
			expect(existsSync(pkg)).toBe(true);
			const error = await removePiPackage(ctx, { source: pkg, scope: "user" }).catch((e) => e);
			expect(errorCodeOf(error)).toBe("PACKAGE_UNKNOWN");
			expect(remove).toHaveBeenCalledTimes(1);
		} finally {
			remove.mockRestore();
		}
	});

	it("removes and updates by the declared relative source even when the host cwd is elsewhere", async () => {
		const project = join(root, "project");
		mkdirSync(project, { recursive: true });
		const declared = relative(agentDir, pkg);
		writeFileSync(settingsPath, JSON.stringify({ packages: [declared] }));
		const elsewhere: PiPackageHostContext = { ...ctx, cwd: project };
		const update = spyOn(DefaultPackageManager.prototype, "update").mockResolvedValue();
		try {
			await updatePiPackages(elsewhere, [{ source: declared, scope: "user" }]);
			expect(update).toHaveBeenCalledWith(pkg);
		} finally {
			update.mockRestore();
		}
		await removePiPackage(elsewhere, { source: declared, scope: "user" });
		expect(readSettings(settingsPath).packages).toEqual([]);
	});

	it("aborts a remove before disk when the settings write fails", async () => {
		writeFileSync(settingsPath, JSON.stringify({ packages: [pkg] }));
		const remove = spyOn(DefaultPackageManager.prototype, "remove");
		const drain = spyOn(SettingsManager.prototype, "drainErrors").mockImplementation(() => [
			{ scope: "global", error: new Error("read-only") },
		]);
		try {
			await expect(removePiPackage(ctx, { source: pkg, scope: "user" })).rejects.toMatchObject({
				code: "PACKAGE_SETTINGS_WRITE_FAILED",
			});
			expect(remove).not.toHaveBeenCalled();
		} finally {
			remove.mockRestore();
			drain.mockRestore();
		}
	});

	it("writes a package resource toggle in pi config's filter form and pi honours it", async () => {
		writeFileSync(settingsPath, JSON.stringify({ packages: [pkg] }));
		const legacy = join(pkg, "extensions", "legacy.ts");
		const triage = join(pkg, "skills", "triage", "SKILL.md");

		await setPiResourceEnabled(ctx, {
			path: legacy,
			type: "extensions",
			scope: "user",
			enabled: false,
		});
		expect(readSettings(settingsPath).packages).toEqual([
			{ source: pkg, extensions: ["-extensions/legacy.ts"] },
		]);
		expect(await resolvedEnabled(ctx, "extensions", legacy)).toBe(false);
		expect(await resolvedEnabled(ctx, "extensions", join(pkg, "extensions", "hello.ts"))).toBe(
			true,
		);

		await setPiResourceEnabled(ctx, {
			path: triage,
			type: "skills",
			scope: "user",
			enabled: false,
		});
		expect(await resolvedEnabled(ctx, "skills", triage)).toBe(false);

		await setPiResourceEnabled(ctx, {
			path: legacy,
			type: "extensions",
			scope: "user",
			enabled: true,
		});
		expect(readSettings(settingsPath).packages).toEqual([
			{ source: pkg, extensions: ["+extensions/legacy.ts"], skills: ["-skills/triage/SKILL.md"] },
		]);
		expect(await resolvedEnabled(ctx, "extensions", legacy)).toBe(true);
	});

	it("keeps an explicit settings entry discoverable while it is switched off", async () => {
		const explicit = join(root, "custom", "x.ts");
		mkdirSync(join(root, "custom"), { recursive: true });
		writeFileSync(explicit, extensionSource("explicit_tool"));
		writeFileSync(settingsPath, JSON.stringify({ extensions: [explicit] }));

		await setPiResourceEnabled(ctx, {
			path: explicit,
			type: "extensions",
			scope: "user",
			enabled: false,
		});
		const written = readSettings(settingsPath).extensions as string[];
		expect(written[0]).toBe(explicit);
		expect(written).toHaveLength(2);
		expect(written[1]?.startsWith("-")).toBe(true);
		expect(await resolvedEnabled(ctx, "extensions", explicit)).toBe(false);

		await setPiResourceEnabled(ctx, {
			path: explicit,
			type: "extensions",
			scope: "user",
			enabled: true,
		});
		expect((readSettings(settingsPath).extensions as string[])[0]).toBe(explicit);
		expect(await resolvedEnabled(ctx, "extensions", explicit)).toBe(true);
	});

	it("toggles an auto-discovered loose file and a built-in through pi's top-level patterns", async () => {
		const guard = join(agentDir, "extensions", "guard.ts");
		writeFileSync(guard, extensionSource("guard_tool"));

		await setPiResourceEnabled(ctx, {
			path: guard,
			type: "extensions",
			scope: "user",
			enabled: false,
		});
		expect(readSettings(settingsPath).extensions).toEqual(["-extensions/guard.ts"]);
		expect(await resolvedEnabled(ctx, "extensions", guard)).toBe(false);

		await setPiResourceEnabled(ctx, {
			path: "builtin:mcp",
			type: "extensions",
			scope: "user",
			enabled: false,
		});
		expect(readSettings(settingsPath).extensions).toEqual(["-extensions/guard.ts", "-builtin:mcp"]);
		expect(await resolvedEnabled(ctx, "extensions", "builtin:mcp")).toBe(false);
		expect(await resolvedEnabled(ctx, "extensions", "builtin:tool-search")).toBe(true);

		await setPiResourceEnabled(ctx, {
			path: "builtin:mcp",
			type: "extensions",
			scope: "user",
			enabled: true,
		});
		expect(readSettings(settingsPath).extensions).toEqual(["-extensions/guard.ts", "+builtin:mcp"]);
		expect(await resolvedEnabled(ctx, "extensions", "builtin:mcp")).toBe(true);

		await expect(
			setPiResourceEnabled(ctx, {
				path: join(root, "ghost.ts"),
				type: "extensions",
				scope: "user",
				enabled: false,
			}),
		).rejects.toMatchObject({ code: "PACKAGE_UNKNOWN" });
	});
});
