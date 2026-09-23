import { expect, test } from "bun:test";
import type { PiEvent } from "@thinkrail/contracts";
import { findTodoNudgeIndex, shouldRefreshTodos, todoNudgeText } from "./useChatTodos";

test("TODO refreshes follow tool completion and final settlement, not attempt-level agent_end", () => {
	expect(shouldRefreshTodos({ type: "tool_execution_end" } as PiEvent)).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_settled", terminal: null })).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_end", messages: [], willRetry: false } as PiEvent)).toBe(
		false,
	);
});

test("a removed TODO's queued add-nudge is located by its exact text so it can be dequeued", () => {
	const followUp = ["unrelated follow-up", todoNudgeText("Ship it"), todoNudgeText("Write docs")];
	expect(findTodoNudgeIndex(followUp, "Ship it")).toBe(1);
	expect(findTodoNudgeIndex(followUp, "Write docs")).toBe(2);
});

test("an undelivered or never-nudged TODO yields no queue index (no accidental removal)", () => {
	expect(findTodoNudgeIndex([], "Ship it")).toBe(-1);
	expect(findTodoNudgeIndex(["Ship it", "Added a TODO: Ship it"], "Ship it")).toBe(-1);
});
