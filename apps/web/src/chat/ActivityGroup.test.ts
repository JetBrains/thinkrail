import { describe, expect, it } from "bun:test";
import { summarizeSteps } from "./ActivityGroup";
import type { ActivityStep } from "./rows";

const tool = (id: string, toolName: string): ActivityStep => ({
	kind: "tool",
	id,
	toolCallId: id,
	toolName,
	args: {},
	tool: undefined,
	dead: false,
	streaming: false,
});

const thinking = (id: string, text = "hmm"): ActivityStep => ({
	kind: "thinking",
	id,
	text,
	streaming: false,
});

describe("summarizeSteps (the collapsed activity-group header)", () => {
	it("counts steps and tallies per tool name in first-seen order", () => {
		expect(summarizeSteps([tool("a", "bash"), tool("b", "read"), tool("c", "bash")])).toBe(
			"3 steps · bash ×2, read",
		);
	});

	it("labels thinking blocks as 'thinking' alongside tools", () => {
		expect(summarizeSteps([thinking("t1"), tool("a", "bash"), thinking("t2")])).toBe(
			"3 steps · thinking ×2, bash",
		);
	});

	it("uses the singular 'step' for one step", () => {
		expect(summarizeSteps([tool("a", "read")])).toBe("1 step · read");
	});

	it("caps the name list at 4 with a '+k more' overflow", () => {
		const steps = [
			tool("a", "bash"),
			tool("b", "read"),
			tool("c", "edit"),
			tool("d", "write"),
			tool("e", "grep"),
			tool("f", "glob"),
		];
		expect(summarizeSteps(steps)).toBe("6 steps · bash, read, edit, write, +2 more");
	});
});
