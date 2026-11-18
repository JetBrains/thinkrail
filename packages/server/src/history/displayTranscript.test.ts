import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	buildSessionProjection,
	type ContextEditEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	displaySessionProjection,
	displayTranscriptMessages,
	projectContextEntry,
} from "./displayTranscript";
import { extractSession } from "./extract";

const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const piSessionManager = (await import(join(piDist, "core", "session-manager.js"))) as {
	projectContextEntry: typeof projectContextEntry;
};

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

const usage: Usage = {
	input: 10,
	output: 10,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 20,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(
	text: string,
	timestamp: number,
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		usage,
		stopReason,
		timestamp,
	};
}

function shown(message: { role: string; content?: unknown }): string {
	const content = message.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content.map((block: { text?: string }) => block.text ?? "").join("")
				: "";
	return text ? `${message.role}: ${text}` : message.role;
}

test("context edits still apply to turns a later compaction summarized", () => {
	const manager = SessionManager.inMemory("/tmp/x");
	manager.appendMessage({ role: "user", content: "first question", timestamp: 1 });
	const firstAnswer = manager.appendMessage(assistant("first answer, verbatim", 2));
	manager.appendContextEdit(firstAnswer, { content: "first answer, condensed" });
	manager.appendMessage({ role: "user", content: "write the long thing", timestamp: 3 });
	const truncated = manager.appendMessage(assistant("truncated attempt", 4, "length"));
	manager.appendContextEdit(truncated, null);
	manager.appendCompaction("summary one", truncated, 100);
	manager.appendMessage(assistant("retried answer", 5));
	manager.appendMessage({ role: "user", content: "next question", timestamp: 6 });
	const lastAnswer = manager.appendMessage(assistant("next answer", 7));
	manager.appendCompaction("summary two", lastAnswer, 100);

	const transcript = displayTranscriptMessages(manager.getEntries(), manager.getLeafId());
	expect(transcript.map(shown)).toEqual([
		"user: first question",
		"assistant: first answer, condensed",
		"user: write the long thing",
		"compactionSummary",
		"assistant: retried answer",
		"user: next question",
		"compactionSummary",
		"assistant: next answer",
	]);

	const jsonl = [manager.getHeader(), ...manager.getEntries()]
		.map((entry) => JSON.stringify(entry))
		.join("\n");
	const indexed = extractSession(jsonl)?.entries ?? [];
	expect(indexed.map(({ text }) => text)).toEqual([
		"first question",
		"first answer, condensed",
		"write the long thing",
		"retried answer",
		"next question",
		"next answer",
	]);
	for (const { role, text, messageIndex } of indexed)
		expect(shown(transcript[messageIndex] ?? { role: "missing" })).toBe(`${role}: ${text}`);
});

test("the prefix's context-edit projection matches pi's own projectContextEntry", () => {
	const header = { type: "session", version: 3, id: "s1", timestamp: "", cwd: "/tmp/x" };
	const base = { parentId: null, timestamp: "2026-01-01T00:00:00.000Z" };
	const targets = entriesOf(
		[
			header,
			{ ...base, type: "message", id: "u", message: { role: "user", content: "q", timestamp: 1 } },
			{ ...base, type: "message", id: "a", message: assistant("a", 2) },
			{
				...base,
				type: "message",
				id: "t",
				message: {
					role: "toolResult",
					toolCallId: "call",
					toolName: "read",
					content: [{ type: "text", text: "r" }],
					isError: false,
					timestamp: 3,
				},
			},
			{ ...base, type: "custom_message", id: "c", customType: "x", content: "c", display: true },
			{
				...base,
				type: "compaction",
				id: "k",
				summary: "s",
				firstKeptEntryId: "u",
				tokensBefore: 1,
			},
		]
			.map(line)
			.join("\n"),
	);
	const replacements: ContextEditEntry["replacement"][] = [
		null,
		{ content: "edited" },
		{ content: [{ type: "text", text: "edited block" }] },
	];
	for (const target of targets) {
		const edits = [
			undefined,
			...replacements.map(
				(replacement): ContextEditEntry => ({
					...base,
					type: "context_edit",
					id: `edit-${target.id}`,
					targetId: target.id,
					replacement,
				}),
			),
		];
		for (const edit of edits)
			expect(projectContextEntry(target, edit)).toEqual(
				piSessionManager.projectContextEntry(target, edit),
			);
	}
});
