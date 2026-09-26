import { expect, test } from "bun:test";
import type { AskUserQuestionResult, AssistantMessage, UserMessage } from "@thinkrail/contracts";
import { deriveAskStates } from "./askState";
import type { ChatTurn } from "./types";

const askTurn = (id: string, toolCallId: string, stopReason = "toolUse"): ChatTurn => ({
	kind: "assistant",
	id,
	streaming: false,
	message: {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: {} }],
		stopReason,
	} as unknown as AssistantMessage,
});

const userTurn = (id: string): ChatTurn => ({
	kind: "user",
	id,
	message: { role: "user", content: "hi", timestamp: 0 } as UserMessage,
});

const reply: AskUserQuestionResult = { answers: [], cancelled: false };

test("an ask call with neither reply nor later user turn is awaiting", () => {
	const states = deriveAskStates([userTurn("u1"), askTurn("a1", "tc1")], {});
	expect(states.tc1).toEqual({ superseded: false, terminal: false });
});

test("an indexed reply marks the call answered (never superseded, even with a later user turn)", () => {
	const states = deriveAskStates([askTurn("a1", "tc1"), userTurn("u2")], { tc1: reply });
	expect(states.tc1).toEqual({ answer: reply, superseded: false, terminal: false });
});

test("a user turn AFTER an unanswered call supersedes it; one before does not", () => {
	const states = deriveAskStates(
		[userTurn("u1"), askTurn("a1", "tc1"), userTurn("u2"), askTurn("a2", "tc2")],
		{},
	);
	expect(states.tc1).toEqual({ superseded: true, terminal: false });
	expect(states.tc2).toEqual({ superseded: false, terminal: false });
});

test("an ask in a non-executable assistant is terminal without a tool result", () => {
	for (const stopReason of ["error", "aborted", "length"]) {
		expect(deriveAskStates([askTurn("a1", "tc1", stopReason)], {}).tc1).toEqual({
			superseded: false,
			terminal: true,
		});
	}
});

test("native live results and stopped errors make the question terminal", () => {
	const turns = [askTurn("a1", "tc1")];
	expect(
		deriveAskStates(turns, {}, { tc1: { status: "done", raw: { details: reply } } }).tc1,
	).toEqual({ answer: reply, superseded: false, terminal: false });
	expect(
		deriveAskStates(turns, {}, { tc1: { status: "error", raw: { details: {} } } }).tc1,
	).toEqual({ superseded: false, terminal: true });
	expect(
		deriveAskStates(turns, {}, { tc1: { status: "done", raw: { details: { kind: "ack" } } } }).tc1,
	).toEqual({ superseded: false, terminal: false });
});

test("non-ask tool calls derive no state", () => {
	const turns: ChatTurn[] = [
		{
			kind: "assistant",
			id: "a1",
			streaming: false,
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "b1", name: "bash", arguments: {} }],
			} as unknown as AssistantMessage,
		},
	];
	expect(Object.keys(deriveAskStates(turns, {}))).toHaveLength(0);
});
