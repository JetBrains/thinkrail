import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "./index";
import piWebAccess from "./piWebAccess.js";

type ToolCallHandler = (event: { toolName: string; input: Record<string, unknown> }) => void;

function toolCallHandler(): ToolCallHandler {
	const handlers: ToolCallHandler[] = [];
	const fakePi = {
		on: (event: string, handler: ToolCallHandler) => {
			if (event === "tool_call") handlers.push(handler);
		},
	};
	const [policy] = extension.extensions;
	if (!policy) throw new Error("server half declares no extension factory");
	policy(fakePi as unknown as ExtensionAPI);
	const [handler] = handlers;
	if (!handler) throw new Error("the headless policy registered no tool_call handler");
	return handler;
}

describe("web-access server half", () => {
	test("composes the headless policy and pi-web-access for parents and children, with its skills", () => {
		expect(extension.name).toBe("web-access");
		expect(extension.title).toBe("Web access");
		expect(extension.description).toBeTruthy();
		expect(extension.extensions).toHaveLength(2);
		expect(extension.extensions[1]).toBe(piWebAccess);
		expect(extension.childExtensions).toEqual(extension.extensions);
		expect(extension.skillPackages).toEqual(["pi-web-access"]);
	});

	test("the wrapped factory loads the package and registers its tools", async () => {
		const tools: string[] = [];
		const recording = new Proxy(
			{ registerTool: (tool: { name: string }) => tools.push(tool.name) },
			{ get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
		);
		await piWebAccess(recording as unknown as ExtensionAPI);
		expect(tools).toEqual(["web_search", "fetch_content", "get_search_content"]);
	});

	test("keeps web_search headless unless the agent chose a workflow", () => {
		const handler = toolCallHandler();
		const unset: Record<string, unknown> = { query: "q" };
		handler({ toolName: "web_search", input: unset });
		expect(unset.workflow).toBe("none");

		const chosen: Record<string, unknown> = { query: "q", workflow: "summary-review" };
		handler({ toolName: "web_search", input: chosen });
		expect(chosen.workflow).toBe("summary-review");

		const other: Record<string, unknown> = { url: "https://example.com" };
		handler({ toolName: "fetch_content", input: other });
		expect(other).not.toHaveProperty("workflow");
	});
});
