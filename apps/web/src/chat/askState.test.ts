import { expect, test } from "bun:test";
import type { AskUserQuestionResult, AssistantMessage, UserMessage } from "@thinkrail/contracts";
import { deriveAskStates } from "./askState";
import type { ChatTurn } from "./types";

// The transcript-derived questionnaire lifecycle (see askState.ts): answered when an ask-user-answers
// reply is indexed, superseded when a user turn follows an unanswered call, awaiting otherwise.

const askTurn = (id: string, toolCallId: string): ChatTurn => ({
	kind: "assistant",
	id,
	streaming: false,
	message: {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: {} }],
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
	expect(states.tc1).toEqual({ superseded: false });
});

test("an indexed reply marks the call answered (never superseded, even with a later user turn)", () => {
	const states = deriveAskStates([askTurn("a1", "tc1"), userTurn("u2")], { tc1: reply });
	expect(states.tc1).toEqual({ answer: reply, superseded: false });
});

test("a user turn AFTER an unanswered call supersedes it; one before does not", () => {
	const states = deriveAskStates(
		[userTurn("u1"), askTurn("a1", "tc1"), userTurn("u2"), askTurn("a2", "tc2")],
		{},
	);
	expect(states.tc1).toEqual({ superseded: true });
	expect(states.tc2).toEqual({ superseded: false }); // the later ask is still open
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
