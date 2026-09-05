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

export const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
export const TRANSCRIPT_TAIL_MAX_BYTES = 8 * 1024 * 1024;

export function parseTranscriptTail(text: string, partialFirstLine: boolean): AgentMessage[] {
	const lines = text.split("\n");
	if (partialFirstLine) lines.shift();
	const messages: AgentMessage[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		if (Reflect.get(entry, "type") !== "message") continue;
		const message = Reflect.get(entry, "message");
		if (typeof message === "object" && message !== null) messages.push(message as AgentMessage);
	}
	return messages;
}

export function deriveDiskActivityStatus(messages: readonly AgentMessage[]): ActivityStatus | null {
	return deriveActivityStatus({
		isStreaming: false,
		pendingMessageCount: 0,
		hasPendingDialog: false,
		lastSettlement: undefined,
		messages,
	});
}
