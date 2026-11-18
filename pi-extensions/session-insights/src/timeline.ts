import {
	CACHE_TTL_MS,
	type ContextLimit,
	type ContextPoint,
	type Figure,
	type LaneTrack,
	type LlmEvent,
	type SessionTimeline,
	type SpendPoint,
	TIMELINE_SUBAGENT_TRACKS,
	TIMELINE_TOOL_TRACKS,
	type TraceEvent,
	type TurnSummary,
} from "./core.ts";
import { costOrigin, emptySpend, tokensOf, tokenTotals } from "./totals.ts";
import type { BuiltTrace, CatalogModel } from "./trace.ts";
import { type PackItem, packTracks, waitedWithin, waitTotals } from "./waits.ts";

/** A model reports caching only when some call read from cache; under this many tokens a miss is noise. */
const MISS_MIN_CONTEXT = 4096;
const MISS_SHARE = 0.5;

export type ContextWindowLookup = (provider: string, model: string) => Promise<number | null>;

export interface OutsideSpend {
	childId: string;
	tokens: number;
	cost: number;
}

export interface SessionTimelineOptions {
	/** The host's context window of a catalog model, `null` when it knows none. */
	contextWindow?: ContextWindowLookup;
	/** Each subagent's spend outside pi's total ([[subagents]] join), added at the subagent's end. */
	outside?: readonly OutsideSpend[];
}

export function contextOf(event: LlmEvent): number {
	return event.tokens.input + event.tokens.cacheRead + event.tokens.cacheWrite;
}

function isFailure(event: TraceEvent): boolean {
	return event.error === true && (event.kind === "tool" || event.kind === "llm");
}

/**
 * Heuristic cache misses: a call with a context of at least 4,096 tokens that read under half of the
 * smaller of its own and the previous call's context from cache, counted only for models that read from
 * cache at least once in the trace (a provider that never reports cache reads has no misses to show).
 */
export function cacheMisses(calls: readonly LlmEvent[]): Set<string> {
	const caching = new Set<string>();
	for (const call of calls) if (call.tokens.cacheRead > 0) caching.add(call.model ?? "");
	const misses = new Set<string>();
	let previous: number | null = null;
	for (const call of calls) {
		const context = contextOf(call);
		if (context <= 0) continue;
		if (
			previous !== null &&
			caching.has(call.model ?? "") &&
			context >= MISS_MIN_CONTEXT &&
			call.tokens.cacheRead < MISS_SHARE * Math.min(previous, context)
		)
			misses.add(call.id);
		previous = context;
	}
	return misses;
}

function counted(value: number): Figure {
	return { value, origin: "counted" };
}

function turnSummaries(trace: BuiltTrace): TurnSummary[] {
	const out: TurnSummary[] = [];
	const { events } = trace;
	for (let at = 0; at < events.length; at++) {
		const turn = events[at];
		if (turn?.kind !== "turn") continue;
		let llm = 0;
		let tools = 0;
		let errors = 0;
		let subagents = 0;
		let endTiming: TraceEvent["timing"] = "notMeasured";
		let end = turn.t0;
		let next = at + 1;
		for (; next < events.length; next++) {
			const event = events[next];
			if (!event || event.depth === 0) break;
			if (event.kind === "llm") llm += 1;
			else if (event.kind === "tool") tools += 1;
			else if (event.kind === "subagent") subagents += 1;
			if (isFailure(event)) errors += 1;
			if (event.t1 >= end) {
				end = event.t1;
				endTiming = event.timing;
			}
		}
		const spend = trace.turnSpend.get(turn.id) ?? emptySpend();
		out.push({
			id: turn.id,
			n: turn.n,
			trigger: turn.trigger,
			t0: turn.t0,
			t1: turn.t1,
			duration: {
				value: turn.t1 - turn.t0,
				origin: endTiming === "approximated" ? "approximated" : "counted",
			},
			userWait: {
				value: waitedWithin(trace.bands, "user", turn.t0, turn.t1),
				origin: "approximated",
			},
			llmCalls: counted(llm),
			toolCalls: counted(tools),
			errors: counted(errors),
			subagents: counted(subagents),
			tokens: { value: tokenTotals(spend), origin: "recorded" },
			cost: { value: spend.cost, origin: costOrigin(spend) },
		});
		at = next - 1;
	}
	return out;
}

function lanes(events: readonly TraceEvent[]): SessionTimeline["lanes"] {
	const tools: PackItem[] = [];
	const subagents: PackItem[] = [];
	for (const event of events) {
		if (event.kind === "tool" && event.family !== "ask")
			tools.push({ id: event.id, t0: event.t0, t1: event.t1 });
		else if (event.kind === "subagent")
			subagents.push({ id: event.id, t0: event.t0, t1: event.t1 });
	}
	const toolPack = packTracks(tools, TIMELINE_TOOL_TRACKS);
	const subagentPack = packTracks(subagents, TIMELINE_SUBAGENT_TRACKS);
	const tracks: LaneTrack[] = [];
	for (const event of events) {
		const track = toolPack.of.get(event.id) ?? subagentPack.of.get(event.id) ?? 0;
		if (track > 0) tracks.push({ id: event.id, track });
	}
	return {
		toolTracks: Math.max(1, toolPack.tracks),
		subagentTracks: subagentPack.tracks,
		tracks,
	};
}

export async function contextLimits(
	calls: readonly LlmEvent[],
	models: ReadonlyMap<string, CatalogModel>,
	lookup: ContextWindowLookup | undefined,
): Promise<ContextLimit[]> {
	const observed = new Map<string, number>();
	for (const call of calls) {
		const model = call.model ?? "";
		observed.set(model, Math.max(observed.get(model) ?? 0, contextOf(call)));
	}
	const limits: ContextLimit[] = [];
	for (const [model, max] of [...observed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		if (max <= 0) continue;
		const catalog = models.get(model);
		let host: number | null = null;
		if (catalog && lookup) {
			try {
				const value = await lookup(catalog.provider, catalog.id);
				host = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
			} catch {
				host = null;
			}
		}
		limits.push(
			host !== null && host >= max
				? { model, value: host, origin: "host", host, observed: max }
				: { model, value: max, origin: "approximated", host, observed: max },
		);
	}
	return limits;
}

function cumulative(marks: readonly { t: number; tokens: number; cost: number }[]): SpendPoint[] {
	const sorted = marks
		.map((mark, order) => ({ ...mark, order }))
		.sort((a, b) => a.t - b.t || a.order - b.order);
	const points: SpendPoint[] = [];
	let tokens = 0;
	let cost = 0;
	for (const mark of sorted) {
		tokens += mark.tokens;
		cost += mark.cost;
		const last = points.at(-1);
		if (last && last.t === mark.t) {
			last.tokens = tokens;
			last.cost = cost;
		} else points.push({ t: mark.t, tokens, cost });
	}
	return points;
}

/** The turn cards, the who-waits bands, packed lanes and counter tracks of one trace. Deterministic. */
export async function buildSessionTimeline(
	trace: BuiltTrace,
	options: SessionTimelineOptions = {},
): Promise<SessionTimeline> {
	const { events, meta } = trace;
	const calls = events.filter((event): event is LlmEvent => event.kind === "llm");
	const misses = cacheMisses(calls);
	const context: ContextPoint[] = calls
		.filter((call) => contextOf(call) > 0)
		.map((call) => ({
			id: call.id,
			tokens: contextOf(call),
			...(misses.has(call.id) ? { miss: true as const } : {}),
		}));
	const own = trace.spends.map(({ t, spend }) => ({
		t,
		tokens: tokensOf(spend),
		cost: spend.cost,
	}));
	const spend = cumulative(own);
	const total = spend.at(-1);
	const ends = new Map<string, number>();
	for (const event of events) if (event.kind === "subagent") ends.set(event.childId, event.t1);
	const sessionEnd = meta.end ?? meta.start ?? 0;
	const outside = (options.outside ?? []).filter((item) => item.tokens > 0 || item.cost > 0);
	const withSubagents =
		outside.length > 0
			? cumulative([
					...own,
					...[...outside]
						.sort((a, b) => (a.childId < b.childId ? -1 : a.childId > b.childId ? 1 : 0))
						.map((item) => ({
							t: ends.get(item.childId) ?? sessionEnd,
							tokens: item.tokens,
							cost: item.cost,
						})),
				])
			: null;
	const waits = waitTotals(trace.bands);
	return {
		revision: meta.revision,
		start: meta.start,
		end: meta.end,
		headline: total && total.cost === 0 && total.tokens > 0 ? "tokens" : "cost",
		turns: turnSummaries(trace),
		bands: trace.bands,
		waits,
		waitsTotal: {
			value: Object.values(waits).reduce((sum, ms) => sum + ms, 0),
			origin: "approximated",
		},
		lanes: lanes(events),
		context,
		peak: {
			value: context.reduce((max, point) => Math.max(max, point.tokens), 0),
			origin: "recorded",
		},
		llmCalls: { value: calls.length, origin: "counted" },
		limits: await contextLimits(calls, trace.models, options.contextWindow),
		spend,
		withSubagents,
		cacheTtlMs: CACHE_TTL_MS,
	};
}
