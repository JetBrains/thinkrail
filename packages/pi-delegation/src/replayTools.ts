import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface ReplayToolCall {
	toolCallId: string;
	toolName: string;
}

export function scanReplayTools(messages: readonly AgentMessage[]): {
	issues: string[];
	danglingTail: ReplayToolCall[];
} {
	const issues: string[] = [];
	let danglingTail: ReplayToolCall[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (!message) continue;
		if (message.role === "toolResult") {
			issues.push(`Orphan tool result ${message.toolCallId}`);
			continue;
		}
		if (message.role !== "assistant") continue;
		if (message.stopReason === "error" || message.stopReason === "aborted") continue;
		const calls = message.content.filter((block) => block.type === "toolCall");
		const names = new Map(calls.map((call) => [call.id, call.name]));
		let malformed = names.size !== calls.length;
		const results = new Set<string>();
		while (messages[index + 1]?.role === "toolResult") {
			const result = messages[++index];
			if (result?.role !== "toolResult") break;
			if (results.has(result.toolCallId) || names.get(result.toolCallId) !== result.toolName) {
				malformed = true;
			}
			results.add(result.toolCallId);
		}
		if (malformed) issues.push("Duplicate or mismatched tool calls/results");
		const missing = calls
			.filter((call) => !results.has(call.id))
			.map((call) => ({
				toolCallId: call.id,
				toolName: call.name,
			}));
		if (missing.length)
			issues.push(`Missing tool results: ${missing.map((call) => call.toolCallId).join(", ")}`);
		if (index === messages.length - 1 && !malformed) danglingTail = missing;
	}
	return { issues, danglingTail };
}
