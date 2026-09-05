import { describe, expect, test } from "bun:test";
import factory from "./index.ts";

type ExecResult = { content: Array<{ type: string; text: string }>; details: unknown };
type CapturedTool = {
	name: string;
	label: string;
	execute: (id: string, params: unknown) => Promise<ExecResult>;
};

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

	test("execute renders valid labeled Mermaid without leaking DOM globals", async () => {
		const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
		const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
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
		expect(Object.getOwnPropertyDescriptor(globalThis, "window")).toEqual(windowDescriptor);
		expect(Object.getOwnPropertyDescriptor(globalThis, "document")).toEqual(documentDescriptor);
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

	test("execute rejects invalid comparison Mermaid with its option location", async () => {
		await expect(
			loadTool().execute("id", {
				type: "comparison",
				options: [
					{ name: "Valid", mermaid: "flowchart LR\n A --> B" },
					{ name: "Invalid", mermaid: "flowchart LR\n A -->" },
				],
			}),
		).rejects.toThrow(/visualize: invalid Mermaid syntax in `options\[1\]\.mermaid`/);
	});

	test("execute rejects whitespace-only comparison Mermaid before browser rendering", async () => {
		await expect(
			loadTool().execute("id", {
				type: "comparison",
				options: [{ name: "Blank", mermaid: "   " }],
			}),
		).rejects.toThrow(/visualize: invalid Mermaid syntax in `options\[0\]\.mermaid`/);
	});

	test("execute rejects invalid top-level Mermaid with correction feedback", async () => {
		await expect(
			loadTool().execute("id", { type: "diagram", mermaid: "flowchart LR\n A -->" }),
		).rejects.toThrow(
			/visualize: invalid Mermaid syntax in `mermaid`[\s\S]*parse error[\s\S]*correct the syntax and call `visualize` again/i,
		);
	});

	test("execute serializes Mermaid parsing across tool instances", async () => {
		await loadTool().execute("warmup", { type: "diagram", mermaid: "flowchart LR\n A --> B" });
		const mermaid = (await import("mermaid")).default;
		const parseDescriptor = Object.getOwnPropertyDescriptor(mermaid, "parse");
		let active = 0;
		let maxActive = 0;
		try {
			Object.defineProperty(mermaid, "parse", {
				configurable: true,
				value: async () => {
					active += 1;
					maxActive = Math.max(maxActive, active);
					await Bun.sleep(10);
					active -= 1;
				},
				writable: true,
			});
			await Promise.all([
				loadTool().execute("first", { type: "diagram", mermaid: "flowchart LR\n A --> B" }),
				loadTool().execute("second", { type: "diagram", mermaid: "flowchart LR\n C --> D" }),
			]);
			expect(maxActive).toBe(1);
		} finally {
			if (parseDescriptor) Object.defineProperty(mermaid, "parse", parseDescriptor);
		}
	});

	test("execute rejects an invalid shape", async () => {
		await expect(loadTool().execute("id", { type: "diagram" })).rejects.toThrow(/mermaid/);
	});
});
