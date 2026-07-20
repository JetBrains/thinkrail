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

const MESSAGE_ROLES = new Set(["user", "assistant", "toolResult"]);

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

/** Parse one pi session JSONL file into searchable entries. Tolerant: non-JSON / unknown lines skip
 * without disturbing the renderable-message count. Pure. */
export function extractEntries(jsonl: string): HistoryEntry[] {
	const entries: HistoryEntry[] = [];
	let messageIndex = 0;
	for (const raw of jsonl.split("\n")) {
		const lineText = raw.trim();
		if (!lineText) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(lineText);
		} catch {
			continue;
		}

		const entry = parsed as {
			type?: unknown;
			message?: { role?: unknown; content?: unknown; timestamp?: unknown };
		};

		// custom_message entries: top-level, no message wrapper, always renderable.
		if (entry.type === "custom_message") {
			messageIndex++;
			continue;
		}

		// message entries: require message.role to be a known type.
		if (entry.type !== "message") continue;
		const role = entry.message?.role;
		if (typeof role !== "string" || !MESSAGE_ROLES.has(role)) continue;
		const index = messageIndex++;

		// Extract text only from user/assistant roles.
		if (role !== "user" && role !== "assistant") continue;
		const text = textOf(entry.message?.content);
		if (!text.trim()) continue;
		const ts = entry.message?.timestamp;
		entries.push({
			text: text.slice(0, MAX_SEARCHABLE),
			role,
			timestamp: typeof ts === "number" ? ts : 0,
			messageIndex: index,
		});
	}
	return entries;
}
