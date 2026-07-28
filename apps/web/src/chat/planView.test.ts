import { expect, test } from "bun:test";
import type { AssistantMessage, TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import type { AskState } from "./askState";
import {
	groupProgress,
	groupStatus,
	planGlance,
	planSummary,
	sessionGlance,
	shouldNudgeOnAdd,
} from "./planView";
import type { ChatTurn } from "./types";

const item = (title: string, status: TodoItem["status"] = "pending"): TodoItem => ({
	id: `t_${title}`,
	title,
	status,
	origin: "agent",
	createdAt: "",
	updatedAt: "",
});

const group = (title: string, todos: TodoItem[]): TodoGroupItem => ({
	id: `g_${title}`,
	title,
	todos,
});

// Mirrors pi-todos/core's groupStatus — the truth table must match (see planView.ts).
test("groupStatus derives the task lifecycle from the steps", () => {
	expect(groupStatus(group("t", [item("a"), item("b")]))).toBe("pending");
	expect(groupStatus(group("t", [item("a", "in_progress"), item("b")]))).toBe("active");
	expect(groupStatus(group("t", [item("a", "done"), item("b")]))).toBe("pending");
	expect(groupStatus(group("t", [item("a", "done"), item("b", "done")]))).toBe("done");
	expect(groupStatus(group("t", []))).toBe("pending"); // empty is never "done"
});

test("groupProgress counts done/total for the header badge", () => {
	expect(groupProgress(group("t", [item("a", "done"), item("b", "in_progress")]))).toEqual({
		done: 1,
		total: 2,
	});
});

test("planSummary spans loose + groups and surfaces the current step", () => {
	const summary = planSummary({
		todos: [item("loose", "done")],
		groups: [group("t", [item("a", "in_progress"), item("b")])],
	});
	expect(summary).toMatchObject({ done: 1, total: 3 });
	expect(summary.current?.title).toBe("a");
});

const asked = (answered: boolean, superseded = false): AskState => ({
	...(answered ? { answer: { answers: [], cancelled: false } } : {}),
	superseded,
});

test("planGlance: streaming wins; an awaiting question beats plain waiting", () => {
	expect(planGlance(true, {})).toBe("working");
	expect(planGlance(true, { q1: asked(false) })).toBe("working");
	expect(planGlance(false, {})).toBe("waiting");
	expect(planGlance(false, { q1: asked(false) })).toBe("waiting_question");
	expect(planGlance(false, { q1: asked(true) })).toBe("waiting");
	expect(planGlance(false, { q1: asked(false, true) })).toBe("waiting"); // superseded ≠ awaiting
});

test("shouldNudgeOnAdd: never wake an agent waiting on a question; wake it otherwise", () => {
	expect(shouldNudgeOnAdd("waiting_question")).toBe(false);
	expect(shouldNudgeOnAdd("working")).toBe(true);
	expect(shouldNudgeOnAdd("waiting")).toBe(true);
});

test("sessionGlance derives the glance straight from a runtime (deriveAskStates + planGlance)", () => {
	const askTurn: ChatTurn = {
		kind: "assistant",
		id: "a1",
		streaming: false,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "q1", name: "ask_user_question", arguments: {} }],
		} as unknown as AssistantMessage,
	};
	expect(sessionGlance({ isStreaming: true, turns: [askTurn], askAnswers: {} })).toBe("working");
	expect(sessionGlance({ isStreaming: false, turns: [askTurn], askAnswers: {} })).toBe(
		"waiting_question",
	);
	expect(sessionGlance({ isStreaming: false, turns: [], askAnswers: {} })).toBe("waiting");
});
