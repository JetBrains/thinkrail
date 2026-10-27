import { describe, expect, it } from "bun:test";
import type { InteractiveTool } from "@thinkrail/extension-api/server";
import { interactiveTools } from "./interactive";
import type { ServerExtensionEntry } from "./registry";

function entry(name: string, tools: Record<string, InteractiveTool>): ServerExtensionEntry {
	return {
		specifier: `@acme/${name}/server`,
		extension: { name, extensions: [], interactiveTools: tools },
	};
}

describe("interactiveTools", () => {
	it("collects the shipped registry's interactive tools when nothing is disabled", () => {
		const tools = interactiveTools(() => false);
		expect(tools.has("ask_user_question")).toBe(true);
		expect(typeof tools.get("ask_user_question")?.describeResponse).toBe("function");
		expect([...tools.keys()]).toEqual(["ask_user_question"]);
	});

	it("drops a disabled extension's tools", () => {
		const tools = interactiveTools((name) => name === "ask-user-question");
		expect(tools.has("ask_user_question")).toBe(false);
		expect(tools.size).toBe(0);
	});

	it("keeps the first extension's declaration when two declare the same tool", () => {
		const first: InteractiveTool = { describeResponse: () => "first" };
		const second: InteractiveTool = { describeResponse: () => "second" };
		const tools = interactiveTools(
			() => false,
			[
				entry("alpha", { shared: first, alpha_only: {} }),
				entry("beta", { shared: second, beta_only: {} }),
			],
		);
		expect(tools.get("shared")).toBe(first);
		expect([...tools.keys()].sort()).toEqual(["alpha_only", "beta_only", "shared"]);
	});

	it("lets a later extension win a collision when the first one is disabled", () => {
		const second: InteractiveTool = { describeResponse: () => "second" };
		const tools = interactiveTools(
			(name) => name === "alpha",
			[
				entry("alpha", { shared: { describeResponse: () => "first" } }),
				entry("beta", { shared: second }),
				{ specifier: "@acme/quiet/server", extension: { name: "quiet", extensions: [] } },
			],
		);
		expect(tools.get("shared")).toBe(second);
		expect(tools.size).toBe(1);
	});
});
