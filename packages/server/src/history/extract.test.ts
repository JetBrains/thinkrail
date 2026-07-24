import { describe, expect, test } from "bun:test";
import { TODO_NUDGE_PREFIX } from "@thinkrail/contracts";
import { extractEntries } from "./extract";

const line = (obj: unknown) => JSON.stringify(obj);

/** A v3 session header — present so `migrateSessionEntries` treats the fixture as current (no migration)
 * and the hand-written `id`/`parentId` tree below is used verbatim. */
const header = (cwd = "/tmp/x") =>
	line({ type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd });

describe("extractEntries", () => {
	test("extracts user + assistant text with getMessages-aligned messageIndex", () => {
		const jsonl = [
			line({ type: "session_info", id: "a", name: "My chat" }), // not a message — no index
			line({
				type: "message",
				id: "b",
				message: { role: "user", content: "fix the flaky test", timestamp: 100 },
			}),
			line({
				type: "message",
				id: "c",
				message: {
					role: "assistant",
					timestamp: 200,
					content: [
						{ type: "thinking", thinking: "hmm" },
						{ type: "text", text: "It fails because of the debounce." },
						{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
					],
				},
			}),
			line({
				type: "message",
				id: "d",
				message: { role: "toolResult", toolCallId: "t1", content: [], timestamp: 300 },
			}),
			line({
				type: "custom_message",
				id: "e",
				customType: "x",
				content: "ignored",
				timestamp: "2026-01-01T00:00:00.000Z",
				display: false,
			}),
			line({
				type: "message",
				id: "f",
				message: { role: "user", content: [{ type: "text", text: "try again" }], timestamp: 500 },
			}),
			"not json at all",
		].join("\n");
		const entries = extractEntries(jsonl);
		expect(entries).toEqual([
			{ text: "fix the flaky test", role: "user", timestamp: 100, messageIndex: 0 },
			{
				text: "It fails because of the debounce.",
				role: "assistant",
				timestamp: 200,
				messageIndex: 1,
			},
			// toolResult = index 2, custom = index 3 (renderable, counted but not extracted)
			{ text: "try again", role: "user", timestamp: 500, messageIndex: 4 },
		]);
	});

	test("caps searchable text and skips empty text", () => {
		const big = "x".repeat(10_000);
		const jsonl = [
			line({
				type: "message",
				id: "a",
				message: { role: "user", content: big, timestamp: 1 },
			}),
			line({
				type: "message",
				id: "b",
				message: { role: "assistant", content: [{ type: "text", text: "   " }], timestamp: 2 },
			}),
		].join("\n");
		const entries = extractEntries(jsonl);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.text.length).toBe(4000);
	});

	test("a message entry with role='custom' is counted (renderable) but never extracted", () => {
		const jsonl = [
			line({
				type: "message",
				id: "a",
				message: { role: "user", content: "real user msg", timestamp: 100 },
			}),
			// A v2 `hookMessage` migrates to role "custom" on a `message` entry — the host surfaces it as a
			// renderable "custom" message, so it consumes an index slot (index 1) but carries no prompt text.
			line({
				type: "message",
				id: "b",
				message: { role: "custom", content: "should not appear", timestamp: 200 },
			}),
			line({
				type: "custom_message",
				id: "c",
				customType: "x",
				content: "custom via type",
				timestamp: "2026-01-01T00:00:00.000Z",
				display: false,
			}),
		].join("\n");
		const entries = extractEntries(jsonl);
		expect(entries).toEqual([
			{ text: "real user msg", role: "user", timestamp: 100, messageIndex: 0 },
		]);
	});

	test("a mid-file garbage line doesn't disturb messageIndex continuity", () => {
		const jsonl = [
			line({
				type: "message",
				id: "a",
				message: { role: "user", content: "first", timestamp: 100 },
			}),
			"not json at all, sitting mid-file",
			line({
				type: "message",
				id: "c",
				message: { role: "assistant", content: "second", timestamp: 200 },
			}),
		].join("\n");
		const entries = extractEntries(jsonl);
		// The unparseable line is skipped by pi's own parser; "second" lands at messageIndex 1, right behind
		// "first" at 0 — no gap opened by the line in between.
		expect(entries).toEqual([
			{ text: "first", role: "user", timestamp: 100, messageIndex: 0 },
			{ text: "second", role: "assistant", timestamp: 200, messageIndex: 1 },
		]);
	});

	test("indexes only the active branch — abandoned-branch messages are neither indexed nor counted", () => {
		// Tree: u0 → a0 → {abandoned: u1x → a1x}, and the live branch u1 → a1 (both children of a0). The
		// leaf is the last physical entry (a1), so pi resolves the path u0 → a0 → u1 → a1. The abandoned
		// edit/reply must not appear, and the live follow-up must land at index 2 — NOT index 4 (its raw
		// file position) — matching what the client's hydrated transcript renders.
		const jsonl = [
			header(),
			line({
				type: "message",
				id: "u0",
				parentId: null,
				message: { role: "user", content: "first question", timestamp: 100 },
			}),
			line({
				type: "message",
				id: "a0",
				parentId: "u0",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "first answer" }],
					timestamp: 200,
				},
			}),
			line({
				type: "message",
				id: "u1x",
				parentId: "a0",
				message: { role: "user", content: "abandoned edit", timestamp: 300 },
			}),
			line({
				type: "message",
				id: "a1x",
				parentId: "u1x",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "abandoned reply" }],
					timestamp: 400,
				},
			}),
			line({
				type: "message",
				id: "u1",
				parentId: "a0",
				message: { role: "user", content: "real followup", timestamp: 500 },
			}),
			line({
				type: "message",
				id: "a1",
				parentId: "u1",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "real reply" }],
					timestamp: 600,
				},
			}),
		].join("\n");
		const entries = extractEntries(jsonl);
		expect(entries).toEqual([
			{ text: "first question", role: "user", timestamp: 100, messageIndex: 0 },
			{ text: "first answer", role: "assistant", timestamp: 200, messageIndex: 1 },
			{ text: "real followup", role: "user", timestamp: 500, messageIndex: 2 },
			{ text: "real reply", role: "assistant", timestamp: 600, messageIndex: 3 },
		]);
	});

	test("respects compaction — summarized-away messages are dropped and the summary isn't indexed", () => {
		// u0/a0 precede firstKeptEntryId (u1) so compaction drops them; the compaction summary is a
		// non-renderable message (no index slot); the kept question + post-compaction answer index from 0,
		// matching the client's post-compaction transcript.
		const jsonl = [
			header(),
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
		const entries = extractEntries(jsonl);
		expect(entries).toEqual([
			{ text: "kept question", role: "user", timestamp: 300, messageIndex: 0 },
			{ text: "post-compaction answer", role: "assistant", timestamp: 400, messageIndex: 1 },
		]);
	});

	test("excludes the internal todo-nudge prompt but still consumes its index slot", () => {
		const jsonl = [
			header(),
			line({
				type: "message",
				id: "u0",
				parentId: null,
				message: { role: "user", content: "real prompt", timestamp: 100 },
			}),
			line({
				type: "message",
				id: "n0",
				parentId: "u0",
				message: {
					role: "user",
					content: `${TODO_NUDGE_PREFIX}A TODO was added to the list: "x".`,
					timestamp: 200,
				},
			}),
			line({
				type: "message",
				id: "u1",
				parentId: "n0",
				message: { role: "user", content: "next prompt", timestamp: 300 },
			}),
		].join("\n");
		const entries = extractEntries(jsonl);
		// The nudge (index 1) is not surfaced, but its slot is still consumed so "next prompt" keeps its
		// real position (index 2) — the same index the client's turnIdByMessageIndex assigns it.
		expect(entries).toEqual([
			{ text: "real prompt", role: "user", timestamp: 100, messageIndex: 0 },
			{ text: "next prompt", role: "user", timestamp: 300, messageIndex: 2 },
		]);
	});
});
