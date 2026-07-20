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
				message: { role: "custom", customType: "x", content: "ignored", timestamp: 400 },
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
});
