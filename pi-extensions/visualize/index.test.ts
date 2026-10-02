import { describe, expect, test } from "bun:test";
import defaultFactory, { createVisualizeExtension, type MermaidValidator } from "./index.ts";

type ExecResult = { content: Array<{ type: string; text: string }>; details: unknown };
type CapturedTool = {
	name: string;
	label: string;
	execute: (id: string, params: unknown) => Promise<ExecResult>;
	renderCall?: unknown;
	renderResult?: unknown;
};

function loadTool(validateMermaid?: MermaidValidator): CapturedTool {
	let captured: CapturedTool | undefined;
	const fakePi = {
		registerTool: (def: CapturedTool) => {
			captured = def;
		},
	};
	const factory = validateMermaid ? createVisualizeExtension({ validateMermaid }) : defaultFactory;
	factory(fakePi as unknown as Parameters<typeof defaultFactory>[0]);
	if (!captured) throw new Error("factory did not register a tool");
	return captured;
}

describe("visualize extension", () => {
	test("registers a tool named 'visualize' with TUI renderers", () => {
		const tool = loadTool();
		expect(tool.name).toBe("visualize");
		expect(typeof tool.renderCall).toBe("function");
		expect(typeof tool.renderResult).toBe("function");
	});

	test("execute renders a supported diagram as a mermaid fence and echoes params as details", async () => {
		const res = await loadTool().execute("id", {
			type: "diagram",
			mermaid: "flowchart LR\n A[Start] --> B[Done]",
		});
		expect(res.content[0]?.type).toBe("text");
		expect(res.content[0]?.text).toContain("```mermaid");
		expect(res.content[0]?.text).toContain("A[Start] --> B[Done]");
		expect(res.details).toEqual({
			type: "diagram",
			mermaid: "flowchart LR\n A[Start] --> B[Done]",
		});
	});

	test("execute passes families the probe cannot render through unvalidated", async () => {
		const res = await loadTool().execute("id", {
			type: "diagram",
			mermaid: "gantt\n title X\n section S\n task :a1, 2024-01-01, 3d",
		});
		expect(res.content[0]?.text).toContain("gantt");
	});

	test("execute renders a comparison with pros and a recommended marker", async () => {
		const res = await loadTool().execute("id", {
			type: "comparison",
			options: [{ name: "A", pros: ["x"], recommended: true }],
		});
		expect(res.content[0]?.text).toContain("- x");
		expect(res.content[0]?.text).toContain("✅ Recommended");
	});

	test("execute rejects whitespace-only Mermaid with its option location", async () => {
		await expect(
			loadTool().execute("id", {
				type: "comparison",
				options: [{ name: "Blank", mermaid: "   " }],
			}),
		).rejects.toThrow(/visualize: invalid Mermaid syntax in `options\[0\]\.mermaid`/);
	});

	test("the default probe rejects a bad direction header and an empty render, with the location", async () => {
		await expect(
			loadTool().execute("id", { type: "diagram", mermaid: "flowchart XX\n A --> B" }),
		).rejects.toThrow(/invalid Mermaid syntax in `mermaid`: Invalid mermaid header/);
		await expect(
			loadTool().execute("id", {
				type: "comparison",
				options: [{ name: "Broken", mermaid: "sequenceDiagram\n this is not a message" }],
			}),
		).rejects.toThrow(
			/visualize: invalid Mermaid syntax in `options\[0\]\.mermaid`: the diagram renders empty[\s\S]*correct the syntax and call `visualize` again/i,
		);
	});

	test("the default probe is best-effort: a dangling edge renders a partial diagram without error", async () => {
		await expect(
			loadTool().execute("id", { type: "diagram", mermaid: "flowchart LR\n A -->" }),
		).resolves.toBeDefined();
	});

	test("an injected validator replaces the default probe and is wrapped with the location", async () => {
		const seen: string[] = [];
		const strict: MermaidValidator = (source) => {
			seen.push(source);
			if (source.includes("-->\n") || source.endsWith("-->"))
				throw new Error("Parse error on line 2");
		};
		const tool = loadTool(strict);
		await tool.execute("ok", { type: "diagram", mermaid: "gantt\n title X" });
		await expect(
			tool.execute("bad", { type: "diagram", mermaid: "flowchart LR\n A -->" }),
		).rejects.toThrow(/invalid Mermaid syntax in `mermaid`: Parse error on line 2/);
		expect(seen).toEqual(["gantt\n title X", "flowchart LR\n A -->"]);
	});

	test("execute rejects an invalid shape", async () => {
		await expect(loadTool().execute("id", { type: "diagram" })).rejects.toThrow(/mermaid/);
	});
});
