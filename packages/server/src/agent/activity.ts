import type { ActivityStatus, AgentMessage, AgentSettlement } from "@thinkrail/contracts";
import { awaitingQuestionToolCallId } from "./askUserQuestion";

export interface ActivityInputs {
	isStreaming: boolean;
	pendingMessageCount: number;
	messages: readonly AgentMessage[];
	lastSettlement: AgentSettlement | null | undefined;
	hasPendingDialog: boolean;
}

export function deriveActivityStatus(inputs: ActivityInputs): ActivityStatus | null {
	if (inputs.hasPendingDialog) return "waiting";
	if (inputs.isStreaming) return "running";
	if (inputs.pendingMessageCount > 0) return "queued";
	if (awaitingQuestionToolCallId(inputs.messages) !== null) return "waiting";
	if (inputs.lastSettlement?.stopReason === "error") return "failed";
	return null;
}
