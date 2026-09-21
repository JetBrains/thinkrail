import { describe, expect, test } from "bun:test";
import { extractSession } from "./extract";

const line = (obj: unknown) => JSON.stringify(obj);

const header = (cwd = "/tmp/x") =>
	line({ type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd });

const entriesOf = (jsonl: string) => {
	const session = extractSession(jsonl);
	expect(session).not.toBeNull();
	return session?.entries;
};

describe("extractSession", () => {
	test("extracts user + assistant text with getMessages-aligned messageIndex", () => {
		const jsonl = [
			header(),
			line({ type: "session_info", id: "a", parentId: null, name: "My chat" }),
			line({
				type: "message",
				id: "b",
				parentId: "a",
				message: { role: "user", content: "fix the flaky test", timestamp: 100 },
			}),
			line({
				type: "message",
				id: "c",
				parentId: "b",
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
				parentId: "c",
				message: { role: "toolResult", toolCallId: "t1", content: [], timestamp: 300 },
			}),
			line({
				type: "custom_message",
				id: "e",
				parentId: "d",
				customType: "x",
				content: "ignored",
				timestamp: "2026-01-01T00:00:00.000Z",
				display: false,
			}),
			line({
				type: "message",
				id: "f",
				parentId: "e",
				message: { role: "user", content: [{ type: "text", text: "try again" }], timestamp: 500 },
			}),
			"not json at all",
		].join("\n");
		expect(entriesOf(jsonl)).toEqual([
			{ text: "fix the flaky test", role: "user", timestamp: 100, messageIndex: 0 },
			{
				text: "It fails because of the debounce.",
				role: "assistant",
				timestamp: 200,
				messageIndex: 1,
			},
			{ text: "try again", role: "user", timestamp: 500, messageIndex: 4 },
		]);
	});

	test("carries the header's identity and the latest session_info name (a clear wins too)", () => {
		const jsonl = [
			line({
				type: "session",
				version: 3,
				id: "sess-42",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: "/repo/a",
			}),
			line({ type: "session_info", id: "i0", parentId: null, name: "First name" }),
			line({ type: "session_info", id: "i1", parentId: "i0", name: "Renamed chat" }),
			line({
				type: "message",
				id: "m0",
				parentId: "i1",
				message: { role: "user", content: "hello", timestamp: 100 },
			}),
		].join("\n");
		expect(extractSession(jsonl)).toMatchObject({
			id: "sess-42",
			cwd: "/repo/a",
			title: "Renamed chat",
		});

		const cleared = [
			line({
				type: "session",
				version: 3,
				id: "sess-43",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: "/repo/a",
			}),
			line({ type: "session_info", id: "i0", parentId: null, name: "Named" }),
			line({ type: "session_info", id: "i1", parentId: "i0", name: "" }),
		].join("\n");
		expect(extractSession(cleared)?.title).toBeUndefined();
	});

	test("rejects a file whose first parseable entry is not a session header (pi's own rule)", () => {
		expect(
			extractSession(
				line({ type: "message", id: "a", message: { role: "user", content: "x", timestamp: 1 } }),
			),
		).toBeNull();
		expect(
			extractSession(line({ type: "session", version: 3, timestamp: "2026-01-01T00:00:00.000Z" })),
		).toBeNull();
		const afterGarbage = ["not json at all", header()].join("\n");
		expect(extractSession(afterGarbage)).toMatchObject({ id: "s1", cwd: "/tmp/x" });
	});

	test("preserves full text — a prompt far beyond 4k chars is never truncated — and skips empty text", () => {
		const big = `${"x".repeat(10_000)} needle-at-the-end`;
		const jsonl = [
			header(),
			line({
				type: "message",
				id: "a",
				parentId: null,
				message: { role: "user", content: big, timestamp: 1 },
			}),
			line({
				type: "message",
				id: "b",
				parentId: "a",
				message: { role: "assistant", content: [{ type: "text", text: "   " }], timestamp: 2 },
			}),
		].join("\n");
		const entries = entriesOf(jsonl);
		expect(entries).toHaveLength(1);
		expect(entries?.[0]?.text).toBe(big);
	});

	test("a message entry with role='custom' is counted (renderable) but never extracted", () => {
		const jsonl = [
			header(),
			line({
				type: "message",
				id: "a",
				parentId: null,
				message: { role: "user", content: "real user msg", timestamp: 100 },
			}),
			line({
				type: "message",
				id: "b",
				parentId: "a",
				message: { role: "custom", content: "should not appear", timestamp: 200 },
			}),
			line({
				type: "custom_message",
				id: "c",
				parentId: "b",
				customType: "x",
				content: "custom via type",
				timestamp: "2026-01-01T00:00:00.000Z",
				display: false,
			}),
		].join("\n");
		expect(entriesOf(jsonl)).toEqual([
			{ text: "real user msg", role: "user", timestamp: 100, messageIndex: 0 },
		]);
	});

	test("a mid-file garbage line doesn't disturb messageIndex continuity", () => {
		const jsonl = [
			header(),
			line({
				type: "message",
				id: "a",
				parentId: null,
				message: { role: "user", content: "first", timestamp: 100 },
			}),
			"not json at all, sitting mid-file",
			line({
				type: "message",
				id: "c",
				parentId: "a",
				message: { role: "assistant", content: "second", timestamp: 200 },
			}),
		].join("\n");
		expect(entriesOf(jsonl)).toEqual([
			{ text: "first", role: "user", timestamp: 100, messageIndex: 0 },
			{ text: "second", role: "assistant", timestamp: 200, messageIndex: 1 },
		]);
	});

	test("indexes only the active branch — abandoned-branch messages are neither indexed nor counted", () => {
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
		expect(entriesOf(jsonl)).toEqual([
			{ text: "first question", role: "user", timestamp: 100, messageIndex: 0 },
			{ text: "first answer", role: "assistant", timestamp: 200, messageIndex: 1 },
			{ text: "real followup", role: "user", timestamp: 500, messageIndex: 2 },
			{ text: "real reply", role: "assistant", timestamp: 600, messageIndex: 3 },
		]);
	});

	test("respects compaction — summarized-away messages are dropped and the summary isn't a hit", () => {
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
		expect(entriesOf(jsonl)).toEqual([
			{ text: "kept question", role: "user", timestamp: 300, messageIndex: 1 },
			{ text: "post-compaction answer", role: "assistant", timestamp: 400, messageIndex: 2 },
		]);
	});

	test("excludes a superseded auto-retry attempt but still consumes its index slot", () => {
		const jsonl = [
			header(),
			line({
				type: "message",
				id: "u0",
				parentId: null,
				message: { role: "user", content: "what is 2+2", timestamp: 100 },
			}),
			line({
				type: "message",
				id: "a0",
				parentId: "u0",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "unique failed partial" }],
					stopReason: "error",
					errorMessage: "fetch failed",
					timestamp: 200,
				},
			}),
			line({
				type: "message",
				id: "a1",
				parentId: "a0",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "the answer is 4" }],
					stopReason: "stop",
					timestamp: 300,
				},
			}),
		].join("\n");
		expect(entriesOf(jsonl)).toEqual([
			{ text: "what is 2+2", role: "user", timestamp: 100, messageIndex: 0 },
			{ text: "the answer is 4", role: "assistant", timestamp: 300, messageIndex: 2 },
		]);
	});

	test("a terminal failed attempt (no retry after it) stays searchable", () => {
		const jsonl = [
			header(),
			line({
				type: "message",
				id: "a0",
				parentId: null,
				message: {
					role: "assistant",
					content: [{ type: "text", text: "terminal failure partial" }],
					stopReason: "error",
					errorMessage: "retries exhausted",
					timestamp: 100,
				},
			}),
			line({
				type: "message",
				id: "u0",
				parentId: "a0",
				message: { role: "user", content: "try again", timestamp: 200 },
			}),
		].join("\n");
		expect(entriesOf(jsonl)).toEqual([
			{ text: "terminal failure partial", role: "assistant", timestamp: 100, messageIndex: 0 },
			{ text: "try again", role: "user", timestamp: 200, messageIndex: 1 },
		]);
	});
});
