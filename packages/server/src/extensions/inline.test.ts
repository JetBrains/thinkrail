import { describe, expect, it, jest } from "bun:test";
import { join } from "node:path";
import type {
	Extension,
	ExtensionAPI,
	InlineExtension,
	LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";
import {
	extensionSessionServices,
	type HostSessionServices,
	omitDisabledRegistryExtensions,
	omitSupersededPackages,
	packageNameOf,
	preferRegistryTools,
	registryExtensionName,
	registryInlineExtensions,
	supersedablePackagesIn,
	supersedingExtension,
} from "./inline";
import { EXTENSION_LOAD_TIMEOUT_MS } from "./installed";
import type { ServerExtensionEntry } from "./registry";

function entry(name: string, parents: number, children = 0): ServerExtensionEntry {
	const factories = (prefix: string, count: number) =>
		Array.from({ length: count }, (_, index) => (pi: ExtensionAPI) => {
			pi.registerTool({ name: `${name}-${prefix}${index}` } as Parameters<
				ExtensionAPI["registerTool"]
			>[0]);
		});
	return {
		specifier: `@acme/${name}/server`,
		extension: {
			name,
			extensions: factories("p", parents),
			...(children ? { childExtensions: factories("c", children) } : {}),
		},
	};
}

function installed(name: string, parents: number): ServerExtensionEntry {
	return { ...entry(name, parents), installed: { skillRoots: [] } };
}

async function registered(inline: InlineExtension): Promise<string[]> {
	const tools: string[] = [];
	const pi = { registerTool: (tool: { name: string }) => tools.push(tool.name) };
	const factory = typeof inline === "function" ? inline : inline.factory;
	await factory(pi as unknown as ExtensionAPI);
	return tools;
}

const nameOf = (inline: InlineExtension) => (typeof inline === "function" ? "fn" : inline.name);

describe("registryInlineExtensions", () => {
	const entries = [entry("solo", 1), entry("multi", 2, 1)];

	it("names one factory after the extension and several as name#n", () => {
		expect(registryInlineExtensions("extensions", undefined, entries).map(nameOf)).toEqual([
			"solo",
			"multi#1",
			"multi#2",
		]);
		expect(registryInlineExtensions("childExtensions", undefined, entries).map(nameOf)).toEqual([
			"multi",
		]);
	});

	it("names an installed extension's factories in their own namespace", () => {
		expect(
			registryInlineExtensions("extensions", undefined, [
				installed("mcp", 1),
				installed("two", 2),
			]).map(nameOf),
		).toEqual(["ext:mcp", "ext:two#1", "ext:two#2"]);
	});

	it("decides at load time whether a factory registers anything", async () => {
		const disabled = new Set<string>();
		const [solo] = registryInlineExtensions("extensions", (name) => disabled.has(name), entries);
		if (!solo) throw new Error("missing solo");
		expect(await registered(solo)).toEqual(["solo-p0"]);
		disabled.add("solo");
		expect(await registered(solo)).toEqual([]);
		disabled.delete("solo");
		expect(await registered(solo)).toEqual(["solo-p0"]);
	});
});

describe("registryInlineExtensions with per-session factories", () => {
	const labels = new WeakMap<ExtensionSessionServices["expectToolResponse"], string>();
	const session = (label: string): HostSessionServices => {
		const services: HostSessionServices = {
			expectToolResponse: () => {},
			awaitToolResponse: async () => ({ kind: "deferred" }),
			workspaceFiles: {
				check: async () => {},
				checkArtifacts: async (paths) => paths.map((path) => ({ path })),
				ensureArtifactsDir: async () => {},
				scratchDir: "",
				artifactsDir: "",
			},
		};
		labels.set(services.expectToolResponse, label);
		return services;
	};
	const sessionEntry = (name: string, parents: number, seen: string[]): ServerExtensionEntry => ({
		specifier: `@acme/${name}/server`,
		extension: {
			name,
			extensions: entry(name, parents).extension.extensions,
			sessionExtensions: (services) => {
				const label = labels.get(services.expectToolResponse) ?? "unknown";
				seen.push(label);
				return [
					(pi: ExtensionAPI) => {
						pi.registerTool({ name: `${name}-session-${label}` } as Parameters<
							ExtensionAPI["registerTool"]
						>[0]);
					},
				];
			},
		},
	});

	it("appends the session's factories to the parent set under one naming scheme", async () => {
		const seen: string[] = [];
		const entries = [sessionEntry("asker", 0, seen), sessionEntry("mixed", 1, seen)];
		const inline = registryInlineExtensions("extensions", undefined, entries, session("a"));
		expect(inline.map(nameOf)).toEqual(["asker", "mixed#1", "mixed#2"]);
		expect(await Promise.all(inline.map(registered))).toEqual([
			["asker-session-a"],
			["mixed-p0"],
			["mixed-session-a"],
		]);
		expect(seen).toEqual(["a", "a"]);
	});

	it("builds each parent session's factories from its own services", async () => {
		const seen: string[] = [];
		const entries = [sessionEntry("asker", 0, seen)];
		const [first] = registryInlineExtensions("extensions", undefined, entries, session("one"));
		const [second] = registryInlineExtensions("extensions", undefined, entries, session("two"));
		if (!first || !second) throw new Error("missing session factories");
		expect(await registered(first)).toEqual(["asker-session-one"]);
		expect(await registered(second)).toEqual(["asker-session-two"]);
		expect(await registered(first)).toEqual(["asker-session-one"]);
		expect(seen).toEqual(["one", "two"]);
	});

	it("leaves session factories out without a session and out of the child set", () => {
		const seen: string[] = [];
		const entries = [sessionEntry("asker", 0, seen)];
		expect(registryInlineExtensions("extensions", undefined, entries)).toEqual([]);
		expect(
			registryInlineExtensions("childExtensions", undefined, entries, session("child")),
		).toEqual([]);
		expect(seen).toEqual([]);
	});

	it("turns a throwing sessionExtensions into that extension's load error, not a failed flatten", async () => {
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "/installed/server/index.ts",
				extension: {
					name: "throws",
					extensions: [],
					sessionExtensions: (services) => (services.setting("typo") ? [] : []),
				},
			},
			sessionEntry("asker", 0, []),
		];
		const inline = registryInlineExtensions("extensions", undefined, entries, session("a"));
		expect(inline.map(nameOf)).toEqual(["throws", "asker"]);
		const [throws] = inline;
		if (!throws || typeof throws === "function") throw new Error("missing throws");
		await expect(Promise.resolve(throws.factory({} as ExtensionAPI))).rejects.toThrow(
			'extension throws has no setting "typo"',
		);
	});

	it("turns a sessionExtensions that returns no list into that extension's load error", async () => {
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "/installed/server/index.ts",
				extension: {
					name: "single",
					extensions: [],
					sessionExtensions: (() => () => {}) as unknown as () => [],
				},
			},
		];
		const [single] = registryInlineExtensions("extensions", () => true, entries, session("a"));
		if (!single || typeof single === "function") throw new Error("missing single");
		expect(single.name).toBe("single");
		await expect(Promise.resolve(single.factory({} as ExtensionAPI))).resolves.toBeUndefined();
		const [enabled] = registryInlineExtensions("extensions", undefined, entries, session("a"));
		if (!enabled || typeof enabled === "function") throw new Error("missing single");
		await expect(Promise.resolve(enabled.factory({} as ExtensionAPI))).rejects.toThrow(
			"sessionExtensions must return a list of factories",
		);
	});

	it("observes a sessionExtensions promise that rejects and reports a load error instead", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const entries: ServerExtensionEntry[] = [
				{
					specifier: "/installed/server/index.ts",
					extension: {
						name: "rejects",
						extensions: [],
						sessionExtensions: (async (services: ExtensionSessionServices) =>
							services.setting("undeclared") ? [] : []) as unknown as () => [],
					},
				},
			];
			const [inline] = registryInlineExtensions("extensions", undefined, entries, session("a"));
			if (!inline || typeof inline === "function") throw new Error("missing rejects");
			await expect(Promise.resolve(inline.factory({} as ExtensionAPI))).rejects.toThrow(
				"sessionExtensions must return a list of factories",
			);
			await Bun.sleep(20);
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("gates session factories on the extension switch at load time", async () => {
		const disabled = new Set(["asker"]);
		const [asker] = registryInlineExtensions(
			"extensions",
			(name) => disabled.has(name),
			[sessionEntry("asker", 0, [])],
			session("a"),
		);
		if (!asker) throw new Error("missing asker");
		expect(await registered(asker)).toEqual([]);
		disabled.clear();
		expect(await registered(asker)).toEqual(["asker-session-a"]);
	});
});

describe("an installed factory that never settles", () => {
	const hang = () => new Promise<void>(() => {});
	const installed = (name: string, factories: ServerExtensionEntry["extension"]) => ({
		specifier: `/installed/${name}/server/index.ts`,
		extension: factories,
		installed: { skillRoots: [] },
	});

	it.each([
		["a static factory", { name: "hung", extensions: [hang] }],
		["a per-session factory", { name: "hung", extensions: [], sessionExtensions: () => [hang] }],
	])(
		"fails %s as that extension's load error once the load timeout passes",
		async (_, extension) => {
			const [inline] = registryInlineExtensions(
				"extensions",
				undefined,
				[installed("hung", extension)],
				{
					expectToolResponse: () => {},
					awaitToolResponse: async () => ({ kind: "deferred" }),
					workspaceFiles: {
						check: async () => {},
						checkArtifacts: async (paths) => paths.map((path) => ({ path })),
						ensureArtifactsDir: async () => {},
						scratchDir: "",
						artifactsDir: "",
					},
				},
			);
			if (!inline || typeof inline === "function") throw new Error("missing hung");
			jest.useFakeTimers();
			try {
				const loading = Promise.resolve(inline.factory({} as ExtensionAPI));
				for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
				jest.advanceTimersByTime(EXTENSION_LOAD_TIMEOUT_MS);
				await expect(loading).rejects.toThrow("hung did not finish loading within 10 s");
			} finally {
				jest.useRealTimers();
			}
		},
	);
});

describe("omitDisabledRegistryExtensions", () => {
	const entries = [entry("solo", 1), entry("multi", 2, 1)];
	const loaded = (path: string) => ({ path }) as Extension;
	const result: LoadExtensionsResult = {
		extensions: [
			loaded("/disk/other.ts"),
			loaded("<inline:solo>"),
			loaded("<inline:multi#1>"),
			loaded("<inline:multi#2>"),
			loaded("<inline:headless>"),
		],
		errors: [],
		runtime: {} as LoadExtensionsResult["runtime"],
	};

	it("drops only the disabled extension's inline entries", () => {
		const next = omitDisabledRegistryExtensions(result, (name) => name === "multi", entries);
		expect(next.extensions.map((extension) => extension.path)).toEqual([
			"/disk/other.ts",
			"<inline:solo>",
			"<inline:headless>",
		]);
		expect(next.errors).toBe(result.errors);
	});

	it("returns the result untouched when nothing is disabled", () => {
		expect(omitDisabledRegistryExtensions(result, () => false, entries)).toBe(result);
	});
});

describe("omitSupersededPackages", () => {
	const panel: ServerExtensionEntry = {
		specifier: "@acme/panel/server",
		extension: { name: "panel", extensions: [], supersedesPackages: ["@acme/pi-panel"] },
	};
	const entries = [entry("solo", 1), panel];
	const loaded = (path: string, resolvedPath = path) => ({ path, resolvedPath }) as Extension;
	const names: Record<string, string> = {
		"/agent/npm/node_modules/@acme/pi-panel/extension.ts": "@acme/pi-panel",
		"/agent/git/github.com/acme/tools/pi-panel/extension.ts": "@acme/pi-panel",
		"/agent/npm/node_modules/other/index.ts": "other",
	};
	const nameOf = (file: string) => names[file] ?? null;
	const result: LoadExtensionsResult = {
		extensions: [
			loaded("npm:@acme/pi-panel", "/agent/npm/node_modules/@acme/pi-panel/extension.ts"),
			loaded("/agent/git/github.com/acme/tools/pi-panel/extension.ts"),
			loaded("/agent/npm/node_modules/other/index.ts"),
			loaded("/loose/file.ts"),
			loaded("<inline:solo>"),
		],
		errors: [],
		runtime: {} as LoadExtensionsResult["runtime"],
	};

	it("drops a superseded package's extensions however pi installed it, and keeps the rest", () => {
		const next = omitSupersededPackages(result, () => false, entries, nameOf);
		expect(next.extensions.map((extension) => extension.path)).toEqual([
			"/agent/npm/node_modules/other/index.ts",
			"/loose/file.ts",
			"<inline:solo>",
		]);
		expect(next.errors).toBe(result.errors);
	});

	it("keeps the package while the superseding extension is off, and when nothing is superseded", () => {
		expect(omitSupersededPackages(result, (name) => name === "panel", entries, nameOf)).toBe(
			result,
		);
		expect(omitSupersededPackages(result, () => false, [entry("solo", 1)], nameOf)).toBe(result);
	});

	it("finds the loaded packages some extension supersedes, on or off, and who supersedes one now", () => {
		expect([...supersedablePackagesIn(result, entries, nameOf)]).toEqual(["@acme/pi-panel"]);
		expect(supersedablePackagesIn(result, [entry("solo", 1)], nameOf).size).toBe(0);
		expect(supersedingExtension("@acme/pi-panel", () => false, entries)?.name).toBe("panel");
		expect(
			supersedingExtension("@acme/pi-panel", (name) => name === "panel", entries),
		).toBeUndefined();
		expect(supersedingExtension("other", () => false, entries)).toBeUndefined();
	});

	it("reads the nearest package.json name above a file", () => {
		expect(packageNameOf(join(import.meta.dir, "inline.ts"))).toBe("@thinkrail/server");
		expect(packageNameOf("/no/such/folder/file.ts")).toBeNull();
	});
});

describe("registryExtensionName", () => {
	const entries = [entry("solo", 1), entry("multi", 2, 1)];

	it("maps a registry inline path back to its extension and ignores everything else", () => {
		expect(registryExtensionName("<inline:solo>", entries)).toBe("solo");
		expect(registryExtensionName("<inline:multi#2>", entries)).toBe("multi");
		expect(registryExtensionName("<inline:multi>", entries)).toBe("multi");
		expect(registryExtensionName("<inline:multi#7>", entries)).toBe("multi");
		expect(registryExtensionName("<inline:multi#x>", entries)).toBeUndefined();
		expect(registryExtensionName("<inline:headless>", entries)).toBeUndefined();
		expect(registryExtensionName("<inline:3>", entries)).toBeUndefined();
		expect(registryExtensionName("/disk/solo.ts", entries)).toBeUndefined();
	});

	it("never confuses an installed extension with a built-in or a host inline of the same name", () => {
		const mixed = [entry("solo", 1), installed("mcp", 1), installed("solo", 1)];
		expect(registryExtensionName("<inline:mcp>", mixed)).toBeUndefined();
		expect(registryExtensionName("<inline:ext:mcp>", mixed)).toBe("mcp");
		expect(registryExtensionName("<inline:ext:mcp#2>", mixed)).toBe("mcp");
		expect(registryExtensionName("<inline:solo>", [installed("solo", 1)])).toBeUndefined();
		expect(registryExtensionName("<inline:ext:solo>", [entry("solo", 1)])).toBeUndefined();
	});
});

describe("preferRegistryTools", () => {
	const entries = [entry("solo", 1), entry("multi", 2, 1)];
	const loaded = (path: string, tools: string[]) =>
		({ path, tools: new Map(tools.map((name) => [name, {}])) }) as unknown as Extension;
	const result = (...extensions: Extension[]): LoadExtensionsResult => ({
		extensions,
		errors: [],
		runtime: {} as LoadExtensionsResult["runtime"],
	});
	const paths = (next: LoadExtensionsResult) => next.extensions.map((extension) => extension.path);

	it("moves a registry extension directly ahead of the first other extension with one of its tools", () => {
		const next = preferRegistryTools(
			result(
				loaded("/user/first.ts", ["read-later"]),
				loaded("/user/rival.ts", ["ask"]),
				loaded("/user/rival-two.ts", ["ask"]),
				loaded("<inline:3>", ["host"]),
				loaded("<inline:solo>", ["ask", "solo-only"]),
			),
			entries,
		);
		expect(paths(next)).toEqual([
			"/user/first.ts",
			"<inline:solo>",
			"/user/rival.ts",
			"/user/rival-two.ts",
			"<inline:3>",
		]);
	});

	it("never reorders against another registry extension or a later rival", () => {
		const untouched = result(
			loaded("<inline:solo>", ["shared"]),
			loaded("<inline:multi#1>", ["shared"]),
			loaded("/user/later.ts", ["shared"]),
		);
		expect(preferRegistryTools(untouched, entries)).toBe(untouched);
	});

	const ownerOf = (next: LoadExtensionsResult, tool: string) =>
		next.extensions.find((extension) => extension.tools.has(tool))?.path;

	it("never promotes an installed extension: a pi package keeps its tool and a built-in its own", () => {
		const registry = [entry("asker", 0), installed("weather-ext", 0)];
		const loadedSet = result(
			loaded("/user/pi-weather.ts", ["weather"]),
			loaded("<inline:asker>", ["ask_user_question"]),
			loaded("<inline:3>", ["host"]),
			loaded("<inline:ext:weather-ext>", ["weather", "ask_user_question"]),
		);
		const next = preferRegistryTools(loadedSet, registry);
		expect(next).toBe(loadedSet);
		expect(ownerOf(next, "ask_user_question")).toBe("<inline:asker>");
		expect(ownerOf(next, "weather")).toBe("/user/pi-weather.ts");
	});

	it("moves a built-in past a rival without carrying an installed extension along", () => {
		const registry = [entry("asker", 0), installed("weather-ext", 0)];
		const next = preferRegistryTools(
			result(
				loaded("/user/pi-asker.ts", ["ask_user_question"]),
				loaded("<inline:asker>", ["ask_user_question"]),
				loaded("<inline:ext:weather-ext>", ["ask_user_question"]),
			),
			registry,
		);
		expect(paths(next)).toEqual([
			"<inline:asker>",
			"/user/pi-asker.ts",
			"<inline:ext:weather-ext>",
		]);
	});

	it("keeps the first of two registry extensions ahead when a rival contests the second", () => {
		const registry = [entry("first", 0), entry("second", 0)];
		const next = preferRegistryTools(
			result(
				loaded("/user/pi.ts", ["weather"]),
				loaded("<inline:first>", ["shared"]),
				loaded("<inline:second>", ["shared", "weather"]),
			),
			registry,
		);
		expect(paths(next)).toEqual(["<inline:first>", "<inline:second>", "/user/pi.ts"]);
		expect(ownerOf(next, "shared")).toBe("<inline:first>");
		expect(ownerOf(next, "weather")).toBe("<inline:second>");
	});

	it("returns the result untouched when no tool names collide", () => {
		const calm = result(loaded("/user/other.ts", ["x"]), loaded("<inline:solo>", ["y"]));
		expect(preferRegistryTools(calm, entries)).toBe(calm);
	});
});

describe("extensionSessionServices", () => {
	const host: HostSessionServices = {
		expectToolResponse: () => {},
		awaitToolResponse: async () => ({ kind: "deferred" }),
		workspaceFiles: {
			check: async () => {},
			checkArtifacts: async (paths) => paths.map((path) => ({ path })),
			ensureArtifactsDir: async () => {},
			scratchDir: "",
			artifactsDir: "",
		},
	};
	const extension = {
		name: "demo",
		extensions: [],
		settings: { rich: { type: "boolean" as const, default: true } },
	};

	it("reads a declared setting's stored value for its own extension, else the default", () => {
		const values: Record<string, Record<string, boolean>> = { other: { rich: false } };
		const services = extensionSessionServices(extension, host, (name, key) => values[name]?.[key]);
		expect(services.setting("rich")).toBe(true);
		values.demo = { rich: false };
		expect(services.setting("rich")).toBe(false);
		expect(services.workspaceFiles).toBe(host.workspaceFiles);
	});

	it("refuses a setting the extension did not declare", () => {
		expect(() => extensionSessionServices(extension, host).setting("missing")).toThrow(
			'extension demo has no setting "missing"',
		);
	});
});
