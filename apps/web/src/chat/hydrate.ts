import type { AgentSettlement, TranscriptMessage } from "@thinkrail/contracts";
import {
	customMessageText,
	isBackgroundCommandCompletionMessage,
	isChatHandoffMessage,
	isContinueInWorkspaceRequestMessage,
	isControlMessage,
	isRetriedAttempt,
	isSubagentCompletionMessage,
	isTodoReviewFixMessage,
	readToolResponseMessage,
} from "@thinkrail/contracts";
import { userText } from "../lib";
import { assistantFailure } from "./assistantFailure";
import { insertRoundCloser } from "./roundCloser";
import type { ChatTurn, ToolResultState } from "./types";

export interface HydratedRuntime {
	turns: ChatTurn[];
	toolResults: Record<string, ToolResultState>;
	toolResponses: Record<string, unknown>;
	turnIdByMessageIndex: (string | null)[];
}

export interface HydrationOptions {
	idScope?: string;
}

function transcriptTurnId(
	message: TranscriptMessage,
	index: number,
	options: HydrationOptions,
): string {
	return options.idScope
		? `${options.idScope}:${message.role}:${message.timestamp}:${index}`
		: crypto.randomUUID();
}

export function messagesToRuntime(
	messages: TranscriptMessage[],
	lastSettlement?: AgentSettlement | null,
	options: HydrationOptions = {},
): HydratedRuntime {
	const turns: ChatTurn[] = [];
	const toolResults: Record<string, ToolResultState> = {};
	const toolResponses: HydratedRuntime["toolResponses"] = {};
	const turnIdByMessageIndex: HydratedRuntime["turnIdByMessageIndex"] = [];
	for (const [index, message] of messages.entries()) {
		const toolResponse = readToolResponseMessage(message);
		let turnId: string | null = null;
		if (message.role === "user") {
			if (!isControlMessage(userText(message.content))) {
				turnId = transcriptTurnId(message, index, options);
				turns.push({ kind: "user", id: turnId, message });
			}
		} else if (message.role === "assistant") {
			if (isRetriedAttempt(messages, index)) {
			} else {
				turnId = transcriptTurnId(message, index, options);
				turns.push({ kind: "assistant", id: turnId, message, streaming: false });
			}
		} else if (message.role === "compactionSummary") {
			turns.push({
				kind: "compaction",
				id: transcriptTurnId(message, index, options),
				status: "done",
				summary: message.summary,
				tokensBefore: message.tokensBefore,
			});
		} else if (message.role === "toolResult") {
			toolResults[message.toolCallId] = {
				status: message.isError ? "error" : "done",
				raw: { content: message.content, details: message.details },
			};
		} else if (toolResponse) {
			toolResponses[toolResponse.toolCallId] = toolResponse.response;
		} else if (isBackgroundCommandCompletionMessage(message)) {
			turnId = transcriptTurnId(message, index, options);
			turns.push({
				kind: "backgroundCommandCompletion",
				id: turnId,
				details: message.details,
				timestamp: message.timestamp,
			});
		} else if (isSubagentCompletionMessage(message)) {
			turnId = transcriptTurnId(message, index, options);
			turns.push({
				kind: "subagentCompletion",
				id: turnId,
				details: message.details,
				text: customMessageText(message.content),
				timestamp: message.timestamp,
			});
		} else if (isTodoReviewFixMessage(message)) {
			turnId = transcriptTurnId(message, index, options);
			turns.push({
				kind: "reviewFix",
				id: turnId,
				details: message.details,
				text: customMessageText(message.content),
				timestamp: message.timestamp,
			});
		} else if (isContinueInWorkspaceRequestMessage(message)) {
			turnId = transcriptTurnId(message, index, options);
			turns.push({
				kind: "continuationRequest",
				id: turnId,
				details: message.details,
				timestamp: message.timestamp,
			});
		} else if (isChatHandoffMessage(message)) {
			turnId = transcriptTurnId(message, index, options);
			turns.push({
				kind: "handoff",
				id: turnId,
				details: message.details,
				timestamp: message.timestamp,
			});
		}
		turnIdByMessageIndex.push(turnId);
	}

	const lastConversationMessage = messages.findLast(
		(message) => message.role === "user" || message.role === "assistant",
	);
	const persistedTerminal =
		lastConversationMessage?.role === "assistant" ? lastConversationMessage : null;
	const failure = assistantFailure(
		lastSettlement === undefined ? persistedTerminal : lastSettlement,
	);
	const closed = failure
		? insertRoundCloser(turns, {
				kind: "error",
				id: options.idScope
					? `${options.idScope}:error:${persistedTerminal?.timestamp ?? "settlement"}`
					: crypto.randomUUID(),
				text: failure.message,
				failure: failure.failure,
				recovery: "try-again",
			})
		: turns;

	return { turns: closed, toolResults, toolResponses, turnIdByMessageIndex };
}
