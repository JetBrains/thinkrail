import type {
	AgentSettlement,
	AskUserAnswersDetails,
	TranscriptMessage,
} from "@thinkrail/contracts";
import { isAskUserAnswersMessage, isControlMessage, isRetriedAttempt } from "@thinkrail/contracts";
import { userText } from "../lib";
import { assistantFailureText } from "./assistantFailure";
import type { ChatTurn, ToolResultState } from "./types";

/** The runtime slice a transcript hydrates: what `hydrateSession` seeds a fresh `SessionRuntime` with. */
export interface HydratedRuntime {
	turns: ChatTurn[];
	toolResults: Record<string, ToolResultState>;
	/** `ask_user_question` replies keyed by tool call id (from `ask-user-answers` custom messages). */
	askAnswers: Record<string, AskUserAnswersDetails["result"]>;
	/**
	 * Parallel to `messages`: `turnIdByMessageIndex[i]` is the turn id minted for `messages[i]` (`null` for
	 * a `toolResult`/`custom` message, which never becomes its own turn, and for a `compactionSummary`,
	 * which becomes a visible turn but is never a search hit) — the jump anchor map a
	 * history-search "jump to message" deep link (`chatLocationRequest`) resolves against. A message that
	 * ended in `stopReason: "error"` maps to its own assistant turn's id, never the synthesized error
	 * turn's (the error turn has no message index of its own). A retried (superseded) failed attempt
	 * renders no turn at all, so its slot is `null` like a control message's.
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
export function messagesToRuntime(
	messages: TranscriptMessage[],
	lastSettlement?: AgentSettlement | null,
): HydratedRuntime {
	const turns: ChatTurn[] = [];
	const toolResults: Record<string, ToolResultState> = {};
	const askAnswers: HydratedRuntime["askAnswers"] = {};
	const turnIdByMessageIndex: HydratedRuntime["turnIdByMessageIndex"] = [];
	for (const [index, message] of messages.entries()) {
		// Exactly one push per message, in order — keeps the map aligned to `messages` regardless of which
		// branch below fires (a user/assistant message sets it to its own turn's id; every other message
		// leaves it `null`).
		let turnId: string | null = null;
		if (message.role === "user") {
			// A pi-todos hidden nudge renders no turn, but still consumes its positional slot below
			// (turnId stays null) so turnIdByMessageIndex stays aligned with the server's messageIndex.
			if (!isControlMessage(userText(message.content))) {
				turnId = crypto.randomUUID();
				turns.push({ kind: "user", id: turnId, message });
			}
		} else if (message.role === "assistant") {
			if (isRetriedAttempt(messages, index)) {
				// A superseded auto-retry attempt: pi keeps it in the session file for history but removed it
				// from the live context (`_prepareRetry`), and the live reducer drops its turn on
				// `auto_retry_start`. Hide it here too — same presentation rule on both paths — or a reload
				// would resurrect the failed partial next to the retried reply (turnId stays null). Its
				// failure text never surfaces either: only the trailing terminal below reports a failure.
			} else {
				turnId = crypto.randomUUID();
				turns.push({ kind: "assistant", id: turnId, message, streaming: false });
			}
		} else if (message.role === "compactionSummary") {
			// Only successful compactions persist an entry. It becomes a visible done record, but no jump
			// anchor: history search indexes user/assistant text only, so this slot remains `null`.
			turns.push({
				kind: "compaction",
				id: crypto.randomUUID(),
				status: "done",
				summary: message.summary,
				tokensBefore: message.tokensBefore,
			});
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

	// A compacted transcript can retain old `length` attempts even though later work completed. Only the
	// latest settlement is a current failure; when the live host has not observed one, the last persisted
	// assistant is the best available terminal. The synthesized error has no transcript index of its own.
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
