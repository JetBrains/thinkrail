import type { DelegationRunDetails, UserMessage } from "@thinkrail/contracts";
import type { ChatMessageOrder } from "./chatPreferences";
import { resolveProminence } from "./toolRegistry";
import { strArg } from "./tools/toolHelpers";
import type { ChatTurn, CompactionState, FailureRecovery, ToolResultState } from "./types";

export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	tool: ToolResultState | undefined;
	dead: boolean;
	streaming: boolean;
}

export type RoutineToolStep = { kind: "tool"; id: string } & ToolCallData;

export interface ThinkingStep {
	kind: "thinking";
	id: string;
	text: string;
	streaming: boolean;
	tools: RoutineToolStep[];
}

export type ActivityStep = RoutineToolStep | ThinkingStep;

export type ChatRow =
	| { kind: "user"; id: string; message: UserMessage; attachmentNames?: string[] }
	| { kind: "system"; id: string; text: string }
	| { kind: "error"; id: string; text: string; recovery?: FailureRecovery }
	| ({ kind: "compaction"; id: string } & CompactionState)
	| {
			kind: "retry";
			id: string;
			source: "turn" | "summarization";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
	  }
	| { kind: "markdown"; id: string; text: string }
	| { kind: "subagentCompletion"; id: string; details: DelegationRunDetails; text: string }
	| ({ kind: "tool"; id: string } & ToolCallData)
	| {
			kind: "activity";
			id: string;
			steps: ActivityStep[];
			live: boolean;
	  }
	| { kind: "divider"; id: string; data: TurnDividerData };

export function projectRows(rows: ChatRow[], messageOrder: ChatMessageOrder): ChatRow[] {
	if (messageOrder === "oldest-first" || rows.length < 2) return rows;
	const groups: ChatRow[][] = [];
	let group: ChatRow[] = [];
	for (const row of rows) {
		if (row.kind === "user" && group.length > 0) {
			groups.push(group);
			group = [];
		}
		group.push(row);
	}
	if (group.length > 0) groups.push(group);

	const projected: ChatRow[] = [];
	for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
		const current = groups[groupIndex];
		if (!current) continue;
		for (let rowIndex = current.length - 1; rowIndex >= 0; rowIndex -= 1) {
			const row = current[rowIndex];
			if (row) projected.push(row);
		}
	}
	return projected;
}

function nestRoutineRun(steps: ActivityStep[]): ActivityStep[] {
	const nested: ActivityStep[] = [];
	let currentThinking: ThinkingStep | undefined;
	for (const step of steps) {
		if (step.kind === "thinking") {
			currentThinking = { ...step, tools: [] };
			nested.push(currentThinking);
		} else if (currentThinking) {
			currentThinking.tools.push(step);
		} else {
			nested.push(step);
		}
	}
	return nested;
}

export function deriveRows(
	turns: ChatTurn[],
	toolResults: Record<string, ToolResultState>,
	isStreaming: boolean,
	isSpec?: (path: string) => boolean,
): ChatRow[] {
	const rows: ChatRow[] = [];
	let run: ActivityStep[] = [];

	const flushRun = (live = false) => {
		const first = run[0];
		if (!first) return;
		rows.push({ kind: "activity", id: `activity:${first.id}`, steps: nestRoutineRun(run), live });
		run = [];
	};

	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "assistant") {
			const { message } = turn;
			const dead = message.stopReason === "aborted" || message.stopReason === "error";
			for (let b = 0; b < message.content.length; b++) {
				const block = message.content[b];
				if (!block) continue;
				if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					run.push({
						kind: "thinking",
						id: `${turn.id}:thinking:${b}`,
						text: block.thinking,
						streaming: turn.streaming,
						tools: [],
					});
				} else if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					flushRun();
					rows.push({ kind: "markdown", id: `${turn.id}:text:${b}`, text: block.text });
				} else if (block.type === "toolCall") {
					const data: ToolCallData = {
						toolCallId: block.id,
						toolName: block.name,
						args: block.arguments,
						tool: toolResults[block.id],
						dead,
						streaming: turn.streaming,
					};
					if (resolveProminence(block.name).prominence === "primary") {
						flushRun();
						rows.push({ kind: "tool", id: block.id, ...data });
					} else {
						run.push({ kind: "tool", id: block.id, ...data });
					}
				}
			}
		} else {
			flushRun();
			switch (turn.kind) {
				case "user":
					rows.push({
						kind: "user",
						id: turn.id,
						message: turn.message,
						...(turn.attachmentNames ? { attachmentNames: turn.attachmentNames } : {}),
					});
					break;
				case "system":
					rows.push({ kind: "system", id: turn.id, text: turn.text });
					break;
				case "error":
					rows.push({
						kind: "error",
						id: turn.id,
						text: turn.text,
						...(turn.recovery ? { recovery: turn.recovery } : {}),
					});
					break;
				case "compaction":
					rows.push(turn);
					break;
				case "retry":
					rows.push({
						kind: "retry",
						id: turn.id,
						source: turn.source,
						attempt: turn.attempt,
						maxAttempts: turn.maxAttempts,
						delayMs: turn.delayMs,
					});
					break;
				case "subagentCompletion":
					rows.push({
						kind: "subagentCompletion",
						id: turn.id,
						details: turn.details,
						text: turn.text,
					});
					break;
			}
		}
		const roundEnded =
			turn.kind !== "user" &&
			(turns[i + 1]?.kind === "user" || (i === turns.length - 1 && !isStreaming));
		if (roundEnded) {
			flushRun();
			const data = turnDivider(turns, i, isSpec);
			if (data) rows.push({ kind: "divider", id: `${turn.id}:divider`, data });
		}
	}
	flushRun(isStreaming);
	return rows;
}

export interface TurnDividerData {
	elapsedMs: number | null;
	toolCount: number;
	specs: string[];
	changedFiles: string[];
}

const SPEC_WRITER_TOOL = "spec_create";

const FILE_WRITER_TOOLS = new Set(["write", "edit"]);

export function turnDivider(
	turns: ChatTurn[],
	endIndex: number,
	isSpec: (path: string) => boolean = () => false,
): TurnDividerData | null {
	let userIdx = -1;
	for (let i = endIndex; i >= 0; i--) {
		if (turns[i]?.kind === "user") {
			userIdx = i;
			break;
		}
	}
	if (userIdx < 0) return null;

	let toolCount = 0;
	const written = new Map<string, boolean>();
	let endMs: number | null = null;
	for (let i = userIdx + 1; i <= endIndex; i++) {
		const turn = turns[i];
		if (turn?.kind === "assistant") {
			if (turn.message.timestamp) endMs = turn.message.timestamp;
			for (const block of turn.message.content) {
				if (block.type !== "toolCall") continue;
				toolCount++;
				const specWrite = block.name === SPEC_WRITER_TOOL;
				if (!specWrite && !FILE_WRITER_TOOLS.has(block.name)) continue;
				const path = strArg(block.arguments, "path");
				if (!path) continue;
				if (specWrite || isSpec(path)) written.set(path, true);
				else if (!written.has(path)) written.set(path, false);
			}
		} else if (turn?.kind === "system" && turn.endedAt != null) {
			endMs = turn.endedAt;
		}
	}

	const user = turns[userIdx];
	const startMs = user?.kind === "user" ? user.message.timestamp : null;
	const elapsedMs = startMs != null && endMs != null ? endMs - startMs : null;

	const specs: string[] = [];
	const changedFiles: string[] = [];
	for (const [path, isSpecPath] of written) (isSpecPath ? specs : changedFiles).push(path);
	return { elapsedMs, toolCount, specs, changedFiles };
}

export function rowIndexForTurn(rows: ChatRow[], turnId: string): number {
	return rows.findIndex((r) => r.id === turnId || r.id.startsWith(`${turnId}:text:`));
}
