import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentSettlement, PiEvent } from "@thinkrail/contracts";

/** Project Pi's richer in-process events onto the versioned browser wire. */
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
	return event as PiEvent;
}
