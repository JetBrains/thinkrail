import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	type AgentMessage,
	type AgentSettlement,
	CHAT_HANDOFF_CUSTOM_TYPE,
	type ExtUiRequest,
	type SessionCompletion,
	type SessionState,
} from "@thinkrail/contracts";
import type { InteractiveTools } from "../extensions";
import { awaitingToolCallId } from "./toolResponses";

export interface LiveInteractionState {
	toolCallId: string;
	needsInput: boolean;
}

export interface SessionStateInputs {
	entries: readonly SessionEntry[];
	isStreaming: boolean;
	pendingMessageCount: number;
	backgroundWorkActive: boolean;
	lastSettlement: AgentSettlement | null | undefined;
	lifecycleCompletion: { runId: string; completion: SessionCompletion } | null | undefined;
	liveInteraction: LiveInteractionState | null;
	liveRegistry: boolean;
	interactiveTools: InteractiveTools;
	pendingDialog: Extract<ExtUiRequest, { kind: "select" | "confirm" | "input" | "editor" }> | null;
	handledCompletionId: string | undefined;
	cancelledRunId: string | undefined;
}

interface MessageView {
	role?: string;
	stopReason?: string;
}

type MessageEntry = Extract<SessionEntry, { type: "message" }>;

function customMessage(entry: Extract<SessionEntry, { type: "custom_message" }>): AgentMessage {
	return {
		role: "custom",
		customType: entry.customType,
		content: entry.content,
		display: entry.display,
		...(entry.details !== undefined ? { details: entry.details } : {}),
		timestamp: Date.parse(entry.timestamp),
	} as AgentMessage;
}

export function sessionStateMessages(entries: readonly SessionEntry[]): AgentMessage[] {
	return entries.flatMap((entry) => {
		if (entry.type === "message") return [entry.message];
		if (entry.type === "custom_message") return [customMessage(entry)];
		return [];
	});
}

/** Host messages that open a run as a user prompt does: a continued chat's first turn answers its handoff. */
const RUN_OPENING_CUSTOM_TYPES: ReadonlySet<string> = new Set([CHAT_HANDOFF_CUSTOM_TYPE]);

function opensRun(entry: SessionEntry | undefined): entry is SessionEntry {
	if (entry?.type === "message") return (entry.message as MessageView).role === "user";
	return entry?.type === "custom_message" && RUN_OPENING_CUSTOM_TYPES.has(entry.customType);
}

function latestRunStart(
	entries: readonly SessionEntry[],
): { entry: SessionEntry; index: number } | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (opensRun(entry)) return { entry, index };
	}
	return null;
}

function latestAssistant(
	entries: readonly SessionEntry[],
	after: number,
): { entry: MessageEntry; index: number } | null {
	for (let index = entries.length - 1; index > after; index--) {
		const entry = entries[index];
		if (entry?.type === "message" && (entry.message as MessageView).role === "assistant") {
			return { entry, index };
		}
	}
	return null;
}

function latestConversationRole(entries: readonly SessionEntry[], after: number): string | null {
	for (let index = entries.length - 1; index > after; index--) {
		const entry = entries[index];
		if (entry?.type === "custom_message") return "custom";
		if (entry?.type === "message") return (entry.message as MessageView).role ?? null;
	}
	return null;
}

function completionFrom(
	completionId: string,
	stopReason: string | undefined,
	cancelled: boolean,
): SessionCompletion {
	if (cancelled) return { completionId, outcome: "cancelled" };
	if (stopReason === "error") return { completionId, outcome: "failed", failure: "error" };
	if (stopReason === "length") return { completionId, outcome: "failed", failure: "length" };
	if (stopReason === "aborted" || stopReason === undefined) {
		return { completionId, outcome: "interrupted" };
	}
	return { completionId, outcome: "succeeded" };
}

function deriveCompletion(
	inputs: SessionStateInputs,
	runId: string,
	turnIndex: number,
): SessionCompletion {
	const assistant = latestAssistant(inputs.entries, turnIndex);
	const cancelled = inputs.cancelledRunId === runId;
	if (inputs.lifecycleCompletion !== undefined) {
		if (inputs.lifecycleCompletion?.runId === runId) return inputs.lifecycleCompletion.completion;
		return completionFrom(`interrupted:${runId}`, undefined, cancelled);
	}
	if (inputs.lastSettlement !== undefined) {
		const completionId = assistant ? `completion:${assistant.entry.id}` : `interrupted:${runId}`;
		return completionFrom(completionId, inputs.lastSettlement?.stopReason, cancelled);
	}
	const terminalRole = latestConversationRole(inputs.entries, turnIndex);
	if (assistant && terminalRole === "assistant") {
		const stopReason = (assistant.entry.message as MessageView).stopReason;
		if (stopReason === "toolUse") {
			return completionFrom(`interrupted:${runId}`, undefined, cancelled);
		}
		return completionFrom(`completion:${assistant.entry.id}`, stopReason, cancelled);
	}
	return completionFrom(`interrupted:${runId}`, undefined, cancelled);
}

function toolResponseInput(toolCallId: string): SessionState["needsInput"] {
	return { interactionId: `tool:${toolCallId}`, kind: "tool-response", toolCallId };
}

export function deriveSessionState(inputs: SessionStateInputs): SessionState {
	const turn = latestRunStart(inputs.entries);
	const runId = turn?.entry.id ?? null;
	let needsInput: SessionState["needsInput"] = null;
	if (inputs.pendingDialog !== null) {
		needsInput = {
			interactionId: `dialog:${inputs.pendingDialog.id}`,
			kind: "dialog",
			request: inputs.pendingDialog,
		};
	} else if (inputs.liveInteraction?.needsInput) {
		needsInput = toolResponseInput(inputs.liveInteraction.toolCallId);
	} else if (inputs.liveInteraction === null) {
		const toolCallId = awaitingToolCallId(
			sessionStateMessages(inputs.entries),
			inputs.interactiveTools,
			inputs.liveRegistry,
		);
		if (toolCallId !== null) needsInput = toolResponseInput(toolCallId);
	}

	if (needsInput !== null || inputs.isStreaming) {
		return {
			execution: inputs.isStreaming ? "running" : "idle",
			runId,
			needsInput,
			completion: null,
			completionUnread: false,
			queuedCount: inputs.pendingMessageCount,
			backgroundWork: inputs.backgroundWorkActive,
		};
	}

	const completion = runId === null ? null : deriveCompletion(inputs, runId, turn?.index ?? -1);
	return {
		execution: "idle",
		runId,
		needsInput: null,
		completion,
		completionUnread:
			!inputs.backgroundWorkActive &&
			completion !== null &&
			completion.outcome !== "cancelled" &&
			completion.completionId !== inputs.handledCompletionId,
		queuedCount: inputs.pendingMessageCount,
		backgroundWork: inputs.backgroundWorkActive,
	};
}
