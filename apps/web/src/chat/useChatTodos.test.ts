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

test("the add-nudge is the item's own text, so its queued row is located by that text", () => {
	expect(todoNudgeText("Ship it")).toBe("Ship it");
	const followUp = ["unrelated follow-up", todoNudgeText("Ship it"), todoNudgeText("Write docs")];
	expect(findTodoNudgeIndex(followUp, "Ship it")).toBe(1);
	expect(findTodoNudgeIndex(followUp, "Write docs")).toBe(2);
});

test("a TODO whose nudge is gone (delivered) or never queued yields no index (no accidental removal)", () => {
	expect(findTodoNudgeIndex([], "Ship it")).toBe(-1);
	expect(findTodoNudgeIndex(["something else entirely"], "Ship it")).toBe(-1);
});
