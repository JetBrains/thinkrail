import { describe, expect, test } from "bun:test";
import { runDetails, TranscriptBuilder, usage } from "../test/builders.ts";
import { joinSubagents, outsideSpend } from "./subagents.ts";
import { type SessionSummary, summarizeSessionText } from "./summary.ts";

const CHILD = "019f0000-0000-7000-8000-00000000c001";
const OTHER = "019f0000-0000-7000-8000-00000000c002";

function summarize(builder: TranscriptBuilder): SessionSummary {
	const summary = summarizeSessionText(`${builder.id}.jsonl`, builder.text());
	if (!summary) throw new Error("expected a session");
	return summary;
}

function child(id: string, tokens: number, cost: number, parentSession?: string) {
	const builder = new TranscriptBuilder({ id, ...(parentSession ? { parentSession } : {}) });
	builder.user("Investigate");
	builder.assistant({ usage: usage(tokens, cost) });
	return summarize(builder);
}

let calls = 0;

function spawn(
	parent: TranscriptBuilder,
	id: string,
	status: string,
	tokens: number,
	cost: number,
) {
	calls += 1;
	const call = `call-${calls}`;
	parent.assistant({ toolCalls: [{ id: call, name: "Agent", arguments: { task: "x" } }] });
	parent.toolResult({
		toolCallId: call,
		toolName: "Agent",
		details: runDetails(id, status, { tokens, cost }),
	});
}

describe("the subagent join", () => {
	test("a reported final run without a transcript or mirror is all outside pi's total", () => {
		const parent = new TranscriptBuilder();
		spawn(parent, CHILD, "completed", 10, 0.5);
		const join = joinSubagents(summarize(parent), []);
		expect(join).toEqual({
			count: 1,
			measured: true,
			outside: { cost: 0.5, tokens: 46 },
			children: [{ childId: CHILD, cost: 0.5, tokens: 46 }],
		});
	});

	test("a run reported by Agent, get_subagent_result and its completion counts once", () => {
		const parent = new TranscriptBuilder();
		spawn(parent, CHILD, "completed", 10, 0.5);
		parent.toolResult({
			toolCallId: "poll",
			toolName: "get_subagent_result",
			details: runDetails(CHILD, "completed", { tokens: 10, cost: 0.5 }),
		});
		parent.customMessage(
			"subagent-completion",
			runDetails(CHILD, "completed", { tokens: 10, cost: 0.5 }),
		);
		const summary = summarize(parent);
		expect(summary.subagents[CHILD]?.reported).toMatchObject({ input: 10, cost: 0.5 });
		expect(joinSubagents(summary, []).outside).toEqual({ cost: 0.5, tokens: 46 });
	});

	test("two distinct runs of one child add up", () => {
		const parent = new TranscriptBuilder();
		spawn(parent, CHILD, "completed", 10, 0.5);
		parent.customMessage(
			"subagent-completion",
			runDetails(CHILD, "completed", { tokens: 20, cost: 0.25 }, 2000),
		);
		expect(joinSubagents(summarize(parent), []).outside).toEqual({ cost: 0.75, tokens: 46 + 86 });
	});

	test("spend the parent mirrored is inside pi's total and never counted again", () => {
		const parent = new TranscriptBuilder();
		spawn(parent, CHILD, "completed", 10, 0.5);
		parent.usageEntry("subagent", usage(10, 0.5), CHILD);
		const summary = summarize(parent);
		expect(summary.spend.cost).toBeCloseTo(0.51, 12);
		expect(joinSubagents(summary, [child(CHILD, 10, 0.5)])).toEqual({
			count: 1,
			measured: true,
			outside: { cost: 0, tokens: 0 },
			children: [],
		});
	});

	test("a transcript beyond the mirror contributes only the difference", () => {
		const parent = new TranscriptBuilder();
		spawn(parent, CHILD, "running", 0, 0);
		parent.usageEntry("subagent", usage(10, 0.5), CHILD);
		const join = joinSubagents(summarize(parent), [child(CHILD, 30, 0.75)]);
		expect(join.measured).toBe(true);
		expect(join.outside.tokens).toBe(4 * 30 + 6 - (4 * 10 + 6));
		expect(join.outside.cost).toBeCloseTo(0.25, 12);
	});

	test("a transcript below the mirror is never a negative correction", () => {
		const parent = new TranscriptBuilder();
		parent.usageEntry("subagent", usage(30, 0.75), CHILD);
		expect(joinSubagents(summarize(parent), [child(CHILD, 10, 0.5)]).outside).toEqual({
			cost: 0,
			tokens: 0,
		});
	});

	test("a mirrored-only child is not measured", () => {
		const parent = new TranscriptBuilder();
		parent.usageEntry("subagent", usage(10, 0.5), CHILD);
		expect(joinSubagents(summarize(parent), [])).toEqual({
			count: 1,
			measured: false,
			outside: { cost: 0, tokens: 0 },
			children: [],
		});
	});

	test("a referenced child that never finished and left no transcript is not measured", () => {
		const parent = new TranscriptBuilder();
		spawn(parent, CHILD, "running", 0, 0);
		const summary = summarize(parent);
		expect(summary.subagents[CHILD]).toMatchObject({ status: "running", reported: null });
		expect(joinSubagents(summary, []).measured).toBe(false);
	});

	test("a transcript the parent never referenced is a subagent outside pi's total", () => {
		const join = joinSubagents(summarize(new TranscriptBuilder()), [child(OTHER, 10, 0.5)]);
		expect(join).toEqual({
			count: 1,
			measured: true,
			outside: { cost: 0.5, tokens: 46 },
			children: [{ childId: OTHER, cost: 0.5, tokens: 46 }],
		});
	});

	test("a forked transcript carries copied parent spend and is not a spend source", () => {
		const parent = new TranscriptBuilder();
		spawn(parent, CHILD, "completed", 10, 0.5);
		const forked = child(CHILD, 1000, 9, "/sessions/parent.jsonl");
		expect(joinSubagents(summarize(parent), [forked]).outside).toEqual({ cost: 0.5, tokens: 46 });
		expect(joinSubagents(summarize(new TranscriptBuilder()), [forked]).measured).toBe(false);
	});

	test("float noise under 1e-9 is no spend", () => {
		const best = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.3 };
		const mirrored = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.1 + 0.2 };
		expect(outsideSpend(best, mirrored)).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
		});
	});
});
