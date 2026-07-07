import type { Message } from "@thinkrail/contracts";
import type { ChatTurn, ToolResultState } from "./types";

/**
 * Fold a session's pi-canonical transcript (`session.getMessages`) into the runtime shape the renderers
 * consume — the read-side counterpart of the event reducer, used to hydrate a chat on connect. pi
 * messages carry no stable id, so we mint one per turn; tool results are indexed by `toolCallId` (which
 * pairs with the `toolCall` block's `id` inside the assistant turn, exactly as in the live path).
 */
export function messagesToRuntime(messages: Message[]): {
	turns: ChatTurn[];
	toolResults: Record<string, ToolResultState>;
} {
	const turns: ChatTurn[] = [];
	const toolResults: Record<string, ToolResultState> = {};
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
			// same value whether streamed or hydrated (e.g. the `ask_user_question` card's structured answers
			// live in `details`, so they survive a reconnect).
			toolResults[message.toolCallId] = {
				status: message.isError ? "error" : "done",
				raw: { content: message.content, details: message.details },
			};
		}
	}
	return { turns, toolResults };
}
