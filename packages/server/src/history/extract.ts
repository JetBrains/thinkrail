import {
	buildSessionContext,
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
	const { messages } = buildSessionContext(entries);

	const renderable = messages.filter((message) => isTranscriptMessageRole(message.role));
	const out: HistoryEntry[] = [];
	for (const [index, message] of renderable.entries()) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = textOf(message.content);
		if (!text.trim()) continue;
		if (message.role === "user" && isControlMessage(text)) continue;
		if (isRetriedAttempt(renderable, index)) continue;
		out.push({
			text,
			role: message.role,
			timestamp: message.timestamp,
			messageIndex: index,
		});
	}
	return {
		id: header.id,
		cwd: typeof header.cwd === "string" ? header.cwd : "",
		...(title !== undefined ? { title } : {}),
		entries: out,
	};
}
