import { expect, test } from "bun:test";
import {
	buildSessionProjection,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { displaySessionProjection, displayTranscriptMessages } from "./displayTranscript";

const line = (obj: unknown) => JSON.stringify(obj);

function entriesOf(jsonl: string): SessionEntry[] {
	const parsed = parseSessionEntries(jsonl);
	migrateSessionEntries(parsed);
	return parsed.filter((entry): entry is SessionEntry => entry.type !== "session");
}

const compacted = [
	line({
		type: "session",
		version: 3,
		id: "s1",
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd: "/tmp/x",
	}),
	line({
		type: "message",
		id: "u0",
		parentId: null,
		message: { role: "user", content: "dropped question", timestamp: 100 },
	}),
	line({
		type: "message",
		id: "a0",
		parentId: "u0",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "dropped answer" }],
			timestamp: 200,
		},
	}),
	line({
		type: "message",
		id: "u1",
		parentId: "a0",
		message: { role: "user", content: "kept question", timestamp: 300 },
	}),
	line({
		type: "compaction",
		id: "c0",
		parentId: "u1",
		firstKeptEntryId: "u1",
		summary: "earlier conversation summarized",
		tokensBefore: 1000,
		timestamp: "2026-01-01T00:00:01.000Z",
	}),
	line({
		type: "message",
		id: "a1",
		parentId: "c0",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "post-compaction answer" }],
			timestamp: 400,
		},
	}),
].join("\n");

test("display projection keeps summarized turns before the compaction marker", () => {
	const messages = displayTranscriptMessages(entriesOf(compacted));
	expect(
		messages.map((message) =>
			message.role === "user" || message.role === "assistant"
				? {
						role: message.role,
						text:
							typeof message.content === "string"
								? message.content
								: message.content
										.filter((block) => block.type === "text")
										.map((block) => block.text)
										.join(""),
					}
				: { role: message.role },
		),
	).toEqual([
		{ role: "user", text: "dropped question" },
		{ role: "assistant", text: "dropped answer" },
		{ role: "compactionSummary" },
		{ role: "user", text: "kept question" },
		{ role: "assistant", text: "post-compaction answer" },
	]);
});

test("a session without compaction is unchanged", () => {
	const jsonl = [
		line({
			type: "session",
			version: 3,
			id: "s1",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: "/tmp/x",
		}),
		line({
			type: "message",
			id: "u0",
			parentId: null,
			message: { role: "user", content: "only question", timestamp: 100 },
		}),
	].join("\n");
	const entries = entriesOf(jsonl);
	expect(displaySessionProjection(entries).messages).toEqual(
		buildSessionProjection(entries).messages,
	);
	expect(displayTranscriptMessages(entries)).toMatchObject([
		{ role: "user", content: "only question" },
	]);
});
