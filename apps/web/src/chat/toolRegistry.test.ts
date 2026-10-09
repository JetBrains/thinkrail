import { describe, expect, it } from "bun:test";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import {
	DefaultToolRenderer,
	getToolChrome,
	getToolRenderer,
	getToolSummary,
	registerToolRenderer,
	registerToolRendererPrefix,
	resolveProminence,
} from "./toolRegistry";

const props = (args: Record<string, unknown>): ToolRenderProps => ({
	toolCallId: "tc1",
	toolName: "x",
	args,
	result: undefined,
	status: "running",
	streaming: false,
});

describe("toolRegistry summaries", () => {
	it("returns '' for a tool registered without a summary (collapsed header is just the name)", () => {
		registerToolRenderer("no-summary-tool", () => null);
		expect(getToolSummary("no-summary-tool", props({ command: "ls" }))).toBe("");
	});

	it("returns '' for an unregistered tool", () => {
		expect(getToolSummary("never-registered", props({}))).toBe("");
	});

	it("invokes the registered summary with the render props", () => {
		registerToolRenderer("summary-tool", () => null, {
			summary: ({ args }) => `ran ${String(args.command)}`,
		});
		expect(getToolSummary("summary-tool", props({ command: "echo hi" }))).toBe("ran echo hi");
	});

	it("still resolves the renderer (falls back to the default for unknown tools)", () => {
		const renderer = () => null;
		registerToolRenderer("with-renderer", renderer);
		expect(getToolRenderer("with-renderer")).toBe(renderer);
		expect(typeof getToolRenderer("totally-unknown")).toBe("function");
	});
});

describe("toolRegistry chrome", () => {
	it("defaults to 'card' (the collapsible frame)", () => {
		registerToolRenderer("card-tool", () => null);
		expect(getToolChrome("card-tool")).toBe("card");
		expect(getToolChrome("never-registered-chrome")).toBe("card");
	});

	it("honors a registered 'bare' chrome (renderer owns its frame)", () => {
		registerToolRenderer("bare-chrome-tool", () => null, { chrome: "bare" });
		expect(getToolChrome("bare-chrome-tool")).toBe("bare");
	});
});

describe("resolveProminence (the settings seam)", () => {
	it("defaults to routine + not defaultExpanded — including unregistered tools", () => {
		registerToolRenderer("plain-tool", () => null);
		expect(resolveProminence("plain-tool")).toEqual({
			prominence: "routine",
			defaultExpanded: false,
		});
		expect(resolveProminence("never-registered")).toEqual({
			prominence: "routine",
			defaultExpanded: false,
		});
	});

	it("honors a registered primary + defaultExpanded (the visualize shape)", () => {
		registerToolRenderer("viz-like-tool", () => null, {
			prominence: "primary",
			defaultExpanded: true,
		});
		expect(resolveProminence("viz-like-tool")).toEqual({
			prominence: "primary",
			defaultExpanded: true,
		});
	});

	it("'bare' chrome implies primary (a self-framed renderer can't fold into step rows)", () => {
		registerToolRenderer("bare-implies-primary", () => null, { chrome: "bare" });
		expect(resolveProminence("bare-implies-primary").prominence).toBe("primary");
	});

	it("'bare' chrome wins even over an explicit routine prominence (misregistration guard)", () => {
		registerToolRenderer("bare-declared-routine", () => null, {
			chrome: "bare",
			prominence: "routine",
		});
		expect(resolveProminence("bare-declared-routine").prominence).toBe("primary");
	});
});

describe("prefix registrations (one resolver for every registry read)", () => {
	const prefixRenderer = () => null;
	const exactRenderer = () => null;
	const longerRenderer = () => null;
	registerToolRendererPrefix("pfx__", prefixRenderer, {
		summary: () => "from prefix",
		chrome: "bare",
		defaultExpanded: true,
	});
	registerToolRendererPrefix("pfx__long__", longerRenderer, { summary: () => "from longer" });
	registerToolRenderer("pfx__exact", exactRenderer, { summary: () => "from exact" });

	it("resolves renderer, summary, chrome and prominence for a prefixed name", () => {
		expect(getToolRenderer("pfx__server__tool")).toBe(prefixRenderer);
		expect(getToolSummary("pfx__server__tool", props({}))).toBe("from prefix");
		expect(getToolChrome("pfx__server__tool")).toBe("bare");
		expect(resolveProminence("pfx__server__tool")).toEqual({
			prominence: "primary",
			defaultExpanded: true,
		});
	});

	it("lets an exact registration beat a matching prefix", () => {
		expect(getToolRenderer("pfx__exact")).toBe(exactRenderer);
		expect(getToolSummary("pfx__exact", props({}))).toBe("from exact");
		expect(getToolChrome("pfx__exact")).toBe("card");
		expect(resolveProminence("pfx__exact").prominence).toBe("routine");
	});

	it("prefers the longest matching prefix", () => {
		expect(getToolRenderer("pfx__long__tool")).toBe(longerRenderer);
		expect(getToolSummary("pfx__long__tool", props({}))).toBe("from longer");
	});

	it("leaves names the prefix does not start with on the default renderer", () => {
		for (const name of ["pfx_", "x_pfx__tool", "PFX__tool"]) {
			expect(getToolRenderer(name)).toBe(DefaultToolRenderer);
			expect(getToolSummary(name, props({}))).toBe("");
			expect(resolveProminence(name)).toEqual({ prominence: "routine", defaultExpanded: false });
		}
	});

	it("never lets an empty prefix capture every tool", () => {
		registerToolRendererPrefix("", () => null);
		expect(getToolRenderer("some-unregistered-tool")).toBe(DefaultToolRenderer);
	});
});
