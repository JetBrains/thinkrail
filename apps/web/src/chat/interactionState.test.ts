import { beforeAll, expect, test } from "bun:test";
import type { AssistantMessage, SessionState, UserMessage } from "@thinkrail/contracts";
import { awaitingToolCallIdOf, deriveInteractionStates } from "./interactionState";
import { registerToolRenderer } from "./toolRegistry";
import type { ChatTurn } from "./types";

// Interactive calls are registry-driven: a tool is interactive only when its web renderer registered as
// such. Stand in for the real ask-user-question card with an inert renderer; a second, plain registration
// proves that "registered" alone is not enough.
beforeAll(() => {
	registerToolRenderer("ask_user_question", () => null, { interactive: true });
	registerToolRenderer("plain_registered_tool", () => null);
});

const callTurn = (
	id: string,
	toolCallId: string,
	toolName: string,
	stopReason = "toolUse",
): ChatTurn => ({
	kind: "assistant",
	id,
	streaming: false,
	message: {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: {} }],
		stopReason,
	} as unknown as AssistantMessage,
});

const askTurn = (id: string, toolCallId: string, stopReason = "toolUse"): ChatTurn =>
	callTurn(id, toolCallId, "ask_user_question", stopReason);

const userTurn = (id: string): ChatTurn => ({
	kind: "user",
	id,
	message: { role: "user", content: "hi", timestamp: 0 } as UserMessage,
});

const reply = { answers: [], cancelled: false };

test("an interactive call with neither response nor later user turn is awaiting", () => {
	const states = deriveInteractionStates([userTurn("u1"), askTurn("a1", "tc1")], {});
	expect(states.tc1).toEqual({ superseded: false, terminal: false });
});

test("an indexed response marks the call responded (never superseded, even with a later user turn)", () => {
	const states = deriveInteractionStates([askTurn("a1", "tc1"), userTurn("u2")], { tc1: reply });
	expect(states.tc1).toEqual({ response: reply, superseded: false, terminal: false });
});

test("a user turn AFTER an unresponded call supersedes it; one before does not", () => {
	const states = deriveInteractionStates(
		[userTurn("u1"), askTurn("a1", "tc1"), userTurn("u2"), askTurn("a2", "tc2")],
		{},
	);
	expect(states.tc1).toEqual({ superseded: true, terminal: false });
	expect(states.tc2).toEqual({ superseded: false, terminal: false });
});

test("an interactive call in a non-executable assistant is terminal without a tool result", () => {
	for (const stopReason of ["error", "aborted", "length"]) {
		expect(deriveInteractionStates([askTurn("a1", "tc1", stopReason)], {}).tc1).toEqual({
			superseded: false,
			terminal: true,
		});
	}
});

test("native live results and stopped errors make the call terminal; the host's ack keeps it awaiting", () => {
	const turns = [askTurn("a1", "tc1")];
	expect(
		deriveInteractionStates(turns, {}, { tc1: { status: "done", raw: { details: reply } } }).tc1,
	).toEqual({ response: reply, superseded: false, terminal: false });
	expect(
		deriveInteractionStates(turns, {}, { tc1: { status: "error", raw: { details: {} } } }).tc1,
	).toEqual({ superseded: false, terminal: true });
	expect(
		deriveInteractionStates(
			turns,
			{},
			{ tc1: { status: "done", raw: { details: { kind: "ack" } } } },
		).tc1,
	).toEqual({ superseded: false, terminal: false });
	// A done result with no details at all is a native completion we cannot read a response from.
	expect(deriveInteractionStates(turns, {}, { tc1: { status: "done", raw: {} } }).tc1).toEqual({
		superseded: false,
		terminal: true,
	});
});

test("an indexed response wins over the tool result's details", () => {
	const states = deriveInteractionStates(
		[askTurn("a1", "tc1")],
		{ tc1: reply },
		{
			tc1: { status: "done", raw: { details: { kind: "ack" } } },
		},
	);
	expect(states.tc1).toEqual({ response: reply, superseded: false, terminal: false });
});

test("the response value is opaque — any shape the tool's extension chose is carried through", () => {
	const states = deriveInteractionStates([askTurn("a1", "tc1")], { tc1: "free text" });
	expect(states.tc1).toEqual({ response: "free text", superseded: false, terminal: false });
});

test("tool calls that are not registered interactive derive no state", () => {
	const turns: ChatTurn[] = [
		callTurn("a1", "b1", "bash"),
		callTurn("a2", "p1", "plain_registered_tool"),
		callTurn("a3", "n1", "never_registered"),
	];
	expect(Object.keys(deriveInteractionStates(turns, {}))).toHaveLength(0);
	// Even an indexed response for such a call yields nothing — the registry decides what is interactive.
	expect(Object.keys(deriveInteractionStates(turns, { p1: reply }))).toHaveLength(0);
});

test("the host's needs-input names the one tool call it accepts a response for", () => {
	const state = (needsInput: SessionState["needsInput"]) =>
		({ needsInput }) as unknown as SessionState;
	expect(awaitingToolCallIdOf(null)).toBeUndefined();
	expect(awaitingToolCallIdOf(state(null))).toBeNull();
	expect(
		awaitingToolCallIdOf(
			state({ interactionId: "tool:call-1", kind: "tool-response", toolCallId: "call-1" }),
		),
	).toBe("call-1");
	expect(
		awaitingToolCallIdOf(
			state({
				interactionId: "dialog:d1",
				kind: "dialog",
				request: { id: "d1", sessionId: "s", kind: "confirm", title: "t", message: "m" },
			}),
		),
	).toBeNull();
});
