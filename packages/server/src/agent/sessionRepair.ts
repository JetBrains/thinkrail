import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { assistantToolCallsAreExecutable } from "@thinkrail/contracts";
import { scanReplayTools } from "pi-delegation";
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
	const { danglingTail: dangling } = scanReplayTools(messages);
	const assistant = messages.findLast((message) => message.role === "assistant");
	const danglingCallsAreExecutable =
		!!assistant && assistantToolCallsAreExecutable(assistant.stopReason);

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
