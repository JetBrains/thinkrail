import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentSettlement, PiEvent } from "@thinkrail/contracts";

export function projectSessionEvent(
	event: AgentSessionEvent,
	terminal: AgentSettlement | null,
): PiEvent {
	if (event.type === "agent_settled") return { type: "agent_settled", terminal };
	if (event.type === "compaction_end") {
		return {
			type: "compaction_end",
			reason: event.reason,
			result: event.result
				? {
						tokensBefore: event.result.tokensBefore,
						...(event.result.estimatedTokensAfter !== undefined
							? { estimatedTokensAfter: event.result.estimatedTokensAfter }
							: {}),
					}
				: undefined,
			aborted: event.aborted,
			willRetry: event.willRetry,
			...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}),
		};
	}
	if (event.type === "tool_execution_end")
		return { ...event, result: withoutStructured(event.result) };
	if (event.type === "tool_execution_update") {
		return { ...event, partialResult: withoutStructured(event.partialResult) };
	}
	return event as PiEvent;
}

function withoutStructured(result: unknown): unknown {
	if (typeof result !== "object" || result === null || !("structuredContent" in result))
		return result;
	const { structuredContent: _structuredContent, ...rest } = result;
	return rest;
}
