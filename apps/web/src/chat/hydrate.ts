import type { AskUserAnswersDetails, TranscriptMessage, UserMessage } from "@thinkrail/contracts";
import { isAskUserAnswersMessage } from "@thinkrail/contracts";
import type { ChatTurn, ToolResultState } from "./types";

/** Prefix on the wake-the-agent nudge sent when a TODO is added; hidden from the transcript (never appended live, skipped on hydrate). */
export const TODO_NUDGE_PREFIX = "[thinkrail:todo-nudge] ";

/** The leading text of a user message (string or text blocks). */
function userText(content: UserMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("");
}

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
			if (userText(message.content).startsWith(TODO_NUDGE_PREFIX)) continue; // hidden nudge
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
		} else if (isAskUserAnswersMessage(message)) {
			// The shared guard validates the details shape (not just the tag) — a malformed reply is ignored.
			askAnswers[message.details.toolCallId] = message.details.result;
		}
	}
	return { turns, toolResults, askAnswers };
}
