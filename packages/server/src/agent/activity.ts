import type { ActivityStatus, AgentMessage, AgentSettlement } from "@thinkrail/contracts";
import { awaitingQuestionToolCallId } from "./askUserQuestion";

export interface ActivityInputs {
	isStreaming: boolean;
	pendingMessageCount: number;
	messages: readonly AgentMessage[];
	lastSettlement: AgentSettlement | null | undefined;
	hasPendingDialog: boolean;
}

const FAILED_STOP_REASONS: ReadonlySet<string> = new Set(["error", "length"]);

interface AssistantView {
	role?: string;
	stopReason?: string;
}

function failedStopReason(stopReason: string | undefined): boolean {
	return stopReason !== undefined && FAILED_STOP_REASONS.has(stopReason);
}

function trailingAssistantFailed(messages: readonly AgentMessage[]): boolean {
	const views = messages as readonly AssistantView[];
	for (let i = views.length - 1; i >= 0; i--) {
		const view = views[i];
		if (!view) continue;
		if (view.role === "user") return false;
		if (view.role === "assistant") return failedStopReason(view.stopReason);
	}
	return false;
}

function failed(inputs: ActivityInputs): boolean {
	if (inputs.lastSettlement !== undefined)
		return failedStopReason(inputs.lastSettlement?.stopReason);
	return trailingAssistantFailed(inputs.messages);
}

export function deriveActivityStatus(inputs: ActivityInputs): ActivityStatus | null {
	if (inputs.hasPendingDialog) return "waiting";
	if (inputs.isStreaming) return "running";
	if (inputs.pendingMessageCount > 0) return "queued";
	if (awaitingQuestionToolCallId(inputs.messages) !== null) return "waiting";
	return failed(inputs) ? "failed" : null;
}
