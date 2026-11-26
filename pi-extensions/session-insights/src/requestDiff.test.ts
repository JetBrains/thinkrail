import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { cached, TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import { LARGE_TEST_MS, withinBudget } from "../test/perf.ts";
import { createRedactor } from "./redact.ts";
import { buildRequestDiff, changedSpan, parseRequestDiffParams } from "./requestDiff.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("request-diff");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-01T10:00:00.000Z");
const redactor = createRedactor("/home/tester");

function session() {
	const builder = new TranscriptBuilder({ id: "requests", start: T0 });
	const ids: Record<string, string> = {};
	builder.system({
		sections: { preamble: "You are a coding agent.", skills: "<skills>a</skills>" },
		toolsAdded: [{ name: "read" }, { name: "edit" }],
	});
	ids.prompt = builder.user("read src/a.ts");
	ids.first = builder.assistant({
		toolCalls: [{ id: "r1", name: "read", arguments: { path: "src/a.ts" } }],
		usage: cached({ input: 2_000, cacheWrite: 30_000 }, 0.2),
	});
	ids.result = builder.toolResult({
		toolCallId: "r1",
		toolName: "read",
		text: "export const a = 1;",
	});
	ids.warm = builder.assistant({
		text: "Read it.",
		usage: cached({ input: 1_000, cacheRead: 30_000, cacheWrite: 1_000 }, 0.05),
	});
	builder.system({
		sections: { skills: "<skills>a, b at /home/tester/skills/b</skills>" },
		toolsAdded: [{ name: "grep" }],
	});
	ids.next = builder.user("now the skills changed");
	ids.system = builder.assistant({
		text: "Noted.",
		usage: cached({ input: 500, cacheRead: 5_000, cacheWrite: 27_000 }, 0.3),
	});
	builder.modelChange("openai", "gpt-test");
	builder.advance(7 * 60_000);
	ids.model = builder.assistant({
		provider: "openai",
		model: "gpt-test",
		text: "Another model after a pause.",
		usage: cached({ input: 500, cacheRead: 100, cacheWrite: 33_000 }, 0.4),
	});
	ids.compaction = builder.compaction(undefined, {
		firstKept: ids.next,
		summary: "We read a.ts.",
		checkpoint: {
			role: "system",
			content: "",
			sections: {
				preamble: "You are a coding agent.",
				skills: "<skills>a, b at /home/tester/skills/b</skills>",
			},
			toolsAdded: ["read", "edit", "grep"].map((name) => ({
				name,
				description: `The ${name} tool.`,
				parameters: { type: "object", properties: {} },
			})),
			timestamp: T0,
		},
	});
	ids.after = builder.assistant({
		provider: "openai",
		model: "gpt-test",
		text: "Compacted.",
		usage: cached({ input: 500, cacheRead: 100, cacheWrite: 8_000 }, 0.1),
	});
	builder.contextEdit(ids.next, "redacted request");
	ids.edited = builder.assistant({
		provider: "openai",
		model: "gpt-test",
		text: "Edited.",
		usage: cached({ input: 300, cacheRead: 8_000, cacheWrite: 100 }, 0.1),
	});
	return { builder, ids };
}

async function diffOf(name: string, callId: string | undefined) {
	const { builder } = session();
	const store = new TraceStore({ sliceMs: 1000, redactor });
	const file = writeSession(root, name, builder);
	const trace = await store.trace(file);
	if (!trace) throw new Error("no trace");
	return buildRequestDiff(store, file, trace, callId ?? "");
}

describe("request reconstruction", () => {
	test("new messages, a changed section character by character and new tools are what differs", async () => {
		const { ids } = session();
		const diff = await diffOf("sections", ids.system);
		if (!diff) throw new Error("no diff");
		expect(diff.current).toMatchObject({ callId: ids.system, n: 3, turn: 2, total: 32_500 });
		expect(diff.previous).toMatchObject({ callId: ids.warm, n: 2, turn: 1 });
		expect(diff.newTurn).toBe(true);
		expect(diff.miss).toBe(true);
		expect(diff.newCount).toBe(2);
		expect(diff.messages.filter((message) => message.state === "new")).toEqual([
			expect.objectContaining({
				index: 4,
				role: "assistant",
				label: "Read it.",
				eventId: ids.warm,
			}),
			expect.objectContaining({ index: 5, role: "user", label: "now the skills changed" }),
		]);
		expect(diff.messages.find((message) => message.role === "toolResult")?.eventId).toBe(
			"tool:00000003:0",
		);
		const skills = diff.sections.find((section) => section.name === "skills");
		expect(skills?.status).toBe("changed");
		expect(skills?.diff).toEqual([
			{ op: "same", text: "<skills>a" },
			{ op: "added", text: ", b at ~/skills/b" },
			{ op: "same", text: "</skills>" },
		]);
		expect(diff.sections.find((section) => section.name === "preamble")?.status).toBe("same");
		expect(diff.tools).toMatchObject({ added: ["grep"], removed: [], changed: [] });
		expect(diff.tools.before.count).toBe(2);
		expect(diff.tools.after.count).toBe(3);
		expect(diff.firstDifference).toEqual({ kind: "tools" });
		const found = diff.checks.filter((check) => check.found).map((check) => check.cause);
		expect(found).toEqual(["systemPrompt", "tools"]);
	});

	test("a model switch after a pause over the cache TTL is checked; nothing else changed", async () => {
		const { ids } = session();
		const diff = await diffOf("model", ids.model);
		const found = diff?.checks.filter((check) => check.found).map((check) => check.cause);
		expect(found).toEqual(["modelChange", "modelReselected", "pause"]);
		expect(diff?.gapMs).toBeGreaterThan(7 * 60_000);
		expect(diff?.newTurn).toBe(false);
		expect(diff?.firstDifference).toEqual({ kind: "message", index: 6 });
	});

	test("a compaction removes the summarized history and adds its summary", async () => {
		const { ids } = session();
		const diff = await diffOf("compaction", ids.after);
		expect(diff?.removedCount).toBe(4);
		expect(diff?.removed.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(diff?.messages[0]).toMatchObject({
			index: 1,
			role: "compactionSummary",
			label: "We read a.ts.",
			state: "new",
		});
		expect(diff?.checks.find((check) => check.cause === "compaction")?.found).toBe(true);
		expect(diff?.firstDifference).toEqual({ kind: "message", index: 1 });
	});

	test("a context edit marks its target changed", async () => {
		const { ids } = session();
		const diff = await diffOf("edit", ids.edited);
		expect(diff?.messages.find((message) => message.state === "changed")).toMatchObject({
			role: "user",
			label: "redacted request",
		});
		expect(diff?.checks.find((check) => check.cause === "contextEdit")?.found).toBe(true);
	});

	test("the first call has no previous request and an unknown call is not found", async () => {
		const { ids } = session();
		const first = await diffOf("first", ids.first);
		expect(first?.previous).toBeNull();
		expect(first?.firstDifference).toEqual({ kind: "none" });
		expect(first?.messages.map((message) => message.state)).toEqual(["same"]);
		expect(await diffOf("unknown", "nope")).toBeNull();
		expect(await diffOf("not-a-call", ids.prompt)).toBeNull();
	});

	test("the same call reconstructs byte-identically", async () => {
		const { ids } = session();
		const first = JSON.stringify(await diffOf("again-1", ids.system));
		expect(JSON.stringify(await diffOf("again-2", ids.system))).toBe(first);
	});
});

describe("character spans", () => {
	test("only the changed middle is kept, with a cut context on each side", () => {
		const before = `${"a".repeat(500)}OLD${"z".repeat(500)}`;
		const after = `${"a".repeat(500)}NEW TEXT${"z".repeat(500)}`;
		const span = changedSpan(before, after, redactor);
		expect(span.map((segment) => segment.op)).toEqual(["same", "removed", "added", "same"]);
		expect(span[0]?.text).toBe(`…${"a".repeat(160)}`);
		expect(span[1]?.text).toBe("OLD");
		expect(span[2]?.text).toBe("NEW TEXT");
		expect(span[3]?.text).toBe(`${"z".repeat(160)}…`);
	});

	test("a changed secret is masked with the key that names it before the texts are split", () => {
		const span = changedSpan(
			"mode=dev\nAPI_KEY=oldcredential0123456789\n",
			"mode=prod\nAPI_KEY=newcredential9876543210\n",
			redactor,
		);
		expect(JSON.stringify(span)).not.toContain("credential");
		expect(span).toEqual([
			{ op: "same", text: "mode=" },
			{ op: "removed", text: "dev" },
			{ op: "added", text: "prod" },
			{ op: "same", text: "\nAPI_KEY=[redacted]\n" },
		]);
		const only = changedSpan(
			"API_KEY=oldcredential0123456789",
			"API_KEY=newcredential9876543210",
			redactor,
		);
		expect(only).toEqual([]);
	});

	test("a JSON-ish section masks a secret-named field whole, whichever side of the cut it falls", () => {
		const span = changedSpan(
			`{"apiKey": "oldcredential0123456789", "region": "eu"}`,
			`{"apiKey": "newcredential9876543210", "region": "us"}`,
			redactor,
		);
		expect(JSON.stringify(span)).not.toContain("credential");
		expect(span).toEqual([
			{ op: "same", text: `{"apiKey": "[redacted]", "region": "` },
			{ op: "removed", text: "eu" },
			{ op: "added", text: "us" },
			{ op: "same", text: `"}` },
		]);
		const long = `{"password": "${"s3cret".repeat(400)}", "mode": "a"}`;
		const cut = changedSpan(long, long.replace('"a"', '"b"'), redactor);
		expect(JSON.stringify(cut)).not.toContain("s3cret");
	});

	test("a persisted system section whose credential changed reaches the diff masked", async () => {
		const builder = new TranscriptBuilder({ id: "secret-section", start: T0 });
		builder.system({ sections: { env: "API_KEY=oldcredential0123456789", mode: "a=1" } });
		builder.user("first");
		builder.assistant({ text: "One.", usage: cached({ input: 100, cacheWrite: 5_000 }, 0.1) });
		builder.system({ sections: { env: "API_KEY=newcredential9876543210", mode: "a=2" } });
		builder.user("second");
		const second = builder.assistant({
			text: "Two.",
			usage: cached({ input: 100, cacheWrite: 5_000 }, 0.1),
		});
		const store = new TraceStore({ sliceMs: 1000, redactor });
		const file = writeSession(root, "secret-section", builder);
		const trace = await store.trace(file);
		if (!trace) throw new Error("no trace");
		const diff = await buildRequestDiff(store, file, trace, second);
		const env = diff?.sections.find((section) => section.name === "env");
		expect(env?.status).toBe("changed");
		expect(JSON.stringify(diff)).not.toContain("credential");
		expect(env?.diff).toEqual([]);
		expect(diff?.sections.find((section) => section.name === "mode")?.diff).toEqual([
			{ op: "same", text: "a=" },
			{ op: "removed", text: "1" },
			{ op: "added", text: "2" },
		]);
	});

	test("a section named by a credential is listed, and named first, by its masked name", async () => {
		const name = "https://deploy:hunter2pass@example.com/env";
		const masked = "https://[redacted]@example.com/env";
		const builder = new TranscriptBuilder({ id: "secret-name", start: T0 });
		builder.system({ sections: { [name]: "mode a", "/home/tester/notes": "kept" } });
		builder.user("first");
		builder.assistant({ text: "One.", usage: cached({ input: 100, cacheWrite: 5_000 }, 0.1) });
		builder.system({ sections: { [name]: "mode b" } });
		builder.user("second");
		const second = builder.assistant({
			text: "Two.",
			usage: cached({ input: 100, cacheWrite: 5_000 }, 0.1),
		});
		const store = new TraceStore({ sliceMs: 1000, redactor });
		const file = writeSession(root, "secret-name", builder);
		const trace = await store.trace(file);
		if (!trace) throw new Error("no trace");
		const diff = await buildRequestDiff(store, file, trace, second);
		expect(JSON.stringify(diff)).not.toContain("hunter2pass");
		expect(JSON.stringify(diff)).not.toContain("/home/tester");
		expect(diff?.sections.map((section) => [section.name, section.status])).toEqual([
			[masked, "changed"],
			["~/notes", "same"],
		]);
		expect(diff?.firstDifference).toEqual({ kind: "system", section: masked });
	});

	test("params are validated before anything is read", () => {
		expect(parseRequestDiffParams({ sessionId: "s", callId: "c" })).toEqual({
			sessionId: "s",
			callId: "c",
		});
		expect(() => parseRequestDiffParams({ sessionId: "s" })).toThrow();
		expect(() => parseRequestDiffParams({ sessionId: "s", callId: "x".repeat(401) })).toThrow();
	});
});

describe("budgets", () => {
	test(
		"the last call of a 2,400-call session reconstructs within the summary budget and under 1 MB",
		async () => {
			const builder = new TranscriptBuilder({ id: "large-requests", start: T0 });
			builder.system({
				sections: { preamble: "p".repeat(20_000) },
				toolsAdded: [{ name: "read" }],
			});
			let last = "";
			for (let turn = 0; turn < 120; turn += 1) {
				builder.user(`turn ${turn} ${"context ".repeat(40)}`);
				for (let call = 0; call < 20; call += 1) {
					last = builder.assistant({
						text: "Working on it.",
						toolCalls: [{ id: `c${turn}-${call}`, name: "read", arguments: { path: "a.ts" } }],
						usage: cached({ input: 100, cacheRead: 5_000, cacheWrite: 300 }, 0.01),
					});
					builder.toolResult({
						toolCallId: `c${turn}-${call}`,
						toolName: "read",
						text: "x".repeat(2000),
					});
				}
			}
			const store = new TraceStore({ redactor });
			const file = writeSession(root, "large-requests", builder);
			const trace = await store.trace(file);
			if (!trace) throw new Error("no trace");
			const started = performance.now();
			const diff = await buildRequestDiff(store, file, trace, last);
			withinBudget(performance.now() - started, 500);
			expect(diff?.current.messages).toBe(4_918);
			expect(diff?.newCount).toBe(2);
			expect(JSON.stringify(diff).length).toBeLessThan(1_000_000);
		},
		LARGE_TEST_MS,
	);
});
