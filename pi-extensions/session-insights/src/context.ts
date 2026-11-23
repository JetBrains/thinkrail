import {
	CACHE_TTL_MS,
	CONTEXT_CATEGORIES,
	type CompactionCliff,
	type ContextCall,
	type LlmEvent,
	type MissCause,
	type ModelSwitch,
	type SessionContext,
} from "./core.ts";
import { type ContextChanges, mergeChanges, noChanges, scaleToTotal } from "./ledger.ts";
import { turnsOf } from "./plan.ts";
import { type ContextWindowLookup, cacheMisses, contextLimits, contextOf } from "./timeline.ts";
import type { BuiltTrace } from "./trace.ts";

const SYSTEM = CONTEXT_CATEGORIES.indexOf("system");

export interface SessionContextOptions {
	contextWindow?: ContextWindowLookup;
}

/** The miss causes visible between two calls, in a fixed order (a labelled heuristic). */
export function missCauses(
	previous: LlmEvent,
	current: LlmEvent,
	changes: ContextChanges,
	gapMs: number | null,
): MissCause[] {
	const causes: MissCause[] = [];
	if (previous.model !== null && current.model !== null && previous.model !== current.model)
		causes.push("modelChange");
	else if (changes.models.length > 0) causes.push("modelReselected");
	if (changes.sections.length > 0) causes.push("systemPrompt");
	if (changes.tools.length > 0) causes.push("tools");
	if (changes.compaction) causes.push("compaction");
	if (changes.contextEdits > 0) causes.push("contextEdit");
	if (changes.thinkingLevel) causes.push("thinkingLevel");
	if (gapMs !== null && gapMs > CACHE_TTL_MS) causes.push("pause");
	return causes;
}

export interface CountedCall {
	event: LlmEvent;
	n: number;
	turn: number | null;
	previous: LlmEvent | null;
	/** Changes since `previous` (every model call in between included). */
	changes: ContextChanges;
	gapMs: number | null;
	miss: boolean;
}

/**
 * The model calls with a context, in branch order, each with the previous such call, what changed
 * since it and whether it missed the cache (the timeline's heuristic).
 */
export function countedCalls(trace: BuiltTrace): CountedCall[] {
	const calls = trace.events.filter((event): event is LlmEvent => event.kind === "llm");
	const misses = cacheMisses(calls);
	const turnOf = turnsOf(trace.events);
	const turnN = new Map<string, number>();
	for (const event of trace.events) if (event.kind === "turn") turnN.set(event.id, event.n);
	const out: CountedCall[] = [];
	let previous: LlmEvent | null = null;
	let pending = noChanges();
	calls.forEach((call, at) => {
		const own = trace.contexts.get(call.id)?.changes;
		if (own) mergeChanges(pending, own);
		if (contextOf(call) <= 0) return;
		const turn = turnOf.get(call.id);
		out.push({
			event: call,
			n: at + 1,
			turn: turn ? (turnN.get(turn) ?? null) : null,
			previous,
			changes: pending,
			gapMs: previous ? Math.max(0, call.t0 - previous.t1) : null,
			miss: misses.has(call.id),
		});
		previous = call;
		pending = noChanges();
	});
	return out;
}

/**
 * Each model call's context by category (an estimate scaled to pi's exact total), its cache split,
 * heuristic misses with the causes visible in the file, compaction drops, model switches and the
 * context windows. Deterministic.
 */
export async function buildContextView(
	trace: BuiltTrace,
	options: SessionContextOptions = {},
): Promise<SessionContext> {
	const counted = countedCalls(trace);
	let previousParts: readonly number[] | null = null;
	const calls: ContextCall[] = counted.map((item) => {
		const { event } = item;
		const total = contextOf(event);
		const facts = trace.contexts.get(event.id);
		const estimate = [...(facts?.estimate ?? [])];
		const raw = estimate.reduce((sum, value) => sum + value, 0);
		const unpersisted = facts !== undefined && !facts.system;
		if (unpersisted) estimate[SYSTEM] = (estimate[SYSTEM] ?? 0) + Math.max(0, total - raw);
		const parts = scaleToTotal(estimate, total);
		const call: ContextCall = {
			id: event.id,
			n: item.n,
			t: event.t0,
			model: event.model,
			turn: item.turn,
			total,
			input: event.tokens.input,
			cacheRead: event.tokens.cacheRead,
			cacheWrite: event.tokens.cacheWrite,
			parts,
			delta: previousParts ? parts.map((part, at) => part - (previousParts?.[at] ?? 0)) : null,
			coverage: total > 0 ? Math.round((raw / total) * 1000) / 1000 : 0,
			gapMs: item.gapMs,
			cost: event.cost,
			...(unpersisted ? { unpersisted: true as const } : {}),
		};
		const causes = item.previous ? missCauses(item.previous, event, item.changes, item.gapMs) : [];
		if (causes.length > 0) call.changes = causes;
		if (item.miss && item.previous) call.miss = { causes };
		previousParts = parts;
		return call;
	});

	const compactions: CompactionCliff[] = [];
	const switches: ModelSwitch[] = [];
	const countedIds = new Set(calls.map((call) => call.id));
	let last: LlmEvent | null = null;
	const open: CompactionCliff[] = [];
	for (const event of trace.events) {
		if (event.kind === "mark" && event.mark === "compaction") {
			const cliff: CompactionCliff = {
				id: event.id,
				t: event.t0,
				tokensBefore: event.tokensBefore ?? null,
				before: last?.id ?? null,
				after: null,
				beforeTokens: last ? contextOf(last) : null,
				afterTokens: null,
				change: null,
			};
			compactions.push(cliff);
			open.push(cliff);
		} else if (event.kind === "llm" && countedIds.has(event.id)) {
			for (const cliff of open.splice(0)) {
				const after = contextOf(event);
				cliff.after = event.id;
				cliff.afterTokens = after;
				if (cliff.beforeTokens) cliff.change = after / cliff.beforeTokens - 1;
			}
			if (last && last.model !== event.model)
				switches.push({ at: event.id, from: last.model, to: event.model });
			last = event;
		}
	}

	let peak = 0;
	let sum = 0;
	let read = 0;
	let rewritten = 0;
	let misses = 0;
	for (const call of calls) {
		peak = Math.max(peak, call.total);
		sum += call.total;
		read += call.cacheRead;
		if (call.miss) {
			misses += 1;
			rewritten += call.cacheWrite;
		}
	}
	return {
		revision: trace.meta.revision,
		calls,
		compactions,
		switches,
		limits: await contextLimits(
			counted.map((item) => item.event),
			trace.models,
			options.contextWindow,
		),
		peak: { value: calls.length > 0 ? peak : null, origin: "recorded" },
		average: { value: calls.length > 0 ? Math.round(sum / calls.length) : null, origin: "counted" },
		cacheShare: { value: sum > 0 ? read / sum : null, origin: "counted" },
		misses: { value: misses, origin: "approximated" },
		rewritten: { value: rewritten, origin: "approximated" },
		cacheTtlMs: CACHE_TTL_MS,
	};
}
