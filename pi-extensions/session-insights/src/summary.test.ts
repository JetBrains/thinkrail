import { describe, expect, test } from "bun:test";
import { TranscriptBuilder, usage } from "../test/builders.ts";
import { FIRST_PROMPT_CHARS } from "./core.ts";
import { parseLine } from "./lines.ts";
import { createRedactor } from "./redact.ts";
import { ACTIVE_GAP_MS, promptExcerpt, SummaryBuilder, summarizeSessionText } from "./summary.ts";

const redactor = createRedactor("/home/alice");

function summarize(builder: TranscriptBuilder) {
	return summarizeSessionText("s.jsonl", builder.text());
}

describe("session identity", () => {
	test("a file whose first parseable line is not a session header is not a session", () => {
		const builder = new TranscriptBuilder();
		builder.user("hi");
		const text = builder.text().split("\n").slice(1).join("\n");
		expect(summarizeSessionText("s.jsonl", text)).toBeNull();
		expect(summarizeSessionText("s.jsonl", "")).toBeNull();
		expect(summarizeSessionText("s.jsonl", "garbage\n42\n")).toBeNull();
	});

	test("blank and unparseable lines before the header are skipped, like pi", () => {
		const builder = new TranscriptBuilder({ id: "abc" });
		const summary = summarizeSessionText("s.jsonl", `\nnope\n${builder.text()}`);
		expect(summary?.sessionId).toBe("abc");
	});

	test("the title is the latest session_info name, and an empty name clears it", () => {
		const builder = new TranscriptBuilder();
		builder.sessionInfo("First");
		builder.sessionInfo("  Second  ");
		expect(summarize(builder)?.title).toBe("Second");
		builder.sessionInfo("   ");
		expect(summarize(builder)?.title).toBeNull();
		builder.sessionInfo("Third");
		builder.sessionInfo(undefined);
		expect(summarize(builder)?.title).toBeNull();
	});

	test("the first prompt is a byte range of the first user message with text", () => {
		const builder = new TranscriptBuilder();
		builder.user([{ type: "image", data: "AAAA", mimeType: "image/png" }]);
		builder.user([
			{ type: "text", text: "Fix   the\nbug" },
			{ type: "text", text: "please" },
		]);
		builder.user("Later prompt");
		const text = builder.text();
		const range = summarizeSessionText("s.jsonl", text)?.firstPrompt;
		if (!range) throw new Error("expected a first prompt");
		const bytes = new TextEncoder()
			.encode(text)
			.subarray(range.offset, range.offset + range.length);
		expect(promptExcerpt(parseLine(bytes), redactor)).toBe("Fix the bug please");
	});

	test("a long first prompt is cut to FIRST_PROMPT_CHARS with an ellipsis", () => {
		const excerpt = promptExcerpt(
			{
				type: "message",
				message: { role: "user", content: `${"word ".repeat(100)}😀`.repeat(2) },
			},
			redactor,
		);
		expect(excerpt?.length).toBeLessThanOrEqual(FIRST_PROMPT_CHARS);
		expect(excerpt?.endsWith("…")).toBe(true);
		const emoji = promptExcerpt(
			{ type: "message", message: { role: "user", content: "😀".repeat(200) } },
			redactor,
		);
		expect(emoji?.length).toBeLessThanOrEqual(FIRST_PROMPT_CHARS);
		expect(emoji?.at(-2)).not.toBe("\ud83d");
		expect(
			promptExcerpt({ type: "message", message: { role: "assistant", content: "x" } }, redactor),
		).toBe(null);
	});
});

describe("counts, models and time", () => {
	test("counts follow getSessionStats, with tools, errors and stop reasons by name", () => {
		const builder = new TranscriptBuilder();
		builder.user("Go");
		builder.assistant({
			toolCalls: [
				{ id: "a", name: "bash" },
				{ id: "b", name: "read" },
			],
		});
		builder.toolResult({ toolCallId: "a", toolName: "bash", isError: true });
		builder.toolResult({ toolCallId: "b", toolName: "read" });
		builder.assistant({ stopReason: "aborted", usage: usage(0, 0) });
		builder.compaction();
		builder.modelChange("openai", "gpt-x");
		builder.assistant({ provider: "openai", model: "router", responseModel: "gpt-x-1" });
		expect(summarize(builder)).toMatchObject({
			counts: {
				entries: 8,
				userMessages: 1,
				assistantMessages: 3,
				toolCalls: 2,
				toolResults: 2,
				toolErrors: 1,
				compactions: 1,
				modelChanges: 1,
			},
			tools: { bash: { calls: 1, errors: 1 }, read: { calls: 1, errors: 0 } },
			stopReasons: { toolUse: 1, aborted: 1, stop: 1 },
		});
		expect(Object.keys(summarize(builder)?.models ?? {})).toEqual([
			"anthropic/claude-test",
			"openai/gpt-x-1",
		]);
	});

	test("hostile names never reach an object prototype", () => {
		const builder = new TranscriptBuilder();
		builder.assistant({ toolCalls: [{ id: "a", name: "__proto__" }], stopReason: "__proto__" });
		builder.toolResult({ toolCallId: "a", toolName: "__proto__", isError: true });
		const hostile = "__proto__";
		const tools = summarize(builder)?.tools ?? {};
		expect(Object.getOwnPropertyDescriptor(tools, hostile)?.value).toEqual({ calls: 1, errors: 1 });
		expect(Object.getPrototypeOf(tools)).toBe(Object.prototype);
		expect(({} as Record<string, unknown>).calls).toBeUndefined();
		const revived = JSON.parse(JSON.stringify(tools));
		expect(Object.getOwnPropertyDescriptor(revived, hostile)?.value).toEqual({
			calls: 1,
			errors: 1,
		});
	});

	test("active time sums gaps under five minutes; start and end span every entry", () => {
		const builder = new TranscriptBuilder({ start: 0 });
		builder.user("a");
		builder.advance(59_000).assistant();
		builder.advance(ACTIVE_GAP_MS).user("after a break");
		builder.advance(9_000).assistant();
		const summary = summarize(builder);
		expect(summary?.start).toBe(1000);
		expect(summary?.end).toBe(1000 + 60_000 + ACTIVE_GAP_MS + 1000 + 10_000);
		expect(summary?.activeMs).toBe(60_000 + 10_000);
	});

	test("settings a restored chat appends later never stretch the end or the active time", () => {
		const builder = new TranscriptBuilder({ start: 0 });
		builder.thinkingLevel("high");
		builder.user("a");
		builder.modelChange("anthropic", "claude-test");
		builder.assistant();
		const activeEnd = builder.now();
		builder.advance(60_000).thinkingLevel("low");
		const early = summarize(builder);
		expect(early).toMatchObject({ start: 1000, end: activeEnd, activeMs: activeEnd - 1000 });
		builder.advance(2 * 365 * 24 * 3600_000).thinkingLevel("medium");
		builder.modelChange("anthropic", "claude-other");
		builder.sessionInfo("Renamed");
		builder.system({ sections: { tools: "bash" } });
		builder.entry({ type: "label", targetId: "00000002", label: "keep" });
		builder.entry({ type: "custom", customType: "state", data: {} });
		expect(summarize(builder)).toMatchObject({ end: activeEnd, activeMs: activeEnd - 1000 });
		builder.advance(30_000).user("back again");
		const resumed = summarize(builder);
		expect(resumed?.end).toBe(builder.now());
		expect(resumed?.activeMs).toBe(activeEnd - 1000 + 61_000 + 5 * 1000 + 31_000);
	});

	test("a session of settings only ends where it starts", () => {
		const builder = new TranscriptBuilder({ start: 0 });
		builder.thinkingLevel("high");
		builder.advance(60_000).modelChange("anthropic", "claude-test");
		expect(summarize(builder)).toMatchObject({ start: 1000, end: 1000, activeMs: 0 });
	});

	test("a header-only session starts at the header timestamp", () => {
		const builder = new TranscriptBuilder({ start: 5000 });
		expect(summarize(builder)).toMatchObject({ start: 5000, end: 5000, activeMs: 0 });
	});
});

describe("spend", () => {
	test("tokens of a model that records $0 count as unpriced", () => {
		const builder = new TranscriptBuilder();
		builder.assistant({ provider: "claude-bridge", model: "opus", usage: usage(100, 0) });
		builder.assistant({ usage: usage(10, 0.5) });
		const summary = summarize(builder);
		expect(summary?.spend).toMatchObject({ cost: 0.5, unpricedTokens: 4 * 100 + 6 });
		expect(summary?.models["claude-bridge/opus"]).toEqual({ messages: 1, tokens: 406, cost: 0 });
	});
});

describe("legacy sessions", () => {
	test("a v2 header is migrated through pi before folding and is never resumed", () => {
		const builder = new TranscriptBuilder({ version: 2 });
		builder.user("Old prompt");
		builder.entry({
			type: "message",
			message: { role: "hookMessage", customType: "x", content: "c", display: true, timestamp: 1 },
		});
		builder.assistant({ usage: usage(1, 0.25) });
		const folded = new SummaryBuilder();
		const text = new TextEncoder().encode(builder.text());
		let offset = 0;
		for (const line of builder.text().split("\n")) {
			const length = new TextEncoder().encode(line).length;
			const entry = parseLine(text.subarray(offset, offset + length));
			if (entry !== undefined) folded.add(entry, { offset, length });
			offset += length + 1;
		}
		const result = folded.finish(null);
		expect(result.appendable).toBe(false);
		expect(result.final.header?.version).toBe(3);
		expect(summarize(builder)).toMatchObject({
			counts: { userMessages: 1, assistantMessages: 1 },
			spend: { cost: 0.25 },
		});
	});

	test("a v1 session without entry ids still summarizes", () => {
		const lines = [
			{ type: "session", id: "v1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/old" },
			{
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: "hi" },
			},
			{
				type: "message",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [],
					provider: "p",
					model: "m",
					usage: usage(1, 0.1),
				},
			},
		];
		const summary = summarizeSessionText(
			"s.jsonl",
			`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
		);
		expect(summary).toMatchObject({
			sessionId: "v1",
			cwd: "/old",
			counts: { userMessages: 1, assistantMessages: 1 },
			spend: { cost: 0.1 },
		});
	});
});
