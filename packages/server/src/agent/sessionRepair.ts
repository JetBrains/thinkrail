import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME, DECLINE_MESSAGE } from "./askUserQuestion";

export interface RepairedToolCall {
	toolCallId: string;
	toolName: string;
}

const ASK_REPAIR_TEXT = `${DECLINE_MESSAGE} (the host restarted before the user answered — ask again if still relevant)`;
const GENERIC_REPAIR_TEXT =
	"Operation aborted (the host restarted before this tool call completed)";

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
