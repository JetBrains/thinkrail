import { describe, expect, it } from "bun:test";
import type {
	Extension,
	ExtensionAPI,
	InlineExtension,
	LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import {
	omitDisabledRegistryExtensions,
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
		expect(registryExtensionName("<inline:headless>", entries)).toBeUndefined();
		expect(registryExtensionName("<inline:3>", entries)).toBeUndefined();
		expect(registryExtensionName("/disk/solo.ts", entries)).toBeUndefined();
	});
});
