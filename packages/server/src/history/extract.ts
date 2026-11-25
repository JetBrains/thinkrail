import {
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { isControlMessage, isRetriedAttempt, isTranscriptMessageRole } from "@thinkrail/contracts";
import { stripAnsi } from "@thinkrail/shared/stripAnsi";
import { displaySessionProjection } from "./displayTranscript";

export interface HistoryEntry {
	text: string;
	role: "user" | "assistant";
	timestamp: number;
	messageIndex: number;
	entryId: string;
}

export interface ExtractedSession {
	id: string;
	cwd: string;
	title?: string;
	entries: HistoryEntry[];
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) =>
			b && typeof b === "object" && (b as { type?: string }).type === "text"
				? String((b as { text?: unknown }).text ?? "")
				: "",
		)
		.filter(Boolean)
		.join("\n");
}

export interface EntryLocation {
	messageIndex: number;
	anchorText: string;
	/** The entry the location points at: the requested one, or its nearest shown ancestor. */
	entryId: string;
	exact: boolean;
	/** For a message without text (a tool result, a tool-call-only assistant message): the call it shows. */
	toolCallId?: string;
}

const ANCHOR_CHARS = 120;

interface RenderableMessage {
	role: string;
	content?: unknown;
	timestamp: number;
	toolCallId?: unknown;
}

interface Projected {
	header: { id: string; cwd: unknown };
	entries: SessionEntry[];
	renderable: { message: RenderableMessage; sourceId: string; entryId: string }[];
}

function toolCallIdOf(message: RenderableMessage): string | undefined {
	if (message.role === "toolResult")
		return typeof message.toolCallId === "string" ? message.toolCallId : undefined;
	if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
	for (const block of message.content as unknown[]) {
		const { type, id } = (block ?? {}) as { type?: unknown; id?: unknown };
		if (type === "toolCall" && typeof id === "string") return id;
	}
	return undefined;
}

function project(jsonl: string): Projected | null {
	const parsed = parseSessionEntries(jsonl);
	const header = parsed[0];
	if (header?.type !== "session" || typeof header.id !== "string") return null;
	migrateSessionEntries(parsed);
	const entries = parsed.filter((e): e is SessionEntry => e.type !== "session");
	const sourced = displaySessionProjection(entries).entries.flatMap(({ sourceEntry, messages }) =>
		messages.map((message, part) => ({
			message,
			sourceId: sourceEntry.id,
			entryId: messages.length === 1 ? sourceEntry.id : `${sourceEntry.id}:${part}`,
		})),
	);
	return {
		header: { id: header.id, cwd: header.cwd },
		entries,
		renderable: sourced.filter(({ message }) => isTranscriptMessageRole(message.role)),
	};
}

/**
 * Where a pi entry shows in the chat: its message's index in the display projection (the client's
 * `turnIdByMessageIndex`), or, for an entry the chat does not show, its nearest shown ancestor's.
 */
export function locateEntry(jsonl: string, entryId: string): EntryLocation | null {
	const projected = project(jsonl);
	if (!projected) return null;
	const shown = new Map<string, number>();
	projected.renderable.forEach(({ sourceId }, index) => {
		if (!shown.has(sourceId)) shown.set(sourceId, index);
	});
	const parents = new Map(projected.entries.map((entry) => [entry.id, entry.parentId]));
	const seen = new Set<string>();
	for (let id: string | null | undefined = entryId; id && !seen.has(id); id = parents.get(id)) {
		seen.add(id);
		const index = shown.get(id);
		if (index === undefined) continue;
		const message = projected.renderable[index]?.message;
		const text =
			message && (message.role === "user" || message.role === "assistant")
				? textOf(message.content)
				: "";
		const toolCallId = message && !text.trim() ? toolCallIdOf(message) : undefined;
		return {
			messageIndex: index,
			anchorText: text.slice(0, ANCHOR_CHARS),
			entryId: id,
			exact: id === entryId,
			...(toolCallId ? { toolCallId } : {}),
		};
	}
	return null;
}

export function extractSession(jsonl: string): ExtractedSession | null {
	const projected = project(jsonl);
	if (!projected) return null;
	const { header, entries, renderable } = projected;
	let title: string | undefined;
	for (const entry of entries) {
		if (entry.type === "session_info") {
			const name = typeof entry.name === "string" ? stripAnsi(entry.name) : entry.name;
			title = name?.trim() || undefined;
		}
	}
	const messages = renderable.map(({ message }) => message);
	const out: HistoryEntry[] = [];
	for (const [index, { message, entryId }] of renderable.entries()) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = textOf(message.content);
		if (!text.trim()) continue;
		if (message.role === "user" && isControlMessage(text)) continue;
		if (isRetriedAttempt(messages, index)) continue;
		out.push({
			text,
			role: message.role,
			timestamp: message.timestamp,
			messageIndex: index,
			entryId,
		});
	}
	return {
		id: header.id,
		cwd: typeof header.cwd === "string" ? header.cwd : "",
		...(title !== undefined ? { title } : {}),
		entries: out,
	};
}
