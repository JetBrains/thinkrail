import type { DelegationRunDetails, UserMessage } from "@thinkrail/contracts";
import type { ChatMessageOrder } from "./messageOrder";
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

export interface NarrationStep {
	kind: "narration";
	id: string;
	text: string;
	steps: ActivityStep[];
}

export type ActivityNode = NarrationStep | ThinkingStep | RoutineToolStep;

export type ProseRole = "opening" | "response" | "final";

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
	| { kind: "markdown"; id: string; text: string; role: ProseRole }
	| { kind: "subagentCompletion"; id: string; details: DelegationRunDetails; text: string }
	| ({ kind: "tool"; id: string } & ToolCallData)
	| {
			kind: "activity";
			id: string;
			steps: ActivityNode[];
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

interface ProseEntry {
	id: string;
	text: string;
	safeOpening: boolean;
	afterStep: boolean;
	terminal: boolean;
}

type SegEvent = { kind: "step"; step: ActivityStep } | { kind: "prose"; entry: ProseEntry };

interface Segment {
	events: SegEvent[];
	sawActivity: boolean;
	endedOnActivity: boolean;
	stepSincePrevProse: boolean;
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

function buildActivityTree(events: SegEvent[]): ActivityNode[] {
	const top: ActivityNode[] = [];
	let sectionSteps: ActivityStep[] = [];
	let narration: NarrationStep | undefined;
	const commit = () => {
		const nested = nestRoutineRun(sectionSteps);
		if (narration) narration.steps = nested;
		else top.push(...nested);
		sectionSteps = [];
	};
	for (const event of events) {
		if (event.kind === "prose") {
			commit();
			narration = { kind: "narration", id: event.entry.id, text: event.entry.text, steps: [] };
			top.push(narration);
		} else {
			sectionSteps.push(event.step);
		}
	}
	commit();
	return top;
}

function emptySegment(): Segment {
	return { events: [], sawActivity: false, endedOnActivity: false, stepSincePrevProse: false };
}

export function deriveRows(
	turns: ChatTurn[],
	toolResults: Record<string, ToolResultState>,
	isStreaming: boolean,
	isSpec?: (path: string) => boolean,
): ChatRow[] {
	const rows: ChatRow[] = [];
	let seg = emptySegment();

	const pushProse = (entry: ProseEntry, role: ProseRole) => {
		rows.push({ kind: "markdown", id: entry.id, text: entry.text, role });
	};

	const pushActivity = (events: SegEvent[], live: boolean) => {
		const firstStep = events.find((event) => event.kind === "step");
		if (firstStep?.kind !== "step") return false;
		rows.push({
			kind: "activity",
			id: `activity:${firstStep.step.id}`,
			steps: buildActivityTree(events),
			live,
		});
		return true;
	};

	const flushSegment = (opts: { live: boolean; settled: boolean; roundEnd: boolean }) => {
		const { events } = seg;
		if (events.length === 0) {
			seg = emptySegment();
			return;
		}
		const prose = events.flatMap((event) => (event.kind === "prose" ? [event.entry] : []));
		const anyStep = events.some((event) => event.kind === "step");
		const first = prose[0];
		const hasFollowing = anyStep || prose.length > 1;

		if (!opts.settled) {
			const opening = first?.safeOpening && hasFollowing ? first : undefined;
			if (opening) pushProse(opening, "opening");
			pushActivity(
				events.filter((event) => event.kind === "step"),
				opts.live,
			);
			const response = opening ? prose.slice(1) : prose;
			response.forEach((entry, idx) => {
				pushProse(entry, opts.roundEnd && idx === response.length - 1 ? "final" : "response");
			});
			seg = emptySegment();
			return;
		}

		const openingIds = new Set<string>();
		if (first?.safeOpening && hasFollowing && !first.terminal) {
			openingIds.add(first.id);
			for (let k = 1; k < prose.length; k++) {
				const entry = prose[k];
				const prev = prose[k - 1];
				if (entry && prev && !entry.afterStep && !entry.terminal && openingIds.has(prev.id))
					openingIds.add(entry.id);
				else break;
			}
		}
		const finalIds = new Set(
			prose.filter((entry) => entry.terminal && !openingIds.has(entry.id)).map((entry) => entry.id),
		);
		const activityEvents = events.filter(
			(event) =>
				event.kind === "step" || (!openingIds.has(event.entry.id) && !finalIds.has(event.entry.id)),
		);

		for (const event of events)
			if (event.kind === "prose" && openingIds.has(event.entry.id))
				pushProse(event.entry, "opening");
		if (!pushActivity(activityEvents, opts.live))
			for (const event of activityEvents)
				if (event.kind === "prose") pushProse(event.entry, "response");
		for (const event of events)
			if (event.kind === "prose" && finalIds.has(event.entry.id)) pushProse(event.entry, "final");
		seg = emptySegment();
	};

	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		const endsRound =
			turn.kind !== "user" &&
			(turns[i + 1]?.kind === "user" || (i === turns.length - 1 && !isStreaming));
		if (turn.kind === "assistant") {
			const { message } = turn;
			const dead = message.stopReason === "aborted" || message.stopReason === "error";
			const confirmedContinuing = !turn.streaming && message.stopReason === "toolUse";
			for (let b = 0; b < message.content.length; b++) {
				const block = message.content[b];
				if (!block) continue;
				if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					seg.events.push({
						kind: "step",
						step: {
							kind: "thinking",
							id: `${turn.id}:thinking:${b}`,
							text: block.thinking,
							streaming: turn.streaming,
							tools: [],
						},
					});
					seg.sawActivity = true;
					seg.endedOnActivity = true;
					seg.stepSincePrevProse = true;
				} else if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					seg.events.push({
						kind: "prose",
						entry: {
							id: `${turn.id}:text:${b}`,
							text: block.text,
							safeOpening: !seg.sawActivity || confirmedContinuing,
							afterStep: seg.stepSincePrevProse,
							terminal: !turn.streaming && message.stopReason !== "toolUse",
						},
					});
					seg.endedOnActivity = false;
					seg.stepSincePrevProse = false;
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
						flushSegment({ live: false, settled: true, roundEnd: false });
						rows.push({ kind: "tool", id: block.id, ...data });
					} else {
						seg.events.push({ kind: "step", step: { kind: "tool", id: block.id, ...data } });
						seg.sawActivity = true;
						seg.endedOnActivity = true;
						seg.stepSincePrevProse = true;
					}
				}
			}
			if (endsRound) {
				flushSegment({ live: false, settled: true, roundEnd: true });
				const data = turnDivider(turns, i, isSpec);
				if (data) rows.push({ kind: "divider", id: `${turn.id}:divider`, data });
			}
		} else {
			flushSegment({ live: false, settled: true, roundEnd: endsRound });
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
			if (endsRound) {
				const data = turnDivider(turns, i, isSpec);
				if (data) rows.push({ kind: "divider", id: `${turn.id}:divider`, data });
			}
		}
	}
	flushSegment({
		live: isStreaming && seg.endedOnActivity,
		settled: !isStreaming,
		roundEnd: !isStreaming,
	});
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
