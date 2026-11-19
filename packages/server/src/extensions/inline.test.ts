import { describe, expect, it } from "bun:test";
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
	preferRegistryTools,
	registryExtensionName,
	registryInlineExtensions,
} from "./inline";
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

	it("never moves a later registry extension ahead of an earlier one it promotes past", () => {
		const registry = [entry("asker", 0), entry("weather-ext", 0)];
		const next = preferRegistryTools(
			result(
				loaded("/user/pi-weather.ts", ["weather"]),
				loaded("<inline:asker>", ["ask_user_question"]),
				loaded("<inline:3>", ["host"]),
				loaded("<inline:weather-ext>", ["weather", "ask_user_question"]),
			),
			registry,
		);
		expect(paths(next)).toEqual([
			"<inline:asker>",
			"<inline:weather-ext>",
			"/user/pi-weather.ts",
			"<inline:3>",
		]);
		expect(ownerOf(next, "ask_user_question")).toBe("<inline:asker>");
		expect(ownerOf(next, "weather")).toBe("<inline:weather-ext>");
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
