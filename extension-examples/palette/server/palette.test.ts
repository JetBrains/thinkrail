import { describe, expect, it } from "bun:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices } from "@thinkrail/extension-sdk/server";
import packageJson from "../package.json" with { type: "json" };
import extension, { PALETTE_TOOL } from "./index";
import { buildPalette, contrast, parseHex } from "./palette";

function registeredTool(contrastSetting: boolean): ToolDefinition {
	const session: ExtensionSessionServices = {
		expectToolResponse: () => {},
		awaitToolResponse: async () => ({ kind: "abandoned" }),
		setting: (key) => (key === "contrast" ? contrastSetting : false),
		workspaceFiles: {
			check: async () => {},
			ensureArtifactsDir: async () => {},
			scratchDir: "/tmp",
			artifactsDir: "/tmp",
		},
	};
	const tools: ToolDefinition[] = [];
	const pi = {
		registerTool: (tool: ToolDefinition) => tools.push(tool),
	} as unknown as ExtensionAPI;
	for (const factory of extension.sessionExtensions?.(session) ?? []) factory(pi);
	const [tool] = tools;
	if (!tool) throw new Error("no tool registered");
	return tool;
}

async function run(contrastSetting: boolean, params: Record<string, unknown>) {
	const tool = registeredTool(contrastSetting);
	const result = await tool.execute("call-1", params as never, undefined, undefined, {} as never);
	const [block] = result.content;
	return { text: block?.type === "text" ? block.text : "", details: result.details };
}

describe("palette math", () => {
	it("reads three- and six-digit hex colours", () => {
		expect(parseHex("#38f")).toEqual([0x33, 0x88, 0xff]);
		expect(parseHex("3B82F6")).toEqual([0x3b, 0x82, 0xf6]);
		expect(() => parseHex("blue")).toThrow('"blue" is not a hex colour');
	});

	it("rates WCAG contrast against the better of white and black text", () => {
		expect(contrast("#000000")).toEqual({ text: "white", ratio: 21, rating: "AAA" });
		expect(contrast("#ffffff")).toEqual({ text: "black", ratio: 21, rating: "AAA" });
		expect(contrast("#3b82f6")).toEqual({ text: "black", ratio: 5.71, rating: "AA" });
	});

	it("builds the same palette every time", () => {
		expect(buildPalette("#3b82f6", "triadic", false).colors).toEqual([
			{ hex: "#3b82f6", role: "base" },
			{ hex: "#f63b82", role: "triad +120°" },
			{ hex: "#82f63b", role: "triad +240°" },
			{ hex: "#fa9dc0", role: "triad +120° tint" },
			{ hex: "#c0fa9d", role: "triad +240° tint" },
		]);
		const mono = buildPalette("#3b82f6", "monochromatic", true).colors;
		expect(mono.map((color) => color.role)).toEqual([
			"darkest",
			"darker",
			"base",
			"lighter",
			"lightest",
		]);
		expect(mono.every((color) => color.contrast !== undefined)).toBe(true);
	});
});

describe("the server half", () => {
	it("is named after its package and declares the contrast setting with its own copy", () => {
		expect(extension.name).toBe(packageJson.name);
		expect(extension.settings?.contrast).toMatchObject({
			type: "boolean",
			default: true,
			title: "Rate contrast",
		});
	});

	it("registers color_palette per session", () => {
		expect(registeredTool(true).name).toBe(PALETTE_TOOL);
	});

	it("rates contrast while the setting is on", async () => {
		const { text, details } = await run(true, { base: "#3b82f6", harmony: "complementary" });
		expect(text).toStartWith("complementary palette from #3b82f6:");
		expect(text).toContain("1. #3b82f6 base — black text 5.71:1 (AA)");
		expect(text).toContain("--palette-1: #3b82f6;");
		expect(details).toMatchObject({ contrastChecked: true });
	});

	it("leaves contrast out while the setting is off", async () => {
		const { text, details } = await run(false, { base: "#3b82f6" });
		expect(text).toStartWith("analogous palette from #3b82f6:");
		expect(text).toContain("1. #3b82f6 base\n");
		expect(text).not.toContain(":1 (");
		expect(details).toMatchObject({ contrastChecked: false });
		expect(JSON.stringify(details)).not.toContain("ratio");
	});

	it("rejects a base that is not a hex colour", async () => {
		await expect(run(true, { base: "teal" })).rejects.toThrow('"teal" is not a hex colour');
	});
});
