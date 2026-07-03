import { describe, expect, it } from "bun:test";
import type { ToolRenderProps } from "./toolRegistry";
import {
	getToolChrome,
	getToolRenderer,
	getToolSummary,
	registerToolRenderer,
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
		registerToolRenderer(
			"summary-tool",
			() => null,
			({ args }) => `ran ${String(args.command)}`,
		);
		expect(getToolSummary("summary-tool", props({ command: "echo hi" }))).toBe("ran echo hi");
	});

	it("still resolves the renderer (falls back to the default for unknown tools)", () => {
		const renderer = () => null;
		registerToolRenderer("with-renderer", renderer);
		expect(getToolRenderer("with-renderer")).toBe(renderer);
		// Unknown tools fall back rather than throwing.
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
		registerToolRenderer("bare-tool", () => null, undefined, "bare");
		expect(getToolChrome("bare-tool")).toBe("bare");
	});
});
