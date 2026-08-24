import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { createContext, useContext } from "react";
import type { ChatTurn } from "./types";

export interface AskState {
	answer?: AskUserQuestionResult;
	superseded: boolean;
}

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

export interface AskContextValue {
	states: Record<string, AskState>;
	focusScope: object;
}

export const AskStatesContext = createContext<AskContextValue | null>(null);

export function useAskState(toolCallId: string): AskState | undefined {
	return useContext(AskStatesContext)?.states[toolCallId];
}

export function useAskFocusScope(): object | null {
	return useContext(AskStatesContext)?.focusScope ?? null;
}
