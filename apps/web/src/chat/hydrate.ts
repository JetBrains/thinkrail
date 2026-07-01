import type { Message } from "@thinkrail-pi/contracts";
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
		} else if (message.role === "toolResult") {
			toolResults[message.toolCallId] = {
				status: message.isError ? "error" : "done",
				raw: message.content,
			};
		}
	}
	return { turns, toolResults };
}
