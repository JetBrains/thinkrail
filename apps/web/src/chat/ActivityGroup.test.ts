import { describe, expect, it } from "bun:test";
import { summarizeSteps } from "./ActivityGroup";
import type { RoutineToolStep } from "./rows";

const tool = (id: string, toolName: string): RoutineToolStep => ({
	kind: "tool",
	id,
	toolCallId: id,
	toolName,
	args: {},
	tool: undefined,
	dead: false,
	streaming: false,
});

describe("summarizeSteps (collapsed routine-tool headers)", () => {
	it("counts steps and tallies per tool name in first-seen order", () => {
		expect(summarizeSteps([tool("a", "bash"), tool("b", "read"), tool("c", "bash")])).toBe(
			"3 steps · bash ×2, read",
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
