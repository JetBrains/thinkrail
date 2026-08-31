import { describe, expect, test } from "bun:test";
import "./tools/register";
import {
	estimateChatRowHeight,
	estimateChatRowHeights,
	estimateMarkdownHeight,
} from "./rowHeightEstimates";
import { type ChatRow, projectRows } from "./rows";

const paragraph =
	"A realistic assistant response explains the decision in complete sentences, connects each detail to the next, and leaves enough prose to wrap across several lines in the chat transcript.";

function markdownRow(id: string, text: string): ChatRow {
	return { kind: "markdown", id, text };
}

function userRow(id: string, content: string): ChatRow {
	return {
		kind: "user",
		id,
		message: { role: "user", content, timestamp: 0 },
	};
}

function toolRow(toolName: string, args: Record<string, unknown>): ChatRow {
	return {
		kind: "tool",
		id: `${toolName}-1`,
		toolCallId: `${toolName}-1`,
		toolName,
		args,
		tool: { status: "done", raw: null },
		dead: false,
		streaming: false,
	};
}

describe("estimateMarkdownHeight", () => {
	test("gives a hundred prose paragraphs a multi-thousand-pixel estimate", () => {
		const text = Array.from({ length: 100 }, (_, index) => `${index + 1}. ${paragraph}`).join(
			"\n\n",
		);
		const estimate = estimateMarkdownHeight(text);

		expect(estimate).toBeGreaterThanOrEqual(3_000);
		expect(estimate).toBeLessThanOrEqual(20_000);
	});

	test("stays positive, finite, monotonic, and bounded for pathological prose", () => {
		const estimates = [
			estimateMarkdownHeight(""),
			estimateMarkdownHeight("Brief answer."),
			estimateMarkdownHeight(paragraph.repeat(20)),
			estimateMarkdownHeight("word ".repeat(200_000)),
		];

		expect(estimates.every((height) => Number.isFinite(height))).toBe(true);
		expect(estimates.every((height) => height > 0 && height <= 20_000)).toBe(true);
		for (let index = 1; index < estimates.length; index += 1) {
			expect(estimates[index]).toBeGreaterThanOrEqual(estimates[index - 1] ?? 0);
		}
		expect(estimates[2]).toBeGreaterThan(estimates[1] ?? 0);
	});

	test("counts fenced code by physical lines instead of wrapping a long line", () => {
		const shortLine = estimateMarkdownHeight("```text\nx\n```");
		const longLine = estimateMarkdownHeight(`\`\`\`text\n${"x".repeat(4_000)}\n\`\`\``);
		const manyLines = estimateMarkdownHeight(
			`\`\`\`text\n${Array.from({ length: 20 }, () => "x").join("\n")}\n\`\`\``,
		);

		expect(longLine).toBe(shortLine);
		expect(manyLines).toBeGreaterThan(longLine);
	});
});

describe("chat row height estimates", () => {
	test("preserves projected row order and length", () => {
		const canonical: ChatRow[] = [
			userRow("u1", "first question"),
			markdownRow("a1:text:0", "Short answer."),
			{ kind: "system", id: "s1", text: "✓ Done" },
			userRow("u2", "second question"),
			markdownRow("a2:text:0", paragraph.repeat(30)),
		];
		const projected = projectRows(canonical, "newest-first");
		const heights = estimateChatRowHeights(projected, new Map());

		expect(projected.map((row) => row.id)).toEqual(["a2:text:0", "u2", "s1", "a1:text:0", "u1"]);
		expect(heights).toHaveLength(projected.length);
		expect(heights).toEqual(projected.map((row) => estimateChatRowHeight(row)));
		expect(heights[0]).toBeGreaterThan(heights[2] ?? 0);
	});

	test("reuses a mounted estimate while streaming and refreshes it for a virtualizer remount", () => {
		const cache = new Map();
		const id = "assistant-stream:text:0";
		const initial = estimateChatRowHeights([markdownRow(id, "Starting response.")], cache)[0];
		const grownRow = markdownRow(id, Array.from({ length: 60 }, () => paragraph).join("\n\n"));
		const cached = estimateChatRowHeights([grownRow], cache)[0];
		const remounted = estimateChatRowHeights([grownRow], new Map())[0];

		expect(cached).toBe(initial);
		expect(remounted).toBeGreaterThan(initial ?? 0);
	});

	test("models collapsed reports and expanded visualization payloads", () => {
		const report: ChatRow = {
			kind: "subagentCompletion",
			id: "subagent-1",
			text: Array.from({ length: 100 }, () => paragraph).join("\n\n"),
			details: {
				childSessionId: "child-1",
				task: "Inspect the fixture",
				status: "completed",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					turns: 1,
					contextTokens: 0,
				},
				durationMs: 1,
			},
		};
		const visualization = toolRow("visualize", {
			type: "comparison",
			options: [{ name: "Detailed", description: paragraph.repeat(100) }],
		});

		expect(estimateChatRowHeight(report)).toBeLessThan(100);
		expect(estimateChatRowHeight(visualization)).toBeGreaterThan(3_000);
	});
});
