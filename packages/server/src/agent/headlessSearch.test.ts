import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { headlessSearchPolicy } from "./headlessSearch";

type ToolCallHandler = (event: { toolName: string; input: Record<string, unknown> }) => void;

test("keeps web_search headless unless the agent chose a workflow", () => {
	const handlers: ToolCallHandler[] = [];
	const fakePi = {
		on: (event: string, handler: ToolCallHandler) => {
			if (event === "tool_call") handlers.push(handler);
		},
	};
	headlessSearchPolicy(fakePi as unknown as ExtensionAPI);
	const [handler] = handlers;
	if (!handler) throw new Error("the headless policy registered no tool_call handler");

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
