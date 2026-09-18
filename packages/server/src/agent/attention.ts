import { createHash } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, AgentSettlement } from "@thinkrail/contracts";
import { awaitingQuestionToolCallId, isAckDetails } from "./askUserQuestion";

export type AttentionCandidateKind = "blocking" | "review" | "interrupted";

export interface AttentionCandidate {
	id: string;
	kind: AttentionCandidateKind;
	turnId: string | null;
	attentionAt: number;
	aliases?: readonly string[];
}

export interface AttentionInputs {
	entries: readonly SessionEntry[];
	isStreaming: boolean;
	pendingMessageCount: number;
	lastSettlement: AgentSettlement | null | undefined;
	pendingDialogId: string | null;
}

const REVIEW_STOP_REASONS: ReadonlySet<string> = new Set(["stop", "error", "length"]);

export const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
export const TRANSCRIPT_TAIL_MAX_BYTES = 8 * 1024 * 1024;

interface MessageView {
	role?: string;
	stopReason?: string;
	toolCallId?: string;
	details?: unknown;
}

function customMessage(entry: Extract<SessionEntry, { type: "custom_message" }>): AgentMessage {
	return {
		role: "custom",
		customType: entry.customType,
		content: entry.content,
		display: entry.display,
		...(entry.details !== undefined ? { details: entry.details } : {}),
		timestamp: Date.parse(entry.timestamp),
	} as AgentMessage;
}

export function attentionMessages(entries: readonly SessionEntry[]): AgentMessage[] {
	return entries.flatMap((entry) => {
		if (entry.type === "message") return [entry.message];
		if (entry.type === "custom_message") return [customMessage(entry)];
		return [];
	});
}

export function attentionTurnId(entries: readonly SessionEntry[]): string | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type === "message" && (entry.message as MessageView).role === "user")
			return entry.id;
	}
	return null;
}

type MessageEntry = Extract<SessionEntry, { type: "message" }>;

interface TurnEntry {
	entry: MessageEntry;
	index: number;
}

function entryTimestamp(entry: SessionEntry | undefined): number {
	const timestamp = entry ? Date.parse(entry.timestamp) : Number.NaN;
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function questionEntry(
	entries: readonly SessionEntry[],
	questionId: string,
): MessageEntry | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		if (
			entry.message.content.some((block) => block.type === "toolCall" && block.id === questionId)
		) {
			return entry;
		}
	}
	return undefined;
}

function latestUserTurn(entries: readonly SessionEntry[]): TurnEntry | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type === "message" && (entry.message as MessageView).role === "user") {
			return { entry, index };
		}
	}
	return null;
}

function latestAssistantForTurn(
	entries: readonly SessionEntry[],
	turnIndex: number,
): TurnEntry | null {
	for (let index = entries.length - 1; index > turnIndex; index--) {
		const entry = entries[index];
		if (entry?.type === "message" && (entry.message as MessageView).role === "assistant") {
			return { entry, index };
		}
	}
	return null;
}

function messageOrdinalAt(entries: readonly SessionEntry[], index: number): number {
	let ordinal = 0;
	for (let cursor = 0; cursor <= index; cursor++) {
		if (entries[cursor]?.type === "message") ordinal++;
	}
	return ordinal;
}

function legacyReviewCandidateId(entry: MessageEntry, messageOrdinal: number): string {
	const digest = createHash("sha256")
		.update(JSON.stringify({ messageOrdinal, timestamp: entry.timestamp, message: entry.message }))
		.digest("hex");
	return `legacy-review:${digest}`;
}

function legacyInterruptedCandidateId(entry: MessageEntry, messageOrdinal: number): string {
	const digest = createHash("sha256")
		.update(JSON.stringify({ messageOrdinal, timestamp: entry.timestamp, message: entry.message }))
		.digest("hex");
	return `legacy-interrupted:${digest}`;
}

export function deriveAttentionCandidate(inputs: AttentionInputs): AttentionCandidate | null {
	const { entries } = inputs;
	const turn = latestUserTurn(entries);
	const turnId = turn?.entry.id ?? null;
	if (inputs.pendingDialogId !== null) {
		return {
			id: `dialog:${inputs.pendingDialogId}`,
			kind: "blocking",
			turnId,
			attentionAt: entryTimestamp(entries.at(-1)),
		};
	}
	const messages = attentionMessages(inputs.entries);
	const questionId = awaitingQuestionToolCallId(messages);
	const questionAcknowledged =
		questionId !== null &&
		(messages as readonly MessageView[]).some(
			(message) =>
				message.role === "toolResult" &&
				message.toolCallId === questionId &&
				isAckDetails(message.details),
		);
	if (questionId !== null && questionAcknowledged) {
		return {
			id: `question:${questionId}`,
			kind: "blocking",
			turnId,
			attentionAt: entryTimestamp(questionEntry(entries, questionId)),
		};
	}
	if (inputs.isStreaming || inputs.pendingMessageCount > 0) return null;
	if (!turn) return null;
	const terminalAssistant = latestAssistantForTurn(inputs.entries, turn.index);
	const inferredStopReason = terminalAssistant
		? (terminalAssistant.entry.message as MessageView).stopReason
		: undefined;
	const reviewStopReason =
		inputs.lastSettlement === undefined ? inferredStopReason : inputs.lastSettlement?.stopReason;
	if (terminalAssistant && reviewStopReason && REVIEW_STOP_REASONS.has(reviewStopReason)) {
		const messageOrdinal = messageOrdinalAt(inputs.entries, terminalAssistant.index);
		const legacyId = legacyReviewCandidateId(terminalAssistant.entry, messageOrdinal);
		const attentionAt = entryTimestamp(terminalAssistant.entry);
		return terminalAssistant.entry.id.startsWith("legacy:")
			? { id: legacyId, kind: "review", turnId, attentionAt }
			: {
					id: `review:${terminalAssistant.entry.id}`,
					kind: "review",
					turnId,
					attentionAt,
					aliases: [legacyId],
				};
	}
	const interruptedStopReason =
		inputs.lastSettlement === undefined
			? inferredStopReason
			: (inputs.lastSettlement?.stopReason ?? inferredStopReason);
	if (terminalAssistant && interruptedStopReason === undefined) return null;
	if (interruptedStopReason && REVIEW_STOP_REASONS.has(interruptedStopReason)) return null;
	const interruptedOrdinal = messageOrdinalAt(inputs.entries, turn.index);
	const legacyId = legacyInterruptedCandidateId(turn.entry, interruptedOrdinal);
	const attentionAt = entryTimestamp(terminalAssistant?.entry ?? turn.entry);
	return turn.entry.id.startsWith("legacy:")
		? { id: legacyId, kind: "interrupted", turnId, attentionAt }
		: {
				id: `interrupted:${turn.entry.id}`,
				kind: "interrupted",
				turnId,
				attentionAt,
				aliases: [legacyId],
			};
}

const SESSION_ENTRY_TYPES: ReadonlySet<string> = new Set([
	"message",
	"thinking_level_change",
	"model_change",
	"compaction",
	"branch_summary",
	"custom",
	"custom_message",
	"label",
	"session_info",
]);

export function parseAttentionEntries(text: string, partialFirstLine: boolean): SessionEntry[] {
	const lines = text.split("\n");
	if (partialFirstLine) lines.shift();
	const entries: SessionEntry[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (!entry || typeof entry !== "object") continue;
		const type = Reflect.get(entry, "type");
		if (typeof type !== "string" || !SESSION_ENTRY_TYPES.has(type)) continue;
		const rawId = Reflect.get(entry, "id");
		const rawParentId = Reflect.get(entry, "parentId");
		const legacy = typeof rawId !== "string" || rawParentId === undefined;
		const id = typeof rawId === "string" ? rawId : `legacy:${entries.length}`;
		const parentId = legacy ? (entries.at(-1)?.id ?? null) : rawParentId;
		if (parentId !== null && typeof parentId !== "string") continue;
		entries.push({ ...entry, id, parentId } as SessionEntry);
	}
	return entries;
}

export function activeAttentionBranch(entries: readonly SessionEntry[]): SessionEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch: SessionEntry[] = [];
	const visited = new Set<string>();
	let current = entries.at(-1);
	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		branch.push(current);
		current = current.parentId === null ? undefined : byId.get(current.parentId);
	}
	return branch.reverse();
}

export function deriveDiskAttentionCandidate(
	entries: readonly SessionEntry[],
): AttentionCandidate | null {
	return deriveAttentionCandidate({
		entries: activeAttentionBranch(entries),
		isStreaming: false,
		pendingMessageCount: 0,
		lastSettlement: undefined,
		pendingDialogId: null,
	});
}
