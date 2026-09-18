import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { assistantToolCallsAreExecutable } from "@thinkrail/contracts";
import { ASK_ACK_TEXT, ASK_USER_QUESTION_TOOL_NAME } from "./askUserQuestion";

export interface RepairedToolCall {
	toolCallId: string;
	toolName: string;
}

const GENERIC_REPAIR_TEXT =
	"Operation aborted (the host restarted before this tool call completed)";
const TRUNCATED_REPAIR_TEXT =
	"Tool call was not executed because the response hit the output token limit and its arguments may be truncated.";

export function repairDanglingToolCalls(sessionManager: SessionManager): RepairedToolCall[] {
	const { messages } = sessionManager.buildSessionContext();
	const trailingResults = new Map<string, string>();
	let repeatedTrailingResult = false;
	let dangling: RepairedToolCall[] = [];
	let danglingCallsAreExecutable = false;

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
		danglingCallsAreExecutable = assistantToolCallsAreExecutable(message.stopReason);
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
		const isAnswerableAsk =
			danglingCallsAreExecutable && toolCall.toolName === ASK_USER_QUESTION_TOOL_NAME;
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			content: [
				{
					type: "text",
					text: isAnswerableAsk
						? ASK_ACK_TEXT
						: danglingCallsAreExecutable
							? GENERIC_REPAIR_TEXT
							: TRUNCATED_REPAIR_TEXT,
				},
			],
			isError: !isAnswerableAsk,
			...(isAnswerableAsk ? { details: { kind: "ack" } } : {}),
			timestamp: Date.now(),
		});
	}
	return dangling;
}
