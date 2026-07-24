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

/** Cap per-entry searchable text — huge pasted-log prompts truncate for matching (recall shows the hit;
 * insert re-reads nothing, the capped text is what's inserted, which V1 accepts for >4k prompts). */
export const MAX_SEARCHABLE = 4000;

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
 * Parse one pi session JSONL file into searchable entries. Pure.
 *
 * Pi session files are trees, not flat logs: a file can hold abandoned branches, and compaction rewrites
 * which messages are "live". So we resolve the file the same way pi does before the client ever renders
 * it — `parseSessionEntries` → `migrateSessionEntries` → `buildSessionContext` (follow the current leaf,
 * apply the latest compaction, drop summarized/abandoned entries), then index the resolved messages.
 * `leafId` is left undefined so pi picks the current leaf as the last entry, exactly as
 * `SessionManager._buildIndex` does on load — and the resolved array is filtered to the same
 * `RENDERABLE_ROLES` the host's `getSessionMessages` sends, so every entry's `messageIndex` lines up with
 * the client's `turnIdByMessageIndex` (the jump anchor). Tolerant: `parseSessionEntries` skips
 * non-JSON/malformed lines; a v1/v2 file is migrated first so it resolves like any current session.
 */
export function extractEntries(jsonl: string): HistoryEntry[] {
	const parsed = parseSessionEntries(jsonl);
	migrateSessionEntries(parsed);
	// `parseSessionEntries` returns `FileEntry[]` (the session header included); `buildSessionContext`
	// wants `SessionEntry[]`. The header carries no id any message's `parentId` points at, so dropping it
	// changes nothing about the resolved path — it just satisfies the type without a cast.
	const entries = parsed.filter((e): e is SessionEntry => e.type !== "session");
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
			text: text.slice(0, MAX_SEARCHABLE),
			role: message.role,
			timestamp: message.timestamp,
			messageIndex: index,
		});
	}
	return out;
}
