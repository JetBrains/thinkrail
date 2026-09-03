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
	const trailingResults = new Map<string, string>();
	let repeatedTrailingResult = false;
	let dangling: RepairedToolCall[] = [];

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message) continue;
		if (message.role === "toolResult") {
			if (trailingResults.has(message.toolCallId)) repeatedTrailingResult = true;
			trailingResults.set(message.toolCallId, message.toolName);
			continue;
		}
		if (message.role !== "assistant") break;
		if (message.stopReason === "error" || message.stopReason === "aborted") break;
		const toolCalls = message.content.filter((block) => block.type === "toolCall");
		const toolCallNames = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall.name]));
		if (
			!repeatedTrailingResult &&
			toolCallNames.size === toolCalls.length &&
			[...trailingResults].every(
				([toolCallId, toolName]) => toolCallNames.get(toolCallId) === toolName,
			)
		) {
			dangling = toolCalls
				.filter((toolCall) => !trailingResults.has(toolCall.id))
				.map((toolCall) => ({ toolCallId: toolCall.id, toolName: toolCall.name }));
		}
		break;
	}

	for (const toolCall of dangling) {
		const isAsk = toolCall.toolName === ASK_USER_QUESTION_TOOL_NAME;
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			content: [{ type: "text", text: isAsk ? ASK_REPAIR_TEXT : GENERIC_REPAIR_TEXT }],
			isError: !isAsk,
			...(isAsk ? { details: { answers: [], cancelled: true } } : {}),
			timestamp: Date.now(),
		});
	}
	return dangling;
}
