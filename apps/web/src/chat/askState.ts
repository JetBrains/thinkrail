import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { createContext, useContext } from "react";
import type { ChatTurn } from "./types";

// The transcript-derived lifecycle of `ask_user_question` calls under the ack + terminate design: the
// tool resolves instantly (its result is just an ack), so "answered or still open?" is NOT a tool status —
// it's a fact about the conversation that follows the call. This module derives that fact once per
// runtime snapshot; the questionnaire card consumes it via context (`ChatView` provides it), staying
// store/transport-free like the other renderers.

/** One questionnaire's transcript-derived state (see {@link deriveAskStates}). */
export interface AskState {
	/** The structured reply, when an `ask-user-answers` message for this call exists. */
	answer?: AskUserQuestionResult;
	/**
	 * The user sent a free-form message after the questionnaire instead of answering it — the model was
	 * told to treat that message as the reply, so the card is terminal (not answerable). Mirrors the
	 * host-side verdict (`assessAnswerability`), which rejects answers to superseded calls.
	 */
	superseded: boolean;
}

/**
 * Derive every `ask_user_question` call's state from the transcript: `answer` from the indexed
 * `ask-user-answers` replies, `superseded` when a user turn follows the call without one. An answered
 * call is never superseded (the reply exists — render it), and a call with neither is "awaiting":
 * answerable now, after a reconnect, or after any number of host restarts. Pure.
 */
export function deriveAskStates(
	turns: ChatTurn[],
	askAnswers: Record<string, AskUserQuestionResult>,
): Record<string, AskState> {
	const callTurnIndex: Record<string, number> = {};
	let lastUserIndex = -1;
	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "user") {
			lastUserIndex = i;
		} else if (turn.kind === "assistant") {
			for (const block of turn.message.content) {
				if (block.type === "toolCall" && block.name === "ask_user_question")
					callTurnIndex[block.id] = i;
			}
		}
	}
	const states: Record<string, AskState> = {};
	for (const [toolCallId, turnIndex] of Object.entries(callTurnIndex)) {
		const answer = askAnswers[toolCallId];
		states[toolCallId] = {
			...(answer ? { answer } : {}),
			superseded: !answer && lastUserIndex > turnIndex,
		};
	}
	return states;
}

/**
 * The per-chat ask states, provided by `ChatView` (derived from the session runtime). `null` when a
 * renderer is used without one (standalone/extracted) — the card then treats every call as awaiting.
 */
export const AskStatesContext = createContext<Record<string, AskState> | null>(null);

/** The transcript-derived state for one `ask_user_question` call, or `undefined` outside a provider. */
export function useAskState(toolCallId: string): AskState | undefined {
	return useContext(AskStatesContext)?.[toolCallId];
}
