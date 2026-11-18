import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { cached, TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import { LARGE_TEST_MS, withinBudget } from "../test/perf.ts";
import { buildContextView } from "./context.ts";
import { CONTEXT_CATEGORIES, type ContextCall, type MissCause } from "./core.ts";
import { ContextLedger, emptyVector, scaleToTotal } from "./ledger.ts";
import { createRedactor } from "./redact.ts";
import { buildRequestDiff } from "./requestDiff.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("context");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-01T10:00:00.000Z");
const at = (category: (typeof CONTEXT_CATEGORIES)[number]) => CONTEXT_CATEGORIES.indexOf(category);

async function traceOf(name: string, builder: TranscriptBuilder) {
	const trace = await new TraceStore({ sliceMs: 1000 }).trace(writeSession(root, name, builder));
	if (!trace) throw new Error("no trace");
	return trace;
}

/** A session with one cache-miss cause per call: system prompt, model, pause, compaction, context edit. */
function eventful(): { builder: TranscriptBuilder; ids: Record<string, string> } {
	const builder = new TranscriptBuilder({ id: "eventful", start: T0 });
	const ids: Record<string, string> = {};
	builder.system({
		sections: { preamble: "p".repeat(8000), skills: "s".repeat(4000) },
		toolsAdded: [{ name: "read" }, { name: "edit" }],
	});
	ids.prompt = builder.user("u".repeat(800));
	ids.first = builder.assistant({
		toolCalls: [{ id: "r1", name: "read", arguments: { path: "src/a.ts" } }],
		usage: cached({ input: 2_000, cacheWrite: 30_000 }, 0.2),
	});
	ids.result = builder.toolResult({ toolCallId: "r1", toolName: "read", text: "x".repeat(40_000) });
	ids.warm = builder.assistant({
		text: "Read it.",
		usage: cached({ input: 1_000, cacheRead: 30_000, cacheWrite: 10_000 }, 0.05),
	});
	builder.system({ sections: { skills: "s".repeat(5000) } });
	ids.second = builder.user("next");
	ids.system = builder.assistant({
		text: "Skills changed.",
		usage: cached({ input: 500, cacheRead: 5_000, cacheWrite: 37_000 }, 0.3),
	});
	builder.modelChange("openai", "gpt-test");
	ids.model = builder.assistant({
		provider: "openai",
		model: "gpt-test",
		text: "Another model.",
		usage: cached({ input: 500, cacheRead: 2_000, cacheWrite: 41_000 }, 0.4),
	});
	builder.advance(6 * 60_000);
	ids.pause = builder.assistant({
		provider: "openai",
		model: "gpt-test",
		text: "After a pause.",
		usage: cached({ input: 500, cacheRead: 1_000, cacheWrite: 42_000 }, 0.4),
	});
	ids.compaction = builder.compaction(undefined, { firstKept: ids.second, tokensBefore: 43_500 });
	ids.after = builder.assistant({
		provider: "openai",
		model: "gpt-test",
		text: "Compacted.",
		usage: cached({ input: 500, cacheRead: 100, cacheWrite: 8_000 }, 0.1),
	});
	ids.edit = builder.contextEdit(ids.second, null);
	ids.edited = builder.assistant({
		provider: "openai",
		model: "gpt-test",
		text: "Edited.",
		usage: cached({ input: 300, cacheRead: 100, cacheWrite: 8_000 }, 0.1),
	});
	return { builder, ids };
}

function byId(calls: readonly ContextCall[], id: string): ContextCall {
	const call = calls.find((candidate) => candidate.id === id);
	if (!call) throw new Error(`no call ${id}`);
	return call;
}

describe("composition", () => {
	test("each call's categories are estimates scaled to pi's exact total, in prompt order", async () => {
		const { builder, ids } = eventful();
		const view = await buildContextView(await traceOf("composition", builder));
		for (const call of view.calls) {
			expect(call.parts).toHaveLength(CONTEXT_CATEGORIES.length);
			expect(call.parts.reduce((sum, part) => sum + part, 0)).toBe(call.total);
			expect(call.parts.every((part) => Number.isInteger(part) && part >= 0)).toBe(true);
		}
		const first = byId(view.calls, ids.first ?? "");
		expect(first.total).toBe(32_000);
		expect(first.n).toBe(1);
		expect(first.turn).toBe(1);
		expect(first.parts[at("system")]).toBeGreaterThan(first.parts[at("skills")] ?? 0);
		expect(first.parts[at("skills")]).toBeGreaterThan(first.parts[at("user")] ?? 0);
		expect(first.parts[at("tools")]).toBeGreaterThan(0);
		expect(first.parts[at("results")]).toBe(0);
		const warm = byId(view.calls, ids.warm ?? "");
		expect(warm.parts[at("results")]).toBeGreaterThan(warm.parts[at("system")] ?? 0);
		expect(warm.parts[at("assistant")]).toBeGreaterThan(0);
		expect(first.coverage).toBeGreaterThan(0);
		expect(first.unpersisted).toBeUndefined();
	});

	test("a compaction keeps its summary and the kept range; a context edit drops its target", async () => {
		const { builder, ids } = eventful();
		const view = await buildContextView(await traceOf("compacted", builder));
		const after = byId(view.calls, ids.after ?? "");
		const before = byId(view.calls, ids.pause ?? "");
		expect(after.parts[at("summary")]).toBeGreaterThan(0);
		expect(before.parts[at("summary")]).toBe(0);
		expect(after.parts[at("results")]).toBe(0);
		expect(view.compactions).toEqual([
			{
				id: ids.compaction ?? "",
				t: expect.any(Number),
				tokensBefore: 43_500,
				before: ids.pause ?? "",
				after: ids.after ?? "",
				beforeTokens: 43_500,
				afterTokens: 8_600,
				change: 8_600 / 43_500 - 1,
			},
		]);
		expect(view.switches).toEqual([
			{ at: ids.model ?? "", from: "anthropic/claude-test", to: "openai/gpt-test" },
		]);
	});

	test("a session without a persisted system message shows the remainder as the system prompt", async () => {
		const builder = new TranscriptBuilder({ id: "legacy", start: T0 });
		builder.user("hello");
		builder.assistant({ text: "Hi.", usage: cached({ input: 12_000 }, 0.01) });
		const view = await buildContextView(await traceOf("legacy", builder));
		const [call] = view.calls;
		expect(call?.unpersisted).toBe(true);
		expect(call?.parts[at("system")]).toBeGreaterThan(11_000);
		expect(call?.parts[at("user")]).toBeLessThan(10);
	});

	test("the ledger replays edits, compactions and system patches the way pi builds a request", () => {
		const ledger = new ContextLedger();
		const user = emptyVector();
		user[at("user")] = 100;
		ledger.apply("s", {
			kind: "system",
			patch: {
				content: 0,
				sections: [["preamble", { chars: 400, hash: "p" }]],
				added: [["read", { chars: 80, hash: "r" }]],
				removed: [],
			},
		});
		ledger.apply("u1", { kind: "item", vector: user });
		ledger.apply("u2", { kind: "item", vector: [...user] });
		expect(ledger.snapshot()[at("user")]).toBe(200);
		expect(ledger.snapshot()[at("system")]).toBe(100);
		expect(ledger.snapshot()[at("tools")]).toBe(20);
		ledger.apply("e", { kind: "edit", target: "u1", chars: null });
		expect(ledger.snapshot()[at("user")]).toBe(100);
		ledger.apply("e2", { kind: "edit", target: "u2", chars: 40 });
		expect(ledger.snapshot()[at("user")]).toBe(10);
		ledger.apply("c", {
			kind: "compaction",
			summary: 800,
			firstKept: "u2",
			checkpoint: {
				content: 0,
				sections: [["preamble", { chars: 40, hash: "q" }]],
				added: [],
				removed: [],
			},
		});
		const after = ledger.snapshot();
		expect(after[at("summary")]).toBe(200);
		expect(after[at("user")]).toBe(10);
		expect(after[at("system")]).toBe(10);
		expect(after[at("tools")]).toBe(0);
		expect(ledger.take()).toMatchObject({
			compaction: true,
			contextEdits: 2,
			sections: ["preamble"],
		});
	});

	test("largest-remainder scaling sums exactly and is stable", () => {
		expect(scaleToTotal([1, 1, 1], 10)).toEqual([4, 3, 3]);
		expect(scaleToTotal([0, 0], 10)).toEqual([0, 0]);
		expect(scaleToTotal([3, 1], 0)).toEqual([0, 0]);
		const scaled = scaleToTotal([0.3, 2.7, 9.1, 0], 1_234_567);
		expect(scaled.reduce((sum, value) => sum + value, 0)).toBe(1_234_567);
	});
});

describe("cache misses", () => {
	test("each miss names the causes visible between it and the previous call", async () => {
		const { builder, ids } = eventful();
		const view = await buildContextView(await traceOf("misses", builder), {
			contextWindow: async () => 200_000,
		});
		const causes = (id: string | undefined) => byId(view.calls, id ?? "").miss?.causes;
		expect(byId(view.calls, ids.warm ?? "").miss).toBeUndefined();
		expect(causes(ids.system)).toEqual(["systemPrompt"]);
		expect(causes(ids.model)).toEqual(["modelChange"]);
		expect(causes(ids.pause)).toEqual(["pause"]);
		expect(causes(ids.after)).toEqual(["compaction"]);
		expect(causes(ids.edited)).toEqual(["contextEdit"]);
		expect(byId(view.calls, ids.pause ?? "").gapMs).toBeGreaterThan(5 * 60_000);
		expect(view.misses).toEqual({ value: 5, origin: "approximated" });
		expect(view.limits.map((limit) => [limit.model, limit.origin, limit.value])).toEqual([
			["anthropic/claude-test", "host", 200_000],
			["openai/gpt-test", "host", 200_000],
		]);
		expect(view.peak).toEqual({ value: 43_500, origin: "recorded" });
	});

	test("a miss with nothing visible before it has no cause, and tool changes are their own cause", async () => {
		const builder = new TranscriptBuilder({ id: "unexplained", start: T0 });
		builder.system({ sections: { preamble: "p".repeat(400) }, toolsAdded: [{ name: "read" }] });
		builder.user("go");
		builder.assistant({ text: "a", usage: cached({ input: 100, cacheWrite: 20_000 }, 0.1) });
		const silent = builder.assistant({
			text: "b",
			usage: cached({ input: 100, cacheRead: 200, cacheWrite: 20_000 }, 0.1),
		});
		builder.system({ toolsAdded: [{ name: "grep" }] });
		const tools = builder.assistant({
			text: "c",
			usage: cached({ input: 100, cacheRead: 200, cacheWrite: 20_100 }, 0.1),
		});
		builder.thinkingLevel("high");
		const thinking = builder.assistant({
			text: "d",
			usage: cached({ input: 100, cacheRead: 200, cacheWrite: 20_200 }, 0.1),
		});
		const view = await buildContextView(await traceOf("unexplained", builder));
		expect(byId(view.calls, silent).miss).toEqual({ causes: [] });
		expect(byId(view.calls, tools).miss).toEqual({ causes: ["tools"] });
		expect(byId(view.calls, thinking).miss).toEqual({ causes: ["thinkingLevel"] });
	});

	test("an equal-length section or tool replacement is a cause that agrees with the request diff", async () => {
		const builder = new TranscriptBuilder({ id: "same-size", start: T0 });
		builder.system({
			sections: { preamble: "Use x" },
			toolsAdded: [{ name: "read" }, { name: "edit" }],
		});
		builder.user("go");
		builder.assistant({ text: "a", usage: cached({ input: 100, cacheWrite: 20_000 }, 0.1) });
		builder.system({ sections: { preamble: "Use y" } });
		const section = builder.assistant({
			text: "b",
			usage: cached({ input: 100, cacheRead: 200, cacheWrite: 20_000 }, 0.1),
		});
		builder.system({ toolsAdded: [{ name: "read", description: "The reed tool." }] });
		const redefined = builder.assistant({
			text: "c",
			usage: cached({ input: 100, cacheRead: 200, cacheWrite: 20_000 }, 0.1),
		});
		builder.system({ toolsRemoved: ["edit"], toolsAdded: [{ name: "grep" }] });
		const swapped = builder.assistant({
			text: "d",
			usage: cached({ input: 100, cacheRead: 200, cacheWrite: 20_000 }, 0.1),
		});
		const store = new TraceStore({ sliceMs: 1000, redactor: createRedactor("/home/tester") });
		const file = writeSession(root, "same-size", builder);
		const trace = await store.trace(file);
		if (!trace) throw new Error("no trace");
		const view = await buildContextView(trace);
		const expected: Record<string, MissCause> = {
			[section]: "systemPrompt",
			[redefined]: "tools",
			[swapped]: "tools",
		};
		for (const [id, cause] of Object.entries(expected)) {
			const call = byId(view.calls, id);
			expect(call.miss).toEqual({ causes: [cause] });
			expect(call.changes).toEqual([cause]);
			const diff = await buildRequestDiff(store, file, trace, id);
			expect(diff?.checks.filter((check) => check.found).map((check) => check.cause)).toEqual([
				cause,
			]);
		}
		const diff = await buildRequestDiff(store, file, trace, section);
		expect(diff?.sections.find((item) => item.name === "preamble")).toMatchObject({
			before: 5,
			after: 5,
			status: "changed",
		});
	});

	test("the same trace builds a byte-identical view", async () => {
		const { builder } = eventful();
		const trace = await traceOf("again", builder);
		const first = JSON.stringify(await buildContextView(trace));
		expect(JSON.stringify(await buildContextView(trace))).toBe(first);
	});
});

describe("budgets", () => {
	test(
		"a 2,400-call session's context view builds within the summary budget and stays under 1 MB",
		async () => {
			const builder = new TranscriptBuilder({ id: "large-context", start: T0 });
			builder.system({
				sections: { preamble: "p".repeat(20_000) },
				toolsAdded: [{ name: "read" }],
			});
			for (let turn = 0; turn < 120; turn += 1) {
				builder.user(`turn ${turn}`);
				for (let call = 0; call < 20; call += 1) {
					builder.assistant({
						text: "Working.",
						toolCalls: [{ id: `c${turn}-${call}`, name: "read", arguments: { path: "a.ts" } }],
						usage: cached({ input: 100, cacheRead: 5_000 + turn * 100, cacheWrite: 300 }, 0.01),
						durationMs: 800,
					});
					builder.toolResult({
						toolCallId: `c${turn}-${call}`,
						toolName: "read",
						text: "x".repeat(400),
					});
				}
			}
			const trace = await traceOf("large-context", builder);
			const started = performance.now();
			const view = await buildContextView(trace, { contextWindow: async () => 200_000 });
			withinBudget(performance.now() - started, 500);
			expect(view.calls).toHaveLength(2_400);
			expect(JSON.stringify(view).length).toBeLessThan(1_000_000);
		},
		LARGE_TEST_MS,
	);
});
