import { countedCalls, missCauses } from "./context.ts";
import {
	COST_MOMENTS,
	type CostCall,
	type CostDiagnosis,
	type CostMoment,
	type CostSpike,
	type DiagnosisKind,
	type LlmEvent,
	type SessionCost,
	type TraceEvent,
} from "./core.ts";
import { analysePlan, turnsOf } from "./plan.ts";
import { byText, mean, median } from "./stats.ts";
import { type ContextWindowLookup, contextLimits, contextOf } from "./timeline.ts";
import { addSpend, costOrigin, emptySpend, tokensOf } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";

/** A spike rewrote at least this share of a context of at least this many tokens to the cache. */
const SPIKE_SHARE = 0.5;
const SPIKE_MIN_CONTEXT = 32_768;
const SPIKES = 5;
/** Calls at or over this share of their own model's host-reported context window count as high-context. */
const HIGH_CONTEXT = 0.8;
/** Calls around the first compaction compared for its effect on a call's price. */
const AROUND_COMPACTION = 30;
/** Diagnosis thresholds (templates over measured figures, not an inference). */
const REWRITES_SHARE = 0.3;
const LONG_CONTEXT = 50_000;
const LONG_CONTEXT_READ_SHARE = 0.5;
const MANY_CALLS = 200;
const TOOLS_SHOWN = 3;
/** A focus that covers (nearly) all the spend says nothing: two turns of a two-turn session. */
const FOCUS_MAX_SHARE = 0.99;

export interface SessionCostOptions {
	contextWindow?: ContextWindowLookup;
}

interface Building {
	key: string;
	turnId: string | null;
	stepId: string | null;
	epoch: number;
	llm: LlmEvent[];
	tools: Map<string, number>;
	toolCalls: number;
	errors: number;
	t0: number;
	t1: number;
}

function byValueThenTime<T extends { value: number; t0: number }>(a: T, b: T): number {
	return b.value - a.value || a.t0 - b.t0;
}

/**
 * Why a session cost what it did, from recorded spend only (never price × tokens): each call's cost and
 * context, the costliest moments (consecutive calls of one plan step, or of one turn without a plan; a
 * new turn or a compaction starts a new moment), calls that rewrote a large context to the cache, and the
 * figures a one-line diagnosis template is filled from. Tokens stand in for cost when pi recorded $0.
 */
export async function buildSessionCost(
	trace: BuiltTrace,
	options: SessionCostOptions = {},
): Promise<SessionCost> {
	const { events } = trace;
	const totals = emptySpend();
	for (const { spend } of trace.spends) addSpend(totals, spend);
	const headline: SessionCost["headline"] =
		totals.cost === 0 && tokensOf(totals) > 0 ? "tokens" : "cost";
	const worth = (call: LlmEvent) => (headline === "cost" ? call.cost : call.tokens.total);
	const total = headline === "cost" ? totals.cost : tokensOf(totals);

	const llm = events.filter((event): event is LlmEvent => event.kind === "llm");
	const number = new Map(llm.map((call, at) => [call.id, at + 1]));
	const calls: CostCall[] = llm.map((call, at) => ({
		id: call.id,
		n: at + 1,
		t: call.t0,
		cost: call.cost,
		tokens: call.tokens.total,
		context: contextOf(call),
	}));

	const analysis = analysePlan(trace);
	const steps = analysis.plan?.steps ?? [];
	const stepNumber = new Map(steps.map((step, at) => [step.id, at + 1]));
	const stepTitle = new Map(steps.map((step) => [step.id, step.title]));
	const turnOf = turnsOf(events);
	const turns = new Map<string, Extract<TraceEvent, { kind: "turn" }>>();
	for (const event of events) if (event.kind === "turn") turns.set(event.id, event);

	const building: Building[] = [];
	const compactions: { id: string; t: number; after: string | null }[] = [];
	const openCompactions: { id: string; t: number; after: string | null }[] = [];
	let current: Building | null = null;
	let epoch = 0;
	for (const event of events) {
		if (event.kind === "mark" && event.mark === "compaction") {
			epoch += 1;
			current = null;
			const item: { id: string; t: number; after: string | null } = {
				id: event.id,
				t: event.t0,
				after: null,
			};
			compactions.push(item);
			openCompactions.push(item);
			continue;
		}
		if (event.kind === "turn") {
			current = null;
			continue;
		}
		if (event.kind !== "llm" && event.kind !== "tool") continue;
		if (event.kind === "llm") for (const item of openCompactions.splice(0)) item.after = event.id;
		const turnId = turnOf.get(event.id) ?? null;
		const stepId = analysis.stepOf.get(event.id) ?? null;
		const key = `${turnId}\u0000${stepId}\u0000${epoch}`;
		if (!current || current.key !== key) {
			current = {
				key,
				turnId,
				stepId,
				epoch,
				llm: [],
				tools: new Map(),
				toolCalls: 0,
				errors: 0,
				t0: event.t0,
				t1: event.t1,
			};
			building.push(current);
		}
		current.t0 = Math.min(current.t0, event.t0);
		current.t1 = Math.max(current.t1, event.t1);
		if (event.error) current.errors += 1;
		if (event.kind === "llm") current.llm.push(event);
		else {
			current.toolCalls += 1;
			const name = event.head ?? event.tool;
			current.tools.set(name, (current.tools.get(name) ?? 0) + 1);
		}
	}

	const epochsOf = new Map<string, Set<number>>();
	for (const item of building) {
		const owner = item.stepId ?? item.turnId ?? "";
		const set = epochsOf.get(owner) ?? new Set<number>();
		set.add(item.epoch);
		epochsOf.set(owner, set);
	}
	const ranked = building
		.filter((item) => item.llm.length > 0)
		.map((item) => ({
			item,
			value: item.llm.reduce((sum, call) => sum + worth(call), 0),
			t0: item.t0,
		}))
		.sort(byValueThenTime);
	const moments: CostMoment[] = ranked.slice(0, COST_MOMENTS).map(({ item, value }, at) => {
		const spend = emptySpend();
		for (const call of item.llm)
			addSpend(spend, {
				input: call.tokens.input,
				output: call.tokens.output,
				cacheRead: call.tokens.cacheRead,
				cacheWrite: call.tokens.cacheWrite,
				cost: call.cost,
			});
		const contexts = item.llm.map(contextOf).filter((context) => context > 0);
		const top = [...item.llm].sort((a, b) => worth(b) - worth(a) || a.t0 - b.t0)[0];
		const split = (epochsOf.get(item.stepId ?? item.turnId ?? "")?.size ?? 0) > 1;
		const turn = item.turnId ? turns.get(item.turnId) : undefined;
		return {
			rank: at + 1,
			turnId: item.turnId,
			turnN: turn?.n ?? null,
			stepId: item.stepId,
			stepN: item.stepId ? (stepNumber.get(item.stepId) ?? null) : null,
			stepTitle: item.stepId ? (stepTitle.get(item.stepId) ?? null) : (turn?.label ?? null),
			phase:
				split && compactions.length > 0
					? item.epoch > 0
						? "afterCompaction"
						: "beforeCompaction"
					: null,
			t0: item.t0,
			t1: item.t1,
			llmCalls: item.llm.length,
			toolCalls: item.toolCalls,
			errors: item.errors,
			cost: { value: spend.cost, origin: costOrigin(spend) },
			tokens: { value: tokensOf(spend), origin: "recorded" },
			share: total > 0 ? value / total : 0,
			perCall: value / item.llm.length,
			contextMin: contexts.length > 0 ? Math.min(...contexts) : 0,
			contextMax: contexts.length > 0 ? Math.max(...contexts) : 0,
			tools: [...item.tools]
				.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
				.slice(0, TOOLS_SHOWN)
				.map(([name, n]) => ({ name, n })),
			topCall: top
				? { id: top.id, n: number.get(top.id) ?? 0, cost: top.cost, tokens: top.tokens.total }
				: null,
		};
	});
	const rest = ranked.slice(COST_MOMENTS);

	const counted = countedCalls(trace);
	const caching = new Set<string>();
	for (const call of llm) if (call.tokens.cacheRead > 0) caching.add(call.model ?? "");
	const firstOfTurn = new Set<string>();
	const seenTurns = new Set<string>();
	for (const call of llm) {
		const turn = turnOf.get(call.id);
		if (turn && !seenTurns.has(turn)) {
			seenTurns.add(turn);
			firstOfTurn.add(call.id);
		}
	}
	const allSpikes = counted
		.filter(({ event }) => {
			const context = contextOf(event);
			return (
				caching.has(event.model ?? "") &&
				context >= SPIKE_MIN_CONTEXT &&
				event.tokens.cacheWrite >= SPIKE_SHARE * context
			);
		})
		.map((item) => ({ item, value: worth(item.event), t0: item.event.t0 }))
		.sort(byValueThenTime);
	const spikes: CostSpike[] = allSpikes.slice(0, SPIKES).map(({ item }) => {
		const { event } = item;
		return {
			id: event.id,
			n: item.n,
			t: event.t0,
			cost: event.cost,
			tokens: event.tokens.total,
			context: contextOf(event),
			cacheRead: event.tokens.cacheRead,
			cacheWrite: event.tokens.cacheWrite,
			gapMs: item.gapMs,
			turnN: item.turn,
			firstOfTurn: firstOfTurn.has(event.id),
			causes: item.previous ? missCauses(item.previous, event, item.changes, item.gapMs) : [],
		};
	});

	const contexts = counted.map((item) => contextOf(item.event));
	let read = 0;
	let requested = 0;
	for (const { event } of counted) {
		read += event.tokens.cacheRead;
		requested += contextOf(event);
	}
	const peakContext = contexts.length > 0 ? Math.max(...contexts) : 0;

	const ownerValue = new Map<string, number>();
	const ownerPeak = new Map<string, number>();
	const useSteps = steps.length >= 2;
	for (const call of llm) {
		const owner = useSteps ? analysis.stepOf.get(call.id) : turnOf.get(call.id);
		if (!owner) continue;
		ownerValue.set(owner, (ownerValue.get(owner) ?? 0) + worth(call));
		ownerPeak.set(owner, Math.max(ownerPeak.get(owner) ?? 0, contextOf(call)));
	}
	const topOwners = [...ownerValue]
		.filter(([, value]) => value > 0)
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.slice(0, 2);
	const focusValue = topOwners.reduce((sum, [, value]) => sum + value, 0);
	const focus: CostDiagnosis["focus"] =
		topOwners.length > 0 && total > 0 && focusValue / total < FOCUS_MAX_SHARE
			? {
					kind: useSteps ? "steps" : "turns",
					items: topOwners.map(([owner, value]) =>
						useSteps
							? { n: stepNumber.get(owner) ?? 0, title: stepTitle.get(owner) ?? "", value }
							: { n: turns.get(owner)?.n ?? 0, title: turns.get(owner)?.label ?? "", value },
					),
					share: focusValue / total,
					peakContext: Math.max(...topOwners.map(([owner]) => ownerPeak.get(owner) ?? 0)),
				}
			: null;

	let compaction: CostDiagnosis["compaction"] = null;
	const firstCompaction = compactions[0];
	if (firstCompaction) {
		const before = counted
			.filter(({ event }) => event.t0 < firstCompaction.t)
			.slice(-AROUND_COMPACTION);
		const after = counted
			.filter(({ event }) => event.t0 >= firstCompaction.t)
			.slice(0, AROUND_COMPACTION);
		if (before.length > 0 && after.length > 0)
			compaction = {
				beforeCall: median(before.map(({ event }) => worth(event))) ?? 0,
				afterCall: median(after.map(({ event }) => worth(event))) ?? 0,
				beforeContext: Math.round(median(before.map(({ event }) => contextOf(event))) ?? 0),
				afterContext: Math.round(median(after.map(({ event }) => contextOf(event))) ?? 0),
			};
	}

	const limits = await contextLimits(
		counted.map((item) => item.event),
		trace.models,
		options.contextWindow,
	);
	const thresholds = new Map(
		limits
			.filter((item) => item.origin === "host")
			.map((item) => [item.model, Math.round(item.value * HIGH_CONTEXT)]),
	);
	const highByModel = new Map<string, { threshold: number; calls: number }>();
	let highCalls = 0;
	let highValue = 0;
	for (const { event } of counted) {
		const model = event.model ?? "";
		const threshold = thresholds.get(model);
		if (threshold === undefined || contextOf(event) < threshold) continue;
		const entry = highByModel.get(model) ?? { threshold, calls: 0 };
		entry.calls += 1;
		highByModel.set(model, entry);
		highCalls += 1;
		highValue += worth(event);
	}
	const highContext: CostDiagnosis["highContext"] =
		highCalls > 0
			? {
					calls: highCalls,
					value: highValue,
					models: [...highByModel]
						.sort(([a], [b]) => byText(a, b))
						.map(([model, entry]) => ({ model, ...entry })),
				}
			: null;
	const rewriteValue = allSpikes.reduce((sum, spike) => sum + spike.value, 0);
	const rewrites = allSpikes.length > 0 ? { calls: allSpikes.length, value: rewriteValue } : null;
	const averageContext = Math.round(mean(contexts) ?? 0);
	const cacheReadShare = requested > 0 ? read / requested : 0;
	let kind: DiagnosisKind = "spread";
	if (llm.length === 0 || total <= 0) kind = "none";
	else if (rewrites && rewrites.value >= REWRITES_SHARE * total) kind = "cacheRewrites";
	else if (averageContext >= LONG_CONTEXT && cacheReadShare >= LONG_CONTEXT_READ_SHARE)
		kind = "longContext";
	else if (llm.length >= MANY_CALLS) kind = "manyCalls";

	const summaries = trace.summarySpend;
	return {
		revision: trace.meta.revision,
		headline,
		total: {
			value: total,
			origin: headline === "tokens" ? "recorded" : costOrigin(totals),
		},
		tokens: { value: tokensOf(totals), origin: "recorded" },
		calls,
		moments,
		rest: { moments: rest.length, value: rest.reduce((sum, item) => sum + item.value, 0) },
		summaries: {
			value: headline === "cost" ? summaries.cost : tokensOf(summaries),
			origin: headline === "cost" ? costOrigin(summaries) : "recorded",
		},
		spikes,
		compactions,
		diagnosis: {
			kind,
			calls: llm.length,
			averageContext,
			peakContext,
			cacheReadShare,
			medianCall: median(llm.map(worth)) ?? 0,
			focus,
			compaction,
			highContext,
			rewrites,
		},
	};
}
