import type { AskUserAnswersDetails, TranscriptMessage } from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import type { ChatTurn, ToolResultState } from "./types";

/** The runtime slice a transcript hydrates: what `hydrateSession` seeds a fresh `SessionRuntime` with. */
export interface HydratedRuntime {
	turns: ChatTurn[];
	toolResults: Record<string, ToolResultState>;
	/** `ask_user_question` replies keyed by tool call id (from `ask-user-answers` custom messages). */
	askAnswers: Record<string, AskUserAnswersDetails["result"]>;
}

/**
 * Fold a session's transcript (`session.getMessages`) into the runtime shape the renderers consume — the
 * read-side counterpart of the event reducer, used to hydrate a chat on connect. pi messages carry no
 * stable id, so we mint one per turn; tool results are indexed by `toolCallId` (which pairs with the
 * `toolCall` block's id inside an assistant turn, exactly as in the live path). `custom` messages never
 * become turns: the ones we know (`ask-user-answers`) index into `askAnswers` — the questionnaire card is
 * their rendering — and unknown customTypes are ignored.
 */
export function messagesToRuntime(messages: TranscriptMessage[]): HydratedRuntime {
	const turns: ChatTurn[] = [];
	const toolResults: Record<string, ToolResultState> = {};
	const askAnswers: HydratedRuntime["askAnswers"] = {};
	for (const message of messages) {
		if (message.role === "user") {
			turns.push({ kind: "user", id: crypto.randomUUID(), message });
		} else if (message.role === "assistant") {
			turns.push({ kind: "assistant", id: crypto.randomUUID(), message, streaming: false });
			// A persisted turn that ended in a provider/model error carries `stopReason: "error"` + the
			// provider's `errorMessage`. Re-surface it as an error turn so a reopened chat shows the failure,
			// matching the live path (the reducer's terminal-error `agent_end`).
			if (message.stopReason === "error") {
				turns.push({
					kind: "error",
					id: crypto.randomUUID(),
					text: message.errorMessage || "The agent run ended in an error.",
				});
			}
		} else if (message.role === "toolResult") {
			// Mirror the live `tool_execution_end` result shape (`{ content, details }`) so renderers read the
			// same value whether streamed or hydrated (e.g. the `ask_user_question` card reads its ack — or a
			// legacy blocking-era result — from `details`).
			toolResults[message.toolCallId] = {
				status: message.isError ? "error" : "done",
				raw: { content: message.content, details: message.details },
			};
		} else if (message.role === "custom" && message.customType === ASK_USER_ANSWERS_CUSTOM_TYPE) {
			const details = message.details as AskUserAnswersDetails | undefined;
			if (details?.toolCallId && details.result) askAnswers[details.toolCallId] = details.result;
		}
	}
	return { turns, toolResults, askAnswers };
}
