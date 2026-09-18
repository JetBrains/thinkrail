import { type AskUserQuestionResult, assistantToolCallsAreExecutable } from "@thinkrail/contracts";
import { createContext, useContext } from "react";
import type { ChatTurn, ToolResultState } from "./types";

export interface AskState {
	answer?: AskUserQuestionResult;
	superseded: boolean;
	terminal: boolean;
}

export function readAskResult(raw: unknown): AskUserQuestionResult | null {
	const isResult = (value: unknown): value is AskUserQuestionResult =>
		!!value &&
		typeof value === "object" &&
		Array.isArray((value as AskUserQuestionResult).answers) &&
		typeof (value as AskUserQuestionResult).cancelled === "boolean";
	if (raw && typeof raw === "object" && isResult((raw as { details?: unknown }).details)) {
		return (raw as { details: AskUserQuestionResult }).details;
	}
	return isResult(raw) ? raw : null;
}

function isAckResult(raw: unknown): boolean {
	return (
		!!raw &&
		typeof raw === "object" &&
		Reflect.get(Reflect.get(raw, "details") ?? {}, "kind") === "ack"
	);
}

export function deriveAskStates(
	turns: ChatTurn[],
	askAnswers: Record<string, AskUserQuestionResult>,
	toolResults: Record<string, ToolResultState> = {},
): Record<string, AskState> {
	const calls: Record<string, { turnIndex: number; dead: boolean }> = {};
	let lastUserIndex = -1;
	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "user") {
			lastUserIndex = i;
		} else if (turn.kind === "assistant") {
			for (const block of turn.message.content) {
				if (block.type === "toolCall" && block.name === "ask_user_question") {
					calls[block.id] = {
						turnIndex: i,
						dead: !assistantToolCallsAreExecutable(turn.message.stopReason),
					};
				}
			}
		}
	}
	const states: Record<string, AskState> = {};
	for (const [toolCallId, call] of Object.entries(calls)) {
		const tool = toolResults[toolCallId];
		const answer = askAnswers[toolCallId] ?? readAskResult(tool?.raw) ?? undefined;
		const terminal =
			call.dead ||
			tool?.status === "error" ||
			(tool?.status === "done" && answer === undefined && !isAckResult(tool.raw));
		states[toolCallId] = {
			...(answer ? { answer } : {}),
			superseded: !answer && !terminal && lastUserIndex > call.turnIndex,
			terminal,
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
