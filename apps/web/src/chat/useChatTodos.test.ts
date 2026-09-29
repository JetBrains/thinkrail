import { expect, test } from "bun:test";
import type { PiEvent, TodoItem, TodoPlan } from "@thinkrail/contracts";
import { PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsPlanSummaryGeneration } from "../transport";
import { planIsCompleteWithoutSummary, shouldRefreshTodos } from "./useChatTodos";

const item = (status: TodoItem["status"]): TodoItem => ({
	id: `t_${status}_${Math.random()}`,
	title: "step",
	status,
	origin: "agent",
	createdAt: "",
	updatedAt: "",
});
const plan = (over: Partial<TodoPlan>): TodoPlan => ({ todos: [], groups: [], ...over });

test("TODO refreshes follow tool completion and final settlement, not attempt-level agent_end", () => {
	expect(shouldRefreshTodos({ type: "tool_execution_end" } as PiEvent)).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_settled", terminal: null })).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_end", messages: [], willRetry: false } as PiEvent)).toBe(
		false,
	);
});

test("auto-summary is eligible only when every step is done and no summary exists", () => {
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done")] }))).toBe(true);
	expect(
		planIsCompleteWithoutSummary(
			plan({ groups: [{ id: "g", title: "T", todos: [item("done"), item("done")] }] }),
		),
	).toBe(true);
	// An open step, a lingering summary, or an empty plan are all ineligible.
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done"), item("pending")] }))).toBe(
		false,
	);
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done")], summary: "already" }))).toBe(
		false,
	);
	expect(planIsCompleteWithoutSummary(plan({}))).toBe(false);
});

test("a completed plan requests a draft only from a host that advertises the v69 capability", () => {
	const completed = plan({ todos: [item("done")] });
	const wouldRequest = (pv: number | null) =>
		planIsCompleteWithoutSummary(completed) && supportsPlanSummaryGeneration(pv);
	expect(wouldRequest(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION)).toBe(true);
	expect(wouldRequest(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(wouldRequest(null)).toBe(false);
});
