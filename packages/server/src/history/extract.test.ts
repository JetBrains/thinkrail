import { describe, expect, test } from "bun:test";
import { extractEntries } from "./extract";

const line = (obj: unknown) => JSON.stringify(obj);

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
			// toolResult = index 2, custom = index 3 (counted, not extracted)
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

	test("ignores message entries with role='custom' (custom-role arrives only as custom_message type)", () => {
		const jsonl = [
			line({
				type: "message",
				id: "a",
				message: { role: "user", content: "real user msg", timestamp: 100 },
			}),
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
		// Only the user message should be extracted; the message with role="custom" is skipped,
		// and the custom_message is counted in messageIndex (index 2) but not extracted.
		expect(entries).toEqual([
			{ text: "real user msg", role: "user", timestamp: 100, messageIndex: 0 },
		]);
	});

	test("a mid-file garbage line and a message entry with no message object don't disturb messageIndex continuity", () => {
		const jsonl = [
			line({
				type: "message",
				id: "a",
				message: { role: "user", content: "first", timestamp: 100 },
			}),
			"not json at all, sitting mid-file",
			line({ type: "message", id: "b" }), // `type: "message"` but no `message` object at all
			line({
				type: "message",
				id: "c",
				message: { role: "assistant", content: "second", timestamp: 200 },
			}),
		].join("\n");
		const entries = extractEntries(jsonl);
		// Both the unparseable line and the message-shaped-but-message-less entry are pure no-ops: neither
		// extracts an entry NOR advances messageIndex (the role check that discards them runs before the
		// `messageIndex++`), so "second" lands at messageIndex 1, right behind "first" at 0 — no gap opened
		// by the two lines in between.
		expect(entries).toEqual([
			{ text: "first", role: "user", timestamp: 100, messageIndex: 0 },
			{ text: "second", role: "assistant", timestamp: 200, messageIndex: 1 },
		]);
	});
});
