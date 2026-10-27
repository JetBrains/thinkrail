import {
	assistantToolCallsAreExecutable,
	isToolResponsePending,
	type SessionState,
} from "@thinkrail/contracts";
import { createContext, useContext } from "react";
import { isInteractiveTool } from "./toolRegistry";
import type { ChatTurn, ToolResultState } from "./types";

export interface InteractionState {
	response?: unknown;
	superseded: boolean;
	terminal: boolean;
}

function resultDetails(raw: unknown): unknown {
	return raw && typeof raw === "object" ? Reflect.get(raw, "details") : undefined;
}

export function deriveInteractionStates(
	turns: ChatTurn[],
	toolResponses: Record<string, unknown>,
	toolResults: Record<string, ToolResultState> = {},
): Record<string, InteractionState> {
	const calls: Record<string, { turnIndex: number; dead: boolean }> = {};
	let lastUserIndex = -1;
	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "user") {
			lastUserIndex = i;
		} else if (turn.kind === "assistant") {
			for (const block of turn.message.content) {
				if (block.type === "toolCall" && isInteractiveTool(block.name)) {
					calls[block.id] = {
						turnIndex: i,
						dead: !assistantToolCallsAreExecutable(turn.message.stopReason),
					};
				}
			}
		}
	}
	const states: Record<string, InteractionState> = {};
	for (const [toolCallId, call] of Object.entries(calls)) {
		const tool = toolResults[toolCallId];
		const details = tool?.status === "done" ? resultDetails(tool.raw) : undefined;
		const pending = isToolResponsePending(details);
		const response =
			toolCallId in toolResponses
				? toolResponses[toolCallId]
				: details !== undefined && !pending
					? details
					: undefined;
		const terminal =
			call.dead ||
			tool?.status === "error" ||
			(tool?.status === "done" && response === undefined && !pending);
		states[toolCallId] = {
			...(response !== undefined ? { response } : {}),
			superseded: response === undefined && !terminal && lastUserIndex > call.turnIndex,
			terminal,
		};
	}
	return states;
}

export interface InteractionContextValue {
	states: Record<string, InteractionState>;
	focusScope: object;
	awaitingToolCallId?: string | null | undefined;
}

export function awaitingToolCallIdOf(hostState: SessionState | null): string | null | undefined {
	if (!hostState) return undefined;
	const needsInput = hostState.needsInput;
	return needsInput?.kind === "tool-response" ? needsInput.toolCallId : null;
}

export function useInteractionAccepting(toolCallId: string): boolean {
	const awaiting = useContext(InteractionStatesContext)?.awaitingToolCallId;
	return awaiting === undefined || awaiting === toolCallId;
}

export const InteractionStatesContext = createContext<InteractionContextValue | null>(null);

export function useInteractionState(toolCallId: string): InteractionState | undefined {
	return useContext(InteractionStatesContext)?.states[toolCallId];
}

export function useInteractionFocusScope(): object | null {
	return useContext(InteractionStatesContext)?.focusScope ?? null;
}
