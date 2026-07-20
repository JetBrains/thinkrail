// Restart repair for pi transcripts: a host death mid-turn (crash, kill, a shutdown that couldn't wait)
// leaves the persisted session ending in an assistant message whose `toolCall`s have no `toolResult` —
// and every LLM provider rejects a context with unpaired tool calls, so the next prompt would 400 and the
// chat would be bricked. `repairDanglingToolCalls` runs when a disk session is re-opened, BEFORE
// `createAgentSession` seeds its in-memory context (appending behind a live session would desync it): it
// pairs every orphaned call with a synthetic tool result, mirroring pi's own abort convention
// ("Operation aborted" error results). `ask_user_question` orphans — only possible in transcripts from
// the old blocking design, where the result was written at answer time — resolve as the canonical
// decline instead, with a re-ask hint, so the model gracefully re-asks rather than treating the
// questionnaire as failed.

import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME, DECLINE_MESSAGE } from "./askUserQuestion";

/** One repaired (orphaned) call, for logs/tests. */
export interface RepairedToolCall {
	toolCallId: string;
	toolName: string;
}

const ASK_REPAIR_TEXT = `${DECLINE_MESSAGE} (the host restarted before the user answered — ask again if still relevant)`;
const GENERIC_REPAIR_TEXT =
	"Operation aborted (the host restarted before this tool call completed)";

/**
 * Append a synthetic `toolResult` for every tool call on the session's current context path that has
 * none. The context path (`buildSessionContext`) is compaction-aware — a call summarized away no longer
 * reaches the provider, so only calls that would actually be sent get repaired. Orphans sit at the leaf
 * by construction (the loop appends results right after their call in normal operation), so appending at
 * the leaf pairs them where providers expect. Idempotent: a repaired call has a result and won't match
 * again. Returns the repaired calls (empty for the overwhelmingly common healthy transcript).
 */
export function repairDanglingToolCalls(sessionManager: SessionManager): RepairedToolCall[] {
	const { messages } = sessionManager.buildSessionContext();

	const resulted = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult") resulted.add(message.toolCallId);
	}

	const repaired: RepairedToolCall[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type !== "toolCall" || resulted.has(block.id)) continue;
			const isAsk = block.name === ASK_USER_QUESTION_TOOL_NAME;
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: block.id,
				toolName: block.name,
				content: [{ type: "text", text: isAsk ? ASK_REPAIR_TEXT : GENERIC_REPAIR_TEXT }],
				// The decline is a *valid* outcome the model was told to expect (isError would read as a tool
				// fault); an interrupted bash/web_search is an error, matching pi's abort convention.
				isError: !isAsk,
				...(isAsk ? { details: { answers: [], cancelled: true } } : {}),
				timestamp: Date.now(),
			});
			resulted.add(block.id);
			repaired.push({ toolCallId: block.id, toolName: block.name });
		}
	}
	return repaired;
}
