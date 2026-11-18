import {
	buildSessionProjection,
	type CompactionEntry,
	type ContextEditEntry,
	type ProjectedSessionEntry,
	type SessionEntry,
	type SessionProjection,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { isTranscriptMessageRole, type TranscriptMessage } from "@thinkrail/contracts";

function leafPath(entries: readonly SessionEntry[], leafId?: string | null): SessionEntry[] {
	if (leafId === null) return [];
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	let current = (leafId !== undefined ? byId.get(leafId) : undefined) ?? entries.at(-1);
	if (!current) return [];
	const path: SessionEntry[] = [];
	while (current) {
		path.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path.reverse();
}

type ContextMessage = ProjectedSessionEntry["messages"][number];

export function projectContextEntry(
	entry: SessionEntry,
	edit: ContextEditEntry | undefined,
): ContextMessage[] {
	const messages = sessionEntryToContextMessages(entry);
	if (!edit) return messages;
	const { replacement } = edit;
	if (replacement === null) return [];
	return messages.map((message) => {
		if (
			message.role !== "user" &&
			message.role !== "assistant" &&
			message.role !== "toolResult" &&
			message.role !== "custom"
		)
			return message;
		const content =
			(message.role === "assistant" || message.role === "toolResult") &&
			typeof replacement.content === "string"
				? [{ type: "text", text: replacement.content }]
				: replacement.content;
		return { ...message, content } as ContextMessage;
	});
}

function summarizedPrefixEnd(path: readonly SessionEntry[], compaction: CompactionEntry): number {
	const cut = path.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	const at = path.findIndex((entry) => entry.id === compaction.id);
	if (cut >= 0 && (at < 0 || cut < at)) return cut;
	return Math.max(at, 0);
}

export function displaySessionProjection(
	entries: readonly SessionEntry[],
	leafId?: string | null,
): SessionProjection {
	const list = [...entries];
	const projected = buildSessionProjection(list, leafId);
	const compaction = projected.entries.find(
		(entry) => entry.sourceEntry.type === "compaction",
	)?.sourceEntry;
	if (compaction?.type !== "compaction") return projected;
	const path = leafPath(list, leafId);
	const cut = summarizedPrefixEnd(path, compaction);
	if (cut <= 0) return projected;
	const edits = new Map<string, ContextEditEntry>();
	for (const entry of path) if (entry.type === "context_edit") edits.set(entry.targetId, entry);
	const prefix = path.slice(0, cut).map((sourceEntry) => ({
		sourceEntry,
		messages: projectContextEntry(sourceEntry, edits.get(sourceEntry.id)),
	}));
	const next = [...prefix, ...projected.entries];
	return { ...projected, entries: next, messages: next.flatMap((entry) => entry.messages) };
}

export function displayTranscriptMessages(
	entries: readonly SessionEntry[],
	leafId?: string | null,
): TranscriptMessage[] {
	return displaySessionProjection(entries, leafId).messages.filter((message) =>
		isTranscriptMessageRole(message.role),
	) as TranscriptMessage[];
}
