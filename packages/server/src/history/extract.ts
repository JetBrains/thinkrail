import {
	buildSessionContext,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { TODO_NUDGE_PREFIX } from "@thinkrail/contracts";

/** One searchable message from a session transcript (see SPEC.md for the messageIndex invariant). */
export interface HistoryEntry {
	text: string;
	role: "user" | "assistant";
	timestamp: number;
	/** Position among renderable messages (user/assistant/toolResult/custom) — `session.getMessages` order. */
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

/** The roles the host surfaces to the client (`getSessionMessages`'s filter) — the exact set the client's
 * `messagesToRuntime` folds into `turnIdByMessageIndex`. Indexing against the same set is what keeps a
 * hit's `messageIndex` aligned with the jump anchor the client resolves it against. */
const RENDERABLE_ROLES = new Set(["user", "assistant", "toolResult", "custom"]);

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
 * `SessionManager._buildIndex` does on load — and the resolved array is filtered to the same
 * `RENDERABLE_ROLES` the host's `getSessionMessages` sends, so every entry's `messageIndex` lines up with
 * the client's `turnIdByMessageIndex` (the jump anchor). Entry text is full, never truncated — it's what
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

	const out: HistoryEntry[] = [];
	let messageIndex = 0;
	for (const message of messages) {
		// Non-renderable context messages (compaction/branch summaries) are stripped by the host before
		// the client sees them, so they must not consume an index slot here either.
		if (!RENDERABLE_ROLES.has(message.role)) continue;
		const index = messageIndex++;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = textOf(message.content);
		if (!text.trim()) continue;
		// Internal control traffic: the pi-todos wake-nudge is hidden from the transcript on hydrate, so it
		// must not surface as a recallable/insertable prompt. The index was already consumed above, so
		// skipping only the text keeps every later hit's anchor aligned.
		if (message.role === "user" && text.startsWith(TODO_NUDGE_PREFIX)) continue;
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
