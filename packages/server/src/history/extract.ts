import {
	buildSessionProjection,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { isControlMessage, isRetriedAttempt, isTranscriptMessageRole } from "@thinkrail/contracts";

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

export function extractSession(jsonl: string): ExtractedSession | null {
	const parsed = parseSessionEntries(jsonl);
	const header = parsed[0];
	if (header?.type !== "session" || typeof header.id !== "string") return null;
	migrateSessionEntries(parsed);
	const entries = parsed.filter((e): e is SessionEntry => e.type !== "session");
	let title: string | undefined;
	for (const entry of entries) {
		if (entry.type === "session_info") title = entry.name?.trim() || undefined;
	}
	const sourced = buildSessionProjection(entries).entries.flatMap(({ sourceEntry, messages }) =>
		messages.map((message, part) => ({
			message,
			entryId: messages.length === 1 ? sourceEntry.id : `${sourceEntry.id}:${part}`,
		})),
	);
	const renderable = sourced.filter(({ message }) => isTranscriptMessageRole(message.role));
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
