import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	type ExtensionsStatus,
	InstalledExtensions,
	type InstalledExtensionsOptions,
	SWEEP_MIN_AGE_MS,
} from "./runtime";
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

/** Sets every install folder's and its direct entries' mtime `ms` into the past. */
function age(installs: string, ms: number): void {
	const then = (Date.now() - ms) / 1000;
	for (const dir of readdirSync(installs)) {
		for (const entry of readdirSync(join(installs, dir))) {
			utimesSync(join(installs, dir, entry), then, then);
		}
		utimesSync(join(installs, dir), then, then);
	}
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

	it("names every folder its code ran from, as given and resolved, even after removal", async () => {
		const { root, runtime, declare, dataDir } = setup();
		const folder = writeExtension(join(root, "real-weather"), { name: "weather" });
		const link = join(root, "linked-weather");
		symlinkSync(folder, link);
		declare(link);
		await runtime.reconcile();
		declare();
		await runtime.reconcile();
		expect(runtime.codeRoots()).toEqual([join(dataDir, "extensions"), link, realpathSync(folder)]);
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

	it("removes an npm install folder at the next start, never a folder source", async () => {
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
		expect(existsSync(installed)).toBe(true);
		expect(existsSync(join(folder, "package.json"))).toBe(true);
		age(join(dataDir, "extensions", "installs"), SWEEP_MIN_AGE_MS + 60_000);
		await new InstalledExtensions(baseOptions(dataDir)).reconcile();
		expect(existsSync(installed)).toBe(false);
		expect(existsSync(join(folder, "package.json"))).toBe(true);
		const missing = await runtime.remove(folder).catch((error: unknown) => error);
		expect(errorCodeOf(missing)).toBe("EXTENSION_UNKNOWN");
	});

	it("leaves an unrecorded install folder changed within a day, which another host may be filling", async () => {
		const { dataDir } = setup();
		const installs = join(dataDir, "extensions", "installs");
		for (const dir of ["abandoned", "recent"]) {
			mkdirSync(join(installs, dir, "npm", "node_modules"), { recursive: true });
		}
		age(installs, SWEEP_MIN_AGE_MS + 60_000);
		const recent = join(installs, "recent");
		const justUnder = (Date.now() - SWEEP_MIN_AGE_MS + 60_000) / 1000;
		utimesSync(recent, justUnder, justUnder);
		utimesSync(join(recent, "npm"), justUnder, justUnder);
		await new InstalledExtensions(baseOptions(dataDir)).reconcile();
		expect(readdirSync(installs)).toEqual(["recent"]);
		age(installs, SWEEP_MIN_AGE_MS + 60_000);
		await new InstalledExtensions(baseOptions(dataDir)).reconcile();
		expect(readdirSync(installs)).toEqual([]);
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

describe("a bad source never aborts a pass", () => {
	const statusOf = (dataDir: string): ExtensionsStatus =>
		JSON.parse(readFileSync(join(dataDir, "extensions", "status.json"), "utf8"));

	const badSources: [string, (root: string) => string, string][] = [
		...(["null", "[]", '"x"', "5"] as const).map(
			(json): [string, (root: string) => string, string] => [
				`a package.json of ${json}`,
				(root) => {
					const folder = join(root, "bad");
					mkdirSync(folder, { recursive: true });
					writeFileSync(join(folder, "package.json"), json);
					return folder;
				},
				'no "thinkrail" manifest',
			],
		),
		[
			"a package.json that is a folder",
			(root) => {
				const folder = join(root, "bad");
				mkdirSync(join(folder, "package.json"), { recursive: true });
				return folder;
			},
			"package.json cannot be read",
		],
		["a file URL with a host", () => "file://host/a", "not a folder path"],
		["a file URL with an encoded slash", () => "file:///a%2Fb", "not a folder path"],
		[
			"a file instead of a folder",
			(root) => {
				mkdirSync(root, { recursive: true });
				writeFileSync(join(root, "file.ts"), "");
				return join(root, "file.ts");
			},
			"no package.json in",
		],
	];

	it.each(badSources)(
		"keeps loading, removing and reporting beside %s",
		async (_label, make, error) => {
			const { root, runtime, declare, dataDir } = setup();
			const bad = make(root);
			const good = writeExtension(join(root, "good"));
			declare(good);
			await runtime.reconcile();
			declare(bad, good);
			await runtime.reconcile();
			expect(stateOf(runtime, good)?.state).toBe("loaded");
			expect(stateOf(runtime, bad)?.state).toBe("failed");
			expect(stateOf(runtime, bad)?.error).toContain(error);
			expect(runtime.servers()).toHaveLength(1);
			await runtime.remove(good);
			expect(stateOf(runtime, good)).toBeUndefined();
			expect(runtime.servers()).toEqual([]);
			expect(statusOf(dataDir).extensions).toEqual([
				expect.objectContaining({
					source: bad,
					state: "failed",
					error: expect.stringContaining(error),
				}),
			]);
		},
	);

	it("fails a throwing installer's source and loads the rest", async () => {
		const { root, dataDir, declare } = setup();
		const good = writeExtension(join(root, "good"));
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: {
				install: () => {
					throw new Error("installer exploded");
				},
				hasUpdate: async () => false,
			},
		});
		declare("npm:boom", good);
		await runtime.reconcile();
		expect(stateOf(runtime, good)?.state).toBe("loaded");
		expect(stateOf(runtime, "npm:boom")?.error).toContain("installer exploded");
	});

	it("turns any other throw inside one source's install into its failed row", async () => {
		const { root, dataDir, declare } = setup();
		const good = writeExtension(join(root, "good"));
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: { install: async () => JSON.parse("null"), hasUpdate: async () => false },
		});
		declare("npm:odd", good);
		await runtime.reconcile();
		expect(stateOf(runtime, good)?.state).toBe("loaded");
		expect(stateOf(runtime, "npm:odd")?.state).toBe("failed");
	});

	it("omits the tools of a toolNames callback that throws, and still writes the status", async () => {
		const { root, dataDir, declare } = setup();
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			toolNames: () => {
				throw new Error("no tools");
			},
		});
		const good = writeExtension(join(root, "good"));
		declare(good);
		await runtime.reconcile();
		expect(statusOf(dataDir).extensions).toEqual([
			expect.objectContaining({ source: good, state: "loaded" }),
		]);
		expect(statusOf(dataDir).extensions[0]).not.toHaveProperty("tools");
	});

	it("finishes the pass when an onChange listener throws", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "late-ext" });
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: stubInstaller({ "npm:late-ext": template }),
			onChange: () => {
				throw new Error("listener bug");
			},
		});
		const good = writeExtension(join(root, "good"));
		declare(good, "npm:late-ext");
		await runtime.reconcile();
		expect(stateOf(runtime, good)?.state).toBe("loaded");
		expect(stateOf(runtime, "npm:late-ext")?.state).toBe("loaded");
		expect(statusOf(dataDir).extensions.map((entry) => entry.state)).toEqual(["loaded", "loaded"]);
	});
});

describe("a server half that never settles", () => {
	const HUNG = "await new Promise(() => {});\nexport default { name: 'hung', extensions: [] };\n";

	it("becomes a failed row after the load timeout, and the rest still loads", async () => {
		const { root, runtime, declare } = setup({ loadTimeoutMs: 100 });
		const hung = writeExtension(join(root, "hung"), {
			name: "hung",
			files: { "server/index.ts": HUNG },
		});
		const fine = writeExtension(join(root, "fine"), { name: "fine" });
		declare(hung, fine);
		await runtime.reconcile();
		expect(stateOf(runtime, hung)).toMatchObject({
			state: "failed",
			error: "the server entry did not finish loading within 0.1 s",
		});
		expect(stateOf(runtime, fine)?.state).toBe("loaded");
	});

	it("is a foreign code root before its entry runs, and stays one after the load fails", async () => {
		const { root, runtime, declare } = setup({ loadTimeoutMs: 150 });
		const hung = writeExtension(join(root, "hung"), {
			name: "hung",
			files: { "server/index.ts": HUNG },
		});
		declare(hung);
		const pass = runtime.reconcile();
		await Bun.sleep(20);
		expect(runtime.records()).toEqual([]);
		expect(runtime.codeRoots()).toContain(hung);
		expect(runtime.codeRoots()).toContain(realpathSync(hung));
		await pass;
		expect(stateOf(runtime, hung)?.state).toBe("failed");
		expect(runtime.codeRoots()).toContain(hung);
	});

	it("can be removed while its load is still running", async () => {
		const { root, runtime, declare } = setup({ loadTimeoutMs: 150 });
		const hung = writeExtension(join(root, "hung"), {
			name: "hung",
			files: { "server/index.ts": HUNG },
		});
		declare(hung);
		const pass = runtime.reconcile();
		await Bun.sleep(20);
		await runtime.remove(hung);
		await pass;
		expect(runtime.records()).toEqual([]);
		expect(runtime.servers()).toEqual([]);
	});
});

describe("name ownership follows declaration order", () => {
	it("gives a name to the earlier npm source once it installs, over a later folder source", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "same" });
		const folder = writeExtension(join(root, "folder"), { name: "same" });
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: stubInstaller({ "npm:same": template }),
		});
		declare("npm:same", folder);
		await runtime.reconcile();
		expect(stateOf(runtime, "npm:same")?.state).toBe("loaded");
		expect(stateOf(runtime, folder)).toMatchObject({ state: "failed", duplicateOf: "npm:same" });
		const owner = stateOf(runtime, "npm:same")?.server;
		expect(runtime.servers()).toHaveLength(1);
		expect(runtime.servers()).toEqual(owner ? [owner] : []);
		const settled = runtime.records();
		await runtime.reconcile();
		expect(runtime.records()).toBe(settled);
	});

	it("lets the later source keep the name while the earlier one is not installed", async () => {
		const { root, dataDir, declare } = setup();
		const folder = writeExtension(join(root, "folder"), { name: "same" });
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: stubInstaller({}),
		});
		declare("npm:same", folder);
		await runtime.reconcile();
		expect(stateOf(runtime, "npm:same")?.error).toContain("404");
		expect(stateOf(runtime, folder)?.state).toBe("loaded");
		const settled = runtime.records();
		await runtime.reconcile();
		expect(runtime.records()).toBe(settled);
	});

	it("keeps the name with an earlier source that is installed but does not load", async () => {
		const { root, runtime, declare } = setup();
		const broken = writeExtension(join(root, "broken"), {
			name: "same",
			files: { "server/index.ts": 'throw new Error("boom");\n' },
		});
		const fine = writeExtension(join(root, "fine"), { name: "same" });
		declare(broken, fine);
		await runtime.reconcile();
		expect(stateOf(runtime, broken)?.error).toContain("boom");
		expect(stateOf(runtime, fine)).toMatchObject({ state: "failed", duplicateOf: broken });
	});

	it("updates an earlier source that a later one held the name for", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "same" });
		const folder = writeExtension(join(root, "folder"), { name: "same" });
		const templates: Record<string, string> = {};
		const published: number[] = [];
		const runtime: InstalledExtensions = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: stubInstaller(templates),
			onChange: () => published.push(runtime.servers().length),
		});
		declare("npm:same", folder);
		await runtime.reconcile();
		expect(stateOf(runtime, folder)?.state).toBe("loaded");
		templates["npm:same"] = template;
		await runtime.update("npm:same");
		expect(stateOf(runtime, "npm:same")?.state).toBe("loaded");
		expect(stateOf(runtime, folder)).toMatchObject({ state: "failed", duplicateOf: "npm:same" });
		expect(published.every((count) => count <= 1)).toBe(true);
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

	it("updates an npm source into a new folder and drops the old one at the next start", async () => {
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
		expect(existsSync(before?.root as string)).toBe(true);
		age(join(dataDir, "extensions", "installs"), SWEEP_MIN_AGE_MS + 60_000);
		await new InstalledExtensions(baseOptions(dataDir)).reconcile();
		expect(existsSync(before?.root as string)).toBe(false);
		expect(existsSync(after?.root as string)).toBe(true);
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

	it("re-evaluates a plain-JavaScript entry when a folder source is updated", async () => {
		const { root, runtime, declare } = setup();
		const entry = (answer: string) => `export default {
	name: "js-entry",
	extensions: [(pi) => pi.registerTool({ name: "answer", execute: async () => "${answer}" })],
};
`;
		const folder = writeExtension(join(root, "js"), {
			name: "js-entry",
			server: "server.js",
			files: { "server.js": entry("old") },
		});
		const answer = async () => {
			let tool: { execute: () => Promise<string> } | undefined;
			const [factory] = stateOf(runtime, folder)?.server?.extension.extensions ?? [];
			await factory?.({
				registerTool: (registered: typeof tool) => {
					tool = registered;
				},
			} as unknown as Parameters<NonNullable<typeof factory>>[0]);
			return tool?.execute();
		};
		declare(folder);
		await runtime.reconcile();
		expect(await answer()).toBe("old");
		writeFileSync(join(folder, "server.js"), entry("new"));
		await runtime.update(folder);
		expect(await answer()).toBe("new");
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

describe("status file", () => {
	const statusOf = (dataDir: string): ExtensionsStatus =>
		JSON.parse(readFileSync(join(dataDir, "extensions", "status.json"), "utf8"));

	it("lists every declared source with its state, error and tools after a reconcile", async () => {
		const { root, dataDir, declare } = setup();
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			toolNames: async (extension) => ({
				tools: [`${extension.name}_tool`],
				shadowed: extension.name === "fine-ext" ? ["visualize"] : [],
			}),
		});
		const fine = writeExtension(join(root, "fine"), { name: "fine-ext", version: "0.2.0" });
		const broken = writeExtension(join(root, "broken"), {
			name: "broken-ext",
			files: { "server/index.ts": 'throw new Error("top-level boom");\n' },
		});
		const newer = writeExtension(join(root, "newer"), { name: "newer-ext", api: "1.9" });
		const cards = writeExtension(join(root, "cards"), { server: false, web: "web.js" });
		declare(fine, broken, newer, cards);
		const before = Date.now();
		await runtime.reconcile();
		const status = statusOf(dataDir);
		expect(status.api).toBe("1.0");
		expect(status.declarations).toBe(join(dataDir, "extensions.json"));
		expect(Date.parse(status.updatedAt)).toBeGreaterThanOrEqual(before - 1_000);
		expect(status.fileError).toBeUndefined();
		expect(status.extensions).toEqual([
			{
				source: fine,
				name: "fine-ext",
				version: "0.2.0",
				state: "loaded",
				tools: ["fine-ext_tool"],
				shadowed: ["visualize"],
			},
			expect.objectContaining({ source: broken, name: "broken-ext", state: "failed" }),
			expect.objectContaining({ source: newer, name: "newer-ext", state: "incompatible" }),
			expect.objectContaining({ source: cards, state: "loaded" }),
		]);
		expect(status.extensions[1]?.error).toContain("top-level boom");
		expect(status.extensions[2]?.error).toContain("update ThinkRail");
		expect(status.extensions[3]?.tools).toBeUndefined();
		expect(status.extensions[3]).not.toHaveProperty("shadowed");
	});

	it("is written with no declarations, and omits tools it cannot determine", async () => {
		const { root, dataDir, declare } = setup();
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			toolNames: () => Promise.reject(new Error("no")),
		});
		await runtime.reconcile();
		expect(statusOf(dataDir).extensions).toEqual([]);
		const folder = writeExtension(join(root, "a"));
		declare(folder);
		await runtime.reconcile();
		expect(statusOf(dataDir).extensions[0]).not.toHaveProperty("tools");
	});

	it("marks a declared npm source as installing until its install finishes", async () => {
		const { root, dataDir, declare } = setup();
		const template = writeExtension(join(root, "template"), { name: "slow-ext" });
		const stub = stubInstaller({ "npm:slow-ext": template });
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started = () => {};
		const installing = new Promise<void>((resolve) => {
			started = resolve;
		});
		const runtime = new InstalledExtensions({
			...baseOptions(dataDir),
			installer: {
				...stub,
				async install(source, dir) {
					started();
					await gate;
					return stub.install(source, dir);
				},
			},
		});
		declare("npm:slow-ext");
		const done = runtime.reconcile();
		await installing;
		expect(statusOf(dataDir).extensions).toEqual([{ source: "npm:slow-ext", state: "installing" }]);
		release();
		await done;
		expect(statusOf(dataDir).extensions).toEqual([
			{ source: "npm:slow-ext", name: "slow-ext", version: "1.0.0", state: "loaded" },
		]);
	});

	it("reports a refused extensions.json beside the last good rows, and clears it when fixed", async () => {
		const { root, runtime, dataDir, declare } = setup();
		const folder = writeExtension(join(root, "a"), { name: "kept-ext" });
		declare(folder);
		await runtime.reconcile();
		writeFileSync(join(dataDir, "extensions.json"), '{ "extensions": [');
		await runtime.reconcile();
		const refused = statusOf(dataDir);
		expect(refused.fileError).toContain("not valid JSON");
		expect(refused.extensions).toEqual([
			expect.objectContaining({ source: folder, name: "kept-ext", state: "loaded" }),
		]);
		declare(folder);
		await runtime.reconcile();
		expect(statusOf(dataDir).fileError).toBeUndefined();
	});
});
