import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { summarizeSteps } from "./ActivityGroup";
import type { ChatRow, RoutineToolStep } from "./rows";
import { ChatTurnView } from "./turns";

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

describe("activity disclosure summaries", () => {
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

	it("counts nested thinking and tools in one outer N-step disclosure", () => {
		const row: ChatRow = {
			kind: "activity",
			id: "activity:a",
			steps: [
				tool("a", "read"),
				{
					kind: "thinking",
					id: "thinking-1",
					text: "inspect first",
					streaming: false,
					tools: [tool("b", "read"), tool("c", "read")],
				},
			],
			live: false,
		};

		const markup = renderToStaticMarkup(
			ChatTurnView({ row, agentResponded: false, isFinalAnswer: false }),
		);

		expect(markup).toContain('data-testid="activity-group"');
		expect(markup).toContain('data-activity-node-id="activity:a"');
		expect(markup).toContain('data-activity-node-kind="activity"');
		expect(markup).toContain("data-activity-node-toggle");
		expect(markup).toContain("4 steps · read ×3, thinking");
		expect(markup).not.toContain(">Activity<");
		expect(markup).not.toContain("inspect first");

		const liveMarkup = renderToStaticMarkup(
			ChatTurnView({
				row: { ...row, live: true },
				agentResponded: false,
				isFinalAnswer: false,
			}),
		);
		expect(liveMarkup).toContain('data-activity-node-label="4 steps"');
	});
});
