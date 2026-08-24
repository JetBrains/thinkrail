import type {
	AgentSettlement,
	AskUserAnswersDetails,
	TranscriptMessage,
} from "@thinkrail/contracts";
import { isAskUserAnswersMessage, isControlMessage, isRetriedAttempt } from "@thinkrail/contracts";
import { userText } from "../lib";
import { assistantFailureText } from "./assistantFailure";
import type { ChatTurn, ToolResultState } from "./types";

export interface HydratedRuntime {
	turns: ChatTurn[];
	toolResults: Record<string, ToolResultState>;
	askAnswers: Record<string, AskUserAnswersDetails["result"]>;
	turnIdByMessageIndex: (string | null)[];
}

export function messagesToRuntime(
	messages: TranscriptMessage[],
	lastSettlement?: AgentSettlement | null,
): HydratedRuntime {
	const turns: ChatTurn[] = [];
	const toolResults: Record<string, ToolResultState> = {};
	const askAnswers: HydratedRuntime["askAnswers"] = {};
	const turnIdByMessageIndex: HydratedRuntime["turnIdByMessageIndex"] = [];
	for (const [index, message] of messages.entries()) {
		let turnId: string | null = null;
		if (message.role === "user") {
			if (!isControlMessage(userText(message.content))) {
				turnId = crypto.randomUUID();
				turns.push({ kind: "user", id: turnId, message });
			}
		} else if (message.role === "assistant") {
			if (isRetriedAttempt(messages, index)) {
			} else {
				turnId = crypto.randomUUID();
				turns.push({ kind: "assistant", id: turnId, message, streaming: false });
			}
		} else if (message.role === "compactionSummary") {
			turns.push({
				kind: "compaction",
				id: crypto.randomUUID(),
				status: "done",
				summary: message.summary,
				tokensBefore: message.tokensBefore,
			});
		} else if (message.role === "toolResult") {
			toolResults[message.toolCallId] = {
				status: message.isError ? "error" : "done",
				raw: { content: message.content, details: message.details },
			};
		} else if (isAskUserAnswersMessage(message)) {
			askAnswers[message.details.toolCallId] = message.details.result;
		}
		turnIdByMessageIndex.push(turnId);
	}

	const lastConversationMessage = messages.findLast(
		(message) => message.role === "user" || message.role === "assistant",
	);
	const persistedTerminal =
		lastConversationMessage?.role === "assistant" ? lastConversationMessage : null;
	const failure = assistantFailureText(
		lastSettlement === undefined ? persistedTerminal : lastSettlement,
	);
	if (failure) turns.push({ kind: "error", id: crypto.randomUUID(), text: failure });

	return { turns, toolResults, askAnswers, turnIdByMessageIndex };
}
