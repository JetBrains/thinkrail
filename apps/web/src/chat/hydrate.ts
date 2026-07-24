import type { AskUserAnswersDetails, TranscriptMessage, UserMessage } from "@thinkrail/contracts";
import { isAskUserAnswersMessage, TODO_NUDGE_PREFIX } from "@thinkrail/contracts";
import type { ChatTurn, ToolResultState } from "./types";

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
	/**
	 * Parallel to `messages`: `turnIdByMessageIndex[i]` is the turn id minted for `messages[i]` (`null` for
	 * a `toolResult`/`custom` message, which never becomes its own turn) — the jump anchor map a
	 * history-search "jump to message" deep link (`chatLocationRequest`) resolves against. A message that
	 * ended in `stopReason: "error"` maps to its own assistant turn's id, never the synthesized error
	 * turn's (the error turn has no message index of its own).
	 */
	turnIdByMessageIndex: (string | null)[];
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
	const turnIdByMessageIndex: HydratedRuntime["turnIdByMessageIndex"] = [];
	for (const message of messages) {
		// Exactly one push per message, in order — keeps the map aligned to `messages` regardless of which
		// branch below fires (a user/assistant message sets it to its own turn's id; every other message
		// leaves it `null`).
		let turnId: string | null = null;
		if (message.role === "user") {
			// A pi-todos hidden nudge renders no turn, but still consumes its positional slot below
			// (turnId stays null) so turnIdByMessageIndex stays aligned with the server's messageIndex.
			if (!userText(message.content).startsWith(TODO_NUDGE_PREFIX)) {
				turnId = crypto.randomUUID();
				turns.push({ kind: "user", id: turnId, message });
			}
		} else if (message.role === "assistant") {
			turnId = crypto.randomUUID();
			turns.push({ kind: "assistant", id: turnId, message, streaming: false });
			// A persisted turn that ended in a provider/model error carries `stopReason: "error"` + the
			// provider's `errorMessage`. Re-surface it as an error turn so a reopened chat shows the failure,
			// matching the live path (the reducer's terminal-error `agent_end`). `turnId` stays the
			// assistant message's own id — the error turn below is synthesized, not a message of its own.
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
		turnIdByMessageIndex.push(turnId);
	}
	return { turns, toolResults, askAnswers, turnIdByMessageIndex };
}
