import { describe, expect, it } from "bun:test";
import type { ToolRenderProps } from "./toolRegistry";
import { getToolRenderer, getToolSummary, registerToolRenderer } from "./toolRegistry";

const props = (args: Record<string, unknown>): ToolRenderProps => ({
	toolName: "x",
	args,
	result: undefined,
	status: "running",
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
