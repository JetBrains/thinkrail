import { createHash } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, AgentSettlement } from "@thinkrail/contracts";
import { awaitingQuestionToolCallId, isAckDetails } from "./askUserQuestion";

export type AttentionCandidateKind = "blocking" | "review";

export interface AttentionCandidate {
	id: string;
	kind: AttentionCandidateKind;
	turnId: string | null;
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

function latestConversationalEntry(
	entries: readonly SessionEntry[],
): Extract<SessionEntry, { type: "message" }> | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message") continue;
		const role = (entry.message as MessageView).role;
		if (role === "user" || role === "assistant") return entry;
	}
	return null;
}

function inferredSettlementStopReason(
	entry: Extract<SessionEntry, { type: "message" }> | null,
): string | undefined {
	return entry ? (entry.message as MessageView).stopReason : undefined;
}

function legacyReviewCandidateId(
	entry: Extract<SessionEntry, { type: "message" }>,
	messageOrdinal: number,
): string {
	const digest = createHash("sha256")
		.update(JSON.stringify({ messageOrdinal, timestamp: entry.timestamp, message: entry.message }))
		.digest("hex");
	return `legacy-review:${digest}`;
}

export function deriveAttentionCandidate(inputs: AttentionInputs): AttentionCandidate | null {
	const turnId = attentionTurnId(inputs.entries);
	if (inputs.pendingDialogId !== null) {
		return { id: `dialog:${inputs.pendingDialogId}`, kind: "blocking", turnId };
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
		return { id: `question:${questionId}`, kind: "blocking", turnId };
	}
	if (inputs.isStreaming || inputs.pendingMessageCount > 0) return null;
	if (inputs.lastSettlement === null) return null;
	const entry = latestConversationalEntry(inputs.entries);
	if (!entry || (entry.message as MessageView).role !== "assistant") return null;
	const stopReason =
		inputs.lastSettlement === undefined
			? inferredSettlementStopReason(entry)
			: inputs.lastSettlement.stopReason;
	if (!stopReason || !REVIEW_STOP_REASONS.has(stopReason)) return null;
	const messageOrdinal = inputs.entries
		.slice(0, inputs.entries.indexOf(entry) + 1)
		.reduce((count, candidate) => count + (candidate.type === "message" ? 1 : 0), 0);
	const legacyId = legacyReviewCandidateId(entry, messageOrdinal);
	return entry.id.startsWith("legacy:")
		? { id: legacyId, kind: "review", turnId }
		: { id: `review:${entry.id}`, kind: "review", turnId, aliases: [legacyId] };
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
