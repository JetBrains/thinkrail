import {
	type BackgroundCommandCompletionDetails,
	isDelegationRunDetails,
	type SubagentCompletionDetails,
} from "@thinkrail/contracts";
import { parseToolResultContent } from "@thinkrail/extension-api/web";
import type { ChatTurn, ToolResultState } from "./types";

export type PulledResult =
	| { kind: "subagentCompletion"; key: string; details: SubagentCompletionDetails; text: string }
	| {
			kind: "backgroundCommandCompletion";
			key: string;
			details: BackgroundCommandCompletionDetails;
	  };

const EXCERPT_CHARS = 4096;
const EXCERPT_LINES = 40;

export function resultKey(turn: ChatTurn): string | undefined {
	if (turn.kind === "subagentCompletion") return `subagent:${turn.details.childSessionId}`;
	if (turn.kind === "backgroundCommandCompletion") return `command:${turn.details.id}`;
	return undefined;
}

function excerpt(text: string): { text: string; truncated: boolean } {
	const lines = text.split("\n");
	let kept = lines.length > EXCERPT_LINES ? lines.slice(-EXCERPT_LINES).join("\n") : text;
	if (kept.length > EXCERPT_CHARS) kept = kept.slice(-EXCERPT_CHARS);
	return { text: kept, truncated: kept.length < text.length };
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function pulledCommand(raw: unknown): BackgroundCommandCompletionDetails | undefined {
	if (!raw || typeof raw !== "object" || !("details" in raw)) return undefined;
	const details = raw.details as
		| { snapshot?: Record<string, unknown>; output?: { text?: unknown; truncated?: unknown } }
		| undefined;
	const snapshot = details?.snapshot;
	const output = details?.output;
	if (!snapshot || !output || typeof output.text !== "string") return undefined;
	const { id, sessionId, name, status, startedAt, finishedAt, exitCode, errorMessage } = snapshot;
	if (typeof id !== "string" || typeof sessionId !== "string" || typeof name !== "string")
		return undefined;
	if (status !== "completed" && status !== "error" && status !== "stopped") return undefined;
	if (!finite(startedAt) || !finite(finishedAt)) return undefined;
	const shown = excerpt(output.text);
	const result: BackgroundCommandCompletionDetails = {
		id,
		sessionId,
		name,
		status,
		startedAt,
		finishedAt,
		output: { text: shown.text, truncated: output.truncated === true || shown.truncated },
		delivery: "run",
	};
	if (exitCode === null || finite(exitCode)) result.exitCode = exitCode;
	if (typeof errorMessage === "string") result.errorMessage = errorMessage;
	return result;
}

export function pulledResult(
	toolName: string,
	args: Record<string, unknown>,
	tool: ToolResultState | undefined,
): PulledResult | undefined {
	if (tool?.status !== "done") return undefined;
	if (toolName === "get_subagent_result") {
		const details =
			tool.raw && typeof tool.raw === "object" && "details" in tool.raw
				? tool.raw.details
				: undefined;
		if (!isDelegationRunDetails(details)) return undefined;
		if (details.status === "queued" || details.status === "running") return undefined;
		return {
			kind: "subagentCompletion",
			key: `subagent:${details.childSessionId}`,
			details: { ...details, delivery: "run" },
			text: parseToolResultContent(tool.raw).text,
		};
	}
	if (toolName === "background_command" && args.action === "output") {
		const details = pulledCommand(tool.raw);
		return details
			? { kind: "backgroundCommandCompletion", key: `command:${details.id}`, details }
			: undefined;
	}
	return undefined;
}
