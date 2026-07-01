import { describe, expect, test } from "bun:test";
import factory from "./index.ts";

type ExecResult = { content: Array<{ type: string; text: string }>; details: unknown };
type CapturedTool = {
	name: string;
	label: string;
	execute: (id: string, params: unknown) => Promise<ExecResult>;
};

/** Run the extension factory with a fake `pi` and return the single registered tool. */
function loadTool(): CapturedTool {
	let captured: CapturedTool | undefined;
	const fakePi = {
		registerTool: (def: CapturedTool) => {
			captured = def;
		},
	};
	factory(fakePi as unknown as Parameters<typeof factory>[0]);
	if (!captured) throw new Error("factory did not register a tool");
	return captured;
}

describe("visualize extension", () => {
	test("registers a tool named 'visualize'", () => {
		expect(loadTool().name).toBe("visualize");
	});

	test("execute renders a diagram to a mermaid fence", async () => {
		const res = await loadTool().execute("id", { type: "diagram", mermaid: "graph LR; A-->B" });
		expect(res.content[0]?.type).toBe("text");
		expect(res.content[0]?.text).toContain("```mermaid");
		expect(res.content[0]?.text).toContain("A-->B");
		expect(res.details).toEqual({ type: "diagram", mermaid: "graph LR; A-->B" });
	});

	test("execute renders a comparison with pros and a recommended marker", async () => {
		const res = await loadTool().execute("id", {
			type: "comparison",
			options: [{ name: "A", pros: ["x"], recommended: true }],
		});
		expect(res.content[0]?.text).toContain("A");
		expect(res.content[0]?.text).toContain("- x");
		expect(res.content[0]?.text).toContain("✅ Recommended");
	});

	test("execute rejects an invalid shape", async () => {
		await expect(loadTool().execute("id", { type: "diagram" })).rejects.toThrow(/mermaid/);
	});
});
