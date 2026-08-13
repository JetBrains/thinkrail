import {
	buildSessionContext,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { isControlMessage, isRetriedAttempt, isTranscriptMessageRole } from "@thinkrail/contracts";

/** One searchable message from a session transcript (see SPEC.md for the messageIndex invariant). */
export interface HistoryEntry {
	text: string;
	role: "user" | "assistant";
	timestamp: number;
	/** Position among the roles `isTranscriptMessageRole` admits — `session.getMessages` order. */
	messageIndex: number;
}

/** One resolved session file: its identity + searchable entries, all from a single parse — so the index
 * never needs a second metadata source (`SessionManager.listAll` re-parses the whole corpus; see SPEC.md). */
export interface ExtractedSession {
	id: string;
	cwd: string;
	/** The latest `session_info` name (latest wins, including explicit clears) — pi's own rule. */
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

/**
 * Parse one pi session JSONL file into its identity + searchable entries. Pure.
 *
 * Returns `null` unless the first parseable entry is a `type: "session"` header with a string `id` —
 * the same rejection rule pi's own `buildSessionInfo` applies, so a stray non-session `.jsonl` in a
 * sessions dir is skipped exactly like pi would skip it. `id`/`cwd` come from that header (`cwd` is
 * **never** inferred from directory placement — see SPEC.md), `title` from the latest `session_info`
 * entry (including explicit clears).
 *
 * Pi session files are trees, not flat logs: a file can hold abandoned branches, and compaction rewrites
 * which messages are "live". So we resolve the file the same way pi does before the client ever renders
 * it — `parseSessionEntries` → `migrateSessionEntries` → `buildSessionContext` (follow the current leaf,
 * apply the latest compaction, drop summarized/abandoned entries), then index the resolved messages.
 * `leafId` is left undefined so pi picks the current leaf as the last entry, exactly as
 * `SessionManager._buildIndex` does on load — and the resolved array is filtered through the wire's own
 * `isTranscriptMessageRole`, the same guard `getSessionMessages` sends by (one policy, not a copy of it),
 * so every entry's `messageIndex` lines up with the client's `turnIdByMessageIndex` (the jump anchor). Entry text is full, never truncated — it's what
 * recall inserts and what the overlay presents as the whole prompt (see SPEC.md). Tolerant:
 * `parseSessionEntries` skips non-JSON/malformed lines; a v1/v2 file is migrated first so it resolves
 * like any current session.
 */
export function extractSession(jsonl: string): ExtractedSession | null {
	const parsed = parseSessionEntries(jsonl);
	const header = parsed[0];
	if (header?.type !== "session" || typeof header.id !== "string") return null;
	migrateSessionEntries(parsed);
	// `parseSessionEntries` returns `FileEntry[]` (the session header included); `buildSessionContext`
	// wants `SessionEntry[]`. The header carries no id any message's `parentId` points at, so dropping it
	// changes nothing about the resolved path — it just satisfies the type without a cast.
	const entries = parsed.filter((e): e is SessionEntry => e.type !== "session");
	let title: string | undefined;
	for (const entry of entries) {
		if (entry.type === "session_info") title = entry.name?.trim() || undefined;
	}
	const { messages } = buildSessionContext(entries);

	// Indexing against the wire's own role policy is what keeps a hit's `messageIndex` aligned with the
	// client's `turnIdByMessageIndex`: a role the host strips (branch summaries) must not consume a slot
	// here, and one it sends must — a `compactionSummary` does, without ever becoming a searchable entry
	// (the role check below). Filtering FIRST (not a running counter) so `isRetriedAttempt` sees the
	// same adjacency the client renders on hydrate.
	const renderable = messages.filter((message) => isTranscriptMessageRole(message.role));
	const out: HistoryEntry[] = [];
	for (const [index, message] of renderable.entries()) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = textOf(message.content);
		if (!text.trim()) continue;
		// Internal control traffic: the pi-todos wake-nudge is hidden from the transcript on hydrate, so it
		// must not surface as a recallable/insertable prompt. The index slot is still consumed (it is the
		// loop position), so every later hit's anchor stays aligned.
		if (message.role === "user" && isControlMessage(text)) continue;
		// A superseded auto-retry attempt renders no turn on hydrate (its jump anchor is null), so its text
		// must not surface as a searchable/jumpable hit either — same shared reading as the client's.
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
