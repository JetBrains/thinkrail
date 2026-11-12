import {
	assistantToolCallsAreExecutable,
	isToolResponsePending,
	type SessionState,
} from "@thinkrail/contracts";
import type { ToolStatus } from "@thinkrail/extension-api/web";
import { createContext, useContext } from "react";
import { isDockedTool, isInteractiveTool } from "./toolRegistry";
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

export interface PendingInteraction {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: ToolStatus;
	streaming: boolean;
}

export function latestPendingInteraction(
	turns: ChatTurn[],
	toolResults: Record<string, ToolResultState>,
	states: Record<string, InteractionState>,
): PendingInteraction | undefined {
	let found: PendingInteraction | undefined;
	for (const turn of turns) {
		if (turn.kind !== "assistant") continue;
		for (const block of turn.message.content) {
			if (block.type !== "toolCall" || !isInteractiveTool(block.name)) continue;
			const state = states[block.id];
			if (!state || state.response !== undefined || state.superseded || state.terminal) continue;
			const tool = toolResults[block.id];
			found = {
				toolCallId: block.id,
				toolName: block.name,
				args: block.arguments ?? {},
				result: tool?.raw,
				status: tool?.status ?? "running",
				streaming: turn.streaming,
			};
		}
	}
	return found;
}

export function dockedInteraction(
	pending: PendingInteraction | undefined,
	awaitingToolCallId: string | null | undefined,
): PendingInteraction | undefined {
	if (!pending || pending.streaming || !isDockedTool(pending.toolName)) return undefined;
	return awaitingToolCallId === undefined || awaitingToolCallId === pending.toolCallId
		? pending
		: undefined;
}

export interface InteractionContextValue {
	states: Record<string, InteractionState>;
	focusScope: object;
	awaitingToolCallId?: string | null | undefined;
	dockedToolCallId?: string | undefined;
}

const LEGACY_QUESTION_PREFIX = "question:";

export function awaitingToolCallIdOf(hostState: SessionState | null): string | null | undefined {
	if (!hostState) return undefined;
	const needsInput = hostState.needsInput;
	if (!needsInput) return null;
	if (needsInput.kind === "tool-response") return needsInput.toolCallId;
	const legacy = needsInput as { kind: string; interactionId: string };
	return legacy.kind === "question" && legacy.interactionId.startsWith(LEGACY_QUESTION_PREFIX)
		? legacy.interactionId.slice(LEGACY_QUESTION_PREFIX.length)
		: null;
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

export function useInteractionDocked(toolCallId: string): boolean {
	return useContext(InteractionStatesContext)?.dockedToolCallId === toolCallId;
}
