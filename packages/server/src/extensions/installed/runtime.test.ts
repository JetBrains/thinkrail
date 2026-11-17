import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { InstalledExtensions, type InstalledExtensionsOptions } from "./runtime";
import { stubInstaller, tempDir, toolDescriptor, writeExtension } from "./testFixtures";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(overrides: Partial<InstalledExtensionsOptions> = {}) {
	const root = tempDir();
	roots.push(root);
	const dataDir = join(root, "data");
	mkdirSync(dataDir, { recursive: true });
	let changes = 0;
	const runtime = new InstalledExtensions({
		dataDir,
		reservedNames: () => ["visualize"],
		skillRoots: () => [],
		offline: () => false,
		onChange: () => {
			changes += 1;
		},
		...overrides,
	});
	const declare = (...sources: string[]) =>
		writeFileSync(join(dataDir, "extensions.json"), JSON.stringify({ extensions: sources }));
	return { root, dataDir, runtime, declare, changes: () => changes };
}

const stateOf = (runtime: InstalledExtensions, source: string) =>
	runtime.records().find((record) => record.source === source);

describe("reconcile", () => {
	it("is empty without a declarations file", async () => {
		const { runtime, changes } = setup();
		await runtime.reconcile();
		expect(runtime.records()).toEqual([]);
		expect(changes()).toBe(0);
	});

	it("loads a folder source in place, with its descriptor, settings copy and halves", async () => {
		const { root, runtime, declare, dataDir } = setup();
		const folder = writeExtension(join(root, "weather"), {
			name: "thinkrail-ext-weather",
			web: "dist/web.js",
			styles: "dist/web.css",
			manifest: { title: "Weather" },
		});
		declare(folder);
		await runtime.reconcile();
		const record = stateOf(runtime, folder);
		expect(record).toMatchObject({
			name: "thinkrail-ext-weather",
			title: "Weather",
			version: "1.0.0",
			description: "A fixture extension",
			state: "loaded",
			root: folder,
			sourceKind: "folder",
		});
		expect(record?.server?.extension.name).toBe("thinkrail-ext-weather");
		expect(record?.server?.extension.settings?.verbose).toEqual({
			type: "boolean",
			default: false,
			title: "Verbose",
			description: "Say more",
		});
		expect(runtime.servers()).toEqual(record?.server ? [record.server] : []);
		expect(runtime.servers()).toHaveLength(1);
		expect(existsSync(join(dataDir, "extensions", "installs"))).toBe(false);
	});

	it("loads a web-only extension without a server half", async () => {
		const { root, runtime, declare } = setup();
		const folder = writeExtension(join(root, "cards"), { server: false, web: "web.js" });
		declare(folder);
		await runtime.reconcile();
		expect(stateOf(runtime, folder)?.state).toBe("loaded");
		expect(runtime.servers()).toEqual([]);
	});

	it("is idempotent: an unchanged declaration neither reloads nor republishes", async () => {
		const { root, runtime, declare, changes } = setup();
		const folder = writeExtension(join(root, "a"));
		declare(folder);
		await runtime.reconcile();
		const first = runtime.servers();
		expect(changes()).toBe(1);
		declare(folder);
		await runtime.reconcile();
		expect(runtime.servers()).toBe(first);
		expect(changes()).toBe(1);
	});

	it("keeps the last good state when extensions.json is malformed, and recovers", async () => {
		const { root, runtime, declare, dataDir } = setup();
		const folder = writeExtension(join(root, "a"));
		declare(folder);
		await runtime.reconcile();
		writeFileSync(join(dataDir, "extensions.json"), "{ not json");
		await runtime.reconcile();
		expect(runtime.fileError()).toContain("not valid JSON");
		expect(stateOf(runtime, folder)?.state).toBe("loaded");
		writeFileSync(join(dataDir, "extensions.json"), JSON.stringify({ extensions: "nope" }));
		await runtime.reconcile();
		expect(runtime.fileError()).toContain("list of source strings");
		declare();
		await runtime.reconcile();
		expect(runtime.fileError()).toBeUndefined();
		expect(runtime.records()).toEqual([]);
		expect(existsSync(join(folder, "package.json"))).toBe(true);
	});

	it("refuses to rewrite a malformed file", async () => {
		const { runtime, dataDir } = setup();
		writeFileSync(join(dataDir, "extensions.json"), "[");
		const failure = await runtime.remove("npm:x").catch((error: unknown) => error);
		expect(errorCodeOf(failure)).toBe("EXTENSIONS_FILE_INVALID");
		expect(readFileSync(join(dataDir, "extensions.json"), "utf8")).toBe("[");
	});

	it("installs a missing npm source once, into its own folder", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "npm-ext" });
		const installer = stubInstaller({ "npm:npm-ext": template });
		const { runtime } = {
			runtime: new InstalledExtensions({ ...baseOptions(dataDir), installer }),
		};
		declare("npm:npm-ext");
		await runtime.reconcile();
		const record = stateOf(runtime, "npm:npm-ext");
		expect(record?.state).toBe("loaded");
		expect(record?.sourceKind).toBe("npm");
		expect(record?.root?.startsWith(join(dataDir, "extensions", "installs"))).toBe(true);
		await runtime.reconcile();
		expect(installer.installs).toEqual(["npm:npm-ext"]);
		const installs = JSON.parse(readFileSync(join(dataDir, "extensions", "installs.json"), "utf8"));
		expect(Object.keys(installs)).toEqual(["npm:npm-ext"]);
	});

	it("reports an install failure and an offline host as row states", async () => {
		const { dataDir, declare } = setup();
		const installer = stubInstaller({});
		const online = new InstalledExtensions({ ...baseOptions(dataDir), installer });
		declare("npm:absent", "git:github.com/x/y", "relative/path");
		await online.reconcile();
		expect(stateOf(online, "npm:absent")).toMatchObject({ state: "failed" });
		expect(stateOf(online, "npm:absent")?.error).toContain("404");
		expect(stateOf(online, "relative/path")?.error).toContain("absolute folder");
		const offline = new InstalledExtensions({
			...baseOptions(dataDir),
			installer,
			offline: () => true,
		});
		await offline.reconcile();
		expect(stateOf(offline, "npm:absent")?.error).toContain("offline");
	});

	it("does not retry a failed install on an unchanged reconcile", async () => {
		const { dataDir, declare } = setup();
		const installer = stubInstaller({});
		let changes = 0;
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer,
			onChange: () => {
				changes += 1;
			},
		});
		declare("npm:absent");
		await runtime.reconcile();
		const failed = runtime.records();
		await runtime.reconcile();
		expect(runtime.records()).toBe(failed);
		expect(installer.installs).toEqual(["npm:absent"]);
		expect(changes).toBe(1);
	});

	it("keeps an install whose declaration file broke meanwhile, and drops one removed meanwhile", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "slow" });
		const inner = stubInstaller({ "npm:slow": template, "npm:dropped": template });
		let during: () => void = () => {};
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: {
				...inner,
				async install(source, dir) {
					const path = await inner.install(source, dir);
					during();
					return path;
				},
			},
		});
		during = () => writeFileSync(join(dataDir, "extensions.json"), "{ broken");
		declare("npm:slow");
		await runtime.reconcile();
		expect(stateOf(runtime, "npm:slow")?.state).toBe("loaded");
		during = () => declare("npm:slow");
		declare("npm:slow", "npm:dropped");
		await runtime.reconcile();
		expect(stateOf(runtime, "npm:dropped")).toBeUndefined();
		expect(readdirSync(join(dataDir, "extensions", "installs"))).toHaveLength(1);
		during = () => {};
		declare("npm:slow", "npm:dropped");
		await runtime.reconcile();
		expect(stateOf(runtime, "npm:dropped")?.error).toContain("already installed from npm:slow");
		expect(inner.installs.filter((source) => source === "npm:dropped")).toHaveLength(2);
	});

	it("removes an npm install folder but never a folder source", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "gone" });
		const folder = writeExtension(join(root, "mine"));
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: stubInstaller({ "npm:gone": template }),
		});
		declare("npm:gone", folder);
		await runtime.reconcile();
		const installed = stateOf(runtime, "npm:gone")?.root as string;
		expect(existsSync(installed)).toBe(true);
		await runtime.remove("npm:gone");
		await runtime.remove(folder);
		expect(runtime.records()).toEqual([]);
		expect(existsSync(installed)).toBe(false);
		expect(existsSync(join(folder, "package.json"))).toBe(true);
		const missing = await runtime.remove(folder).catch((error: unknown) => error);
		expect(errorCodeOf(missing)).toBe("EXTENSION_UNKNOWN");
	});

	it("never runs an incompatible extension's code", async () => {
		const { root, runtime, declare } = setup();
		const newer = writeExtension(join(root, "newer"), {
			api: "1.9",
			files: { "server/index.ts": 'throw new Error("must not run");\n' },
		});
		const older = writeExtension(join(root, "older"), { api: "0.1" });
		declare(newer, older);
		await runtime.reconcile();
		expect(stateOf(runtime, newer)).toMatchObject({ state: "incompatible" });
		expect(stateOf(runtime, newer)?.error).toContain("update ThinkRail");
		expect(stateOf(runtime, older)?.state).toBe("incompatible");
		expect(runtime.servers()).toEqual([]);
	});

	it.each([
		["a syntax error", "export default {{;\n", "ParseError"],
		["a throwing top level", 'throw new Error("top-level boom");\n', "top-level boom"],
		[
			"a missing dependency",
			'import x from "not-installed-dep";\nexport default x;\n',
			"not-installed-dep",
		],
		["a wrong default export", "export default function () {}\n", "defineServerExtension"],
		["no default export", "export const x = 1;\n", "defineServerExtension"],
	])("turns %s into a failed row and keeps loading the others", async (_label, body, message) => {
		const { root, runtime, declare } = setup();
		const broken = writeExtension(join(root, "broken"), { files: { "server/index.ts": body } });
		const fine = writeExtension(join(root, "fine"));
		declare(broken, fine);
		await runtime.reconcile();
		expect(stateOf(runtime, broken)?.state).toBe("failed");
		expect(stateOf(runtime, broken)?.error).toContain(message);
		expect(stateOf(runtime, fine)?.state).toBe("loaded");
	});

	it("fails a descriptor whose name is not the package name", async () => {
		const { root, runtime, declare } = setup();
		const folder = writeExtension(join(root, "a"), {
			name: "pkg-name",
			files: { "server/index.ts": toolDescriptor("other-name") },
		});
		declare(folder);
		await runtime.reconcile();
		expect(stateOf(runtime, folder)?.error).toContain('must be the package name "pkg-name"');
	});

	it("fails an invalid manifest, a plain package, a reserved and a duplicate name", async () => {
		const { root, runtime, declare } = setup();
		const invalid = writeExtension(join(root, "invalid"), { manifest: { server: "../x.ts" } });
		const plain = join(root, "plain");
		writeExtension(plain);
		writeFileSync(join(plain, "package.json"), JSON.stringify({ name: "plain", pi: {} }));
		const reserved = writeExtension(join(root, "reserved"), { name: "visualize" });
		const first = writeExtension(join(root, "first"), { name: "same" });
		const second = writeExtension(join(root, "second"), { name: "same" });
		declare(invalid, plain, reserved, first, second);
		await runtime.reconcile();
		expect(stateOf(runtime, invalid)?.error).toContain("inside the package");
		expect(stateOf(runtime, plain)?.error).toContain('no "thinkrail" manifest');
		expect(stateOf(runtime, reserved)?.error).toContain("built-in");
		expect(stateOf(runtime, first)?.state).toBe("loaded");
		expect(stateOf(runtime, second)?.error).toBe(`same is already installed from ${first}`);
		const before = runtime.records();
		await runtime.reconcile();
		expect(runtime.records()).toBe(before);
	});

	it("fails a declared file that is missing", async () => {
		const { root, runtime, declare } = setup();
		const folder = writeExtension(join(root, "a"), { server: false, web: "dist/web.js" });
		rmSync(join(folder, "dist"), { recursive: true });
		declare(folder);
		await runtime.reconcile();
		expect(stateOf(runtime, folder)?.error).toBe("dist/web.js is missing from the package");
	});

	it("fails an extension whose skill package cannot be resolved", async () => {
		const { root, dataDir, declare } = setup();
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			skillRoots: () => {
				throw new Error("Cannot find module 'skills-pkg/package.json'");
			},
		});
		const folder = writeExtension(join(root, "a"));
		declare(folder);
		await runtime.reconcile();
		expect(stateOf(runtime, folder)?.error).toContain("skills-pkg");
	});
});

describe("install, update and checkUpdates", () => {
	it("stages a folder or npm source by its package.json and adopts an extension", async () => {
		const { root, dataDir } = setup();
		const template = writeExtension(join(root, "template"), { name: "npm-ext" });
		const plainTemplate = join(root, "plain");
		writeExtension(plainTemplate);
		writeFileSync(join(plainTemplate, "package.json"), JSON.stringify({ name: "plain", pi: {} }));
		const installer = stubInstaller({ "npm:npm-ext": template, "npm:plain": plainTemplate });
		const runtime = new InstalledExtensions({ ...baseOptions(dataDir), installer });
		expect(await runtime.stage("npm:plain")).toBeUndefined();
		expect(existsSync(join(dataDir, "extensions", "installs"))).toBe(true);
		expect(readdirSync(join(dataDir, "extensions", "installs"))).toEqual([]);
		expect(await runtime.stage(plainTemplate)).toBeUndefined();
		const staged = await runtime.stage("npm:npm-ext");
		expect(staged?.name).toBe("npm-ext");
		const record = await runtime.adopt(staged as NonNullable<typeof staged>);
		expect(record.state).toBe("loaded");
		expect(JSON.parse(readFileSync(runtime.declarationsPath, "utf8"))).toEqual({
			extensions: ["npm:npm-ext"],
		});
		expect(installer.installs).toEqual(["npm:plain", "npm:npm-ext"]);
		const folder = await runtime.stage(template);
		expect(folder).toEqual({ source: template, name: "npm-ext" });
	});

	it("refuses to stage npm offline and keeps the user's other declaration keys", async () => {
		const { root, dataDir } = setup();
		const offline = new InstalledExtensions({ ...baseOptions(dataDir), offline: () => true });
		expect(errorCodeOf(await offline.stage("npm:x").catch((e: unknown) => e))).toBe(
			"PACKAGE_OFFLINE",
		);
		writeFileSync(
			join(dataDir, "extensions.json"),
			JSON.stringify({ comment: "mine", extensions: [] }),
		);
		const folder = writeExtension(join(root, "a"));
		const staged = await offline.stage(folder);
		await offline.adopt(staged as NonNullable<typeof staged>);
		expect(JSON.parse(readFileSync(offline.declarationsPath, "utf8"))).toEqual({
			comment: "mine",
			extensions: [folder],
		});
	});

	it("updates an npm source into a new folder and drops the old one", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "npm-ext" });
		const installer = stubInstaller({ "npm:npm-ext": template }, new Set(["npm:npm-ext"]));
		const runtime = new InstalledExtensions({ ...baseOptions(dataDir), installer });
		declare("npm:npm-ext");
		await runtime.reconcile();
		const before = stateOf(runtime, "npm:npm-ext");
		expect(await runtime.checkUpdates()).toEqual([{ source: "npm:npm-ext" }]);
		await runtime.update("npm:npm-ext");
		const after = stateOf(runtime, "npm:npm-ext");
		expect(after?.state).toBe("loaded");
		expect(after?.root).not.toBe(before?.root);
		expect(existsSync(before?.root as string)).toBe(false);
		expect(after?.server).not.toBe(before?.server);
	});

	it("keeps the old install when an update fails", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "npm-ext" });
		const templates: Record<string, string> = { "npm:npm-ext": template };
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: stubInstaller(templates),
		});
		declare("npm:npm-ext");
		await runtime.reconcile();
		const before = stateOf(runtime, "npm:npm-ext");
		delete templates["npm:npm-ext"];
		const failure = await runtime.update("npm:npm-ext").catch((error: unknown) => error);
		expect(errorCodeOf(failure)).toBe("PACKAGE_UPDATE_FAILED");
		expect(stateOf(runtime, "npm:npm-ext")).toBe(before);
	});

	it("keeps the old install when the new version does not load", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "npm-ext" });
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: stubInstaller({ "npm:npm-ext": template }),
		});
		declare("npm:npm-ext");
		await runtime.reconcile();
		const before = stateOf(runtime, "npm:npm-ext");
		writeExtension(template, { name: "npm-ext", api: "2.0" });
		const failure = await runtime.update("npm:npm-ext").catch((error: unknown) => error);
		expect(errorCodeOf(failure)).toBe("PACKAGE_UPDATE_FAILED");
		expect((failure as Error).message).toContain("extension API 2.0");
		expect(stateOf(runtime, "npm:npm-ext")).toBe(before);
		expect(existsSync(before?.root as string)).toBe(true);
		expect(readdirSync(join(dataDir, "extensions", "installs"))).toHaveLength(1);
	});

	it("re-loads a folder source in place on update", async () => {
		const { root, runtime, declare } = setup();
		const folder = writeExtension(join(root, "a"), { name: "edited" });
		declare(folder);
		await runtime.reconcile();
		const before = stateOf(runtime, folder)?.server;
		await runtime.update(folder);
		expect(stateOf(runtime, folder)?.server).not.toBe(before);
		expect(stateOf(runtime, folder)?.state).toBe("loaded");
	});
});

function baseOptions(dataDir: string): InstalledExtensionsOptions {
	return {
		dataDir,
		reservedNames: () => ["visualize"],
		skillRoots: () => [],
		offline: () => false,
	};
}

describe("watch", () => {
	it("reconciles after extensions.json changes on disk", async () => {
		const { root, runtime, declare } = setup();
		const stop = runtime.watch();
		try {
			const folder = writeExtension(join(root, "watched"));
			declare(folder);
			const deadline = Date.now() + 5_000;
			while (!stateOf(runtime, folder) && Date.now() < deadline) await Bun.sleep(50);
			expect(stateOf(runtime, folder)?.state).toBe("loaded");
		} finally {
			stop();
		}
	});
});
