import type { LlmEvent, SubagentEvent, ToolEvent, TraceEvent } from "./core.ts";
import type { BuiltTrace } from "./trace.ts";

/** One Chrome trace event (the JSON object format Perfetto, chrome://tracing and speedscope read). */
export interface ChromeTraceEvent {
	name: string;
	ph: "X" | "I" | "C" | "M" | "s" | "f";
	/** Microseconds from the session's first entry. */
	ts: number;
	pid: number;
	tid: number;
	dur?: number;
	cat?: string;
	s?: "g" | "p" | "t";
	id?: number;
	bp?: "e";
	args?: Record<string, unknown>;
}

export interface ChromeTrace {
	traceEvents: ChromeTraceEvent[];
	displayTimeUnit: "ms";
	otherData: Record<string, unknown>;
}

export interface ChromeTraceInput {
	trace: BuiltTrace;
	/** A one-line, redacted name for the process. */
	title: string;
	/** Subagent transcripts by child id; a missing one shows only the run's span. */
	children: ReadonlyMap<string, BuiltTrace>;
	/** Extra provenance for `otherData` (the user's labels only when they asked for them). */
	otherData?: Record<string, unknown>;
}

const PID = 1;
const TID_TURNS = 1;
const TID_MODEL = 2;
const TID_TOOLS = 10;
const TID_SUBAGENTS = 1000;
const SUBAGENT_STRIDE = 100;

const PHASE_ORDER: Readonly<Record<ChromeTraceEvent["ph"], number>> = {
	M: 0,
	X: 1,
	s: 2,
	f: 3,
	I: 4,
	C: 5,
};

function micros(ms: number, start: number): number {
	return Math.max(0, Math.round((ms - start) * 1000));
}

/** Greedy packing by start: each call takes the first lane free at its start, so parallel calls get their own. */
function packLanes(events: readonly { t0: number; t1: number }[]): number[] {
	const ends: number[] = [];
	return events.map((event) => {
		let lane = ends.findIndex((end) => end <= event.t0);
		if (lane < 0) {
			lane = ends.length;
			ends.push(event.t1);
		} else ends[lane] = event.t1;
		return lane;
	});
}

function byStart<T extends { t0: number; id: string }>(events: readonly T[]): T[] {
	return [...events].sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function threadName(tid: number, name: string, sort: number): ChromeTraceEvent[] {
	return [
		{ name: "thread_name", ph: "M", ts: 0, pid: PID, tid, args: { name } },
		{ name: "thread_sort_index", ph: "M", ts: 0, pid: PID, tid, args: { sort_index: sort } },
	];
}

function slice(
	event: TraceEvent,
	name: string,
	tid: number,
	start: number,
	args: Record<string, unknown>,
): ChromeTraceEvent {
	const ts = micros(event.t0, start);
	return {
		name,
		ph: "X",
		ts,
		dur: Math.max(0, micros(event.t1, start) - ts),
		pid: PID,
		tid,
		cat: event.kind,
		args: {
			...args,
			...(event.label ? { label: event.label } : {}),
			timing: event.timing,
			...(event.error ? { error: true } : {}),
		},
	};
}

function llmArgs(event: LlmEvent): Record<string, unknown> {
	return {
		model: event.model,
		stop: event.stop,
		input: event.tokens.input,
		output: event.tokens.output,
		cacheRead: event.tokens.cacheRead,
		cacheWrite: event.tokens.cacheWrite,
		cost: event.cost,
	};
}

function toolArgs(event: ToolEvent): Record<string, unknown> {
	return {
		tool: event.tool,
		family: event.family,
		...(event.head ? { head: event.head } : {}),
		...(event.exit ? { exit: event.exit } : {}),
		...(event.missing ? { missing: true } : {}),
	};
}

/** Model calls on one thread and tool calls packed onto lanes from `firstTid`, named after `prefix`. */
function callThreads(
	events: readonly TraceEvent[],
	start: number,
	modelTid: number,
	firstToolTid: number,
	prefix: string,
	sort: number,
	out: ChromeTraceEvent[],
): Map<string, number> {
	const toolTid = new Map<string, number>();
	const llm = byStart(events.filter((event): event is LlmEvent => event.kind === "llm"));
	if (llm.length > 0) out.push(...threadName(modelTid, `${prefix}model`, sort));
	for (const event of llm)
		out.push(slice(event, event.model ?? "model call", modelTid, start, llmArgs(event)));
	const tools = byStart(events.filter((event): event is ToolEvent => event.kind === "tool"));
	const lanes = packLanes(tools);
	const named = new Set<number>();
	tools.forEach((event, index) => {
		const tid = firstToolTid + (lanes[index] ?? 0);
		if (!named.has(tid)) {
			named.add(tid);
			out.push(
				...threadName(
					tid,
					`${prefix}tools ${tid - firstToolTid + 1}`,
					sort + 1 + tid - firstToolTid,
				),
			);
		}
		toolTid.set(event.id, tid);
		out.push(slice(event, event.tool, tid, start, toolArgs(event)));
	});
	return toolTid;
}

/**
 * A session as a Chrome trace (pure, deterministic): the session is the process; its turns, model calls
 * and tool calls are threads — parallel tool calls on separate lanes —; each subagent run is a thread
 * of its own with its transcript's calls beside it and a flow from the spawning call; compactions and
 * model changes are instant events; the request context and pi's cumulative tokens and cost are
 * counters.
 */
export function chromeTrace(input: ChromeTraceInput): ChromeTrace {
	const { trace } = input;
	const start = trace.meta.start ?? 0;
	const out: ChromeTraceEvent[] = [
		{ name: "process_name", ph: "M", ts: 0, pid: PID, tid: 0, args: { name: input.title } },
		{ name: "process_sort_index", ph: "M", ts: 0, pid: PID, tid: 0, args: { sort_index: 0 } },
	];
	const turns = trace.events.filter((event) => event.kind === "turn");
	if (turns.length > 0) out.push(...threadName(TID_TURNS, "turns", 0));
	for (const event of turns) {
		if (event.kind !== "turn") continue;
		out.push(
			slice(event, `turn ${event.n}`, TID_TURNS, start, { n: event.n, trigger: event.trigger }),
		);
	}
	for (const event of trace.events) {
		if (event.kind !== "mark") continue;
		out.push({
			name: event.detail ? `${event.mark}: ${event.detail}` : event.mark,
			ph: "I",
			ts: micros(event.t0, start),
			pid: PID,
			tid: TID_TURNS,
			s: "p",
			cat: "mark",
			args: {
				...(event.label ? { label: event.label } : {}),
				...(event.tokensBefore !== undefined ? { tokensBefore: event.tokensBefore } : {}),
			},
		});
	}
	const toolTid = callThreads(trace.events, start, TID_MODEL, TID_TOOLS, "", 1, out);

	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const event of byStart(trace.events.filter((e): e is LlmEvent => e.kind === "llm"))) {
		const ts = micros(event.t0, start);
		const { input: inTokens, output, cacheRead, cacheWrite } = event.tokens;
		totals.input += inTokens;
		totals.output += output;
		totals.cacheRead += cacheRead;
		totals.cacheWrite += cacheWrite;
		totals.cost += event.cost;
		out.push(
			{
				name: "context",
				ph: "C",
				ts,
				pid: PID,
				tid: TID_MODEL,
				args: { tokens: inTokens + cacheRead + cacheWrite },
			},
			{
				name: "tokens",
				ph: "C",
				ts,
				pid: PID,
				tid: TID_MODEL,
				args: {
					input: totals.input,
					output: totals.output,
					cacheRead: totals.cacheRead,
					cacheWrite: totals.cacheWrite,
				},
			},
			{
				name: "cost",
				ph: "C",
				ts,
				pid: PID,
				tid: TID_MODEL,
				args: { usd: Math.round(totals.cost * 1e6) / 1e6 },
			},
		);
	}

	const byId = new Map(trace.events.map((event) => [event.id, event]));
	const runs = byStart(trace.events.filter((e): e is SubagentEvent => e.kind === "subagent"));
	runs.forEach((run, index) => {
		const tid = TID_SUBAGENTS + index * SUBAGENT_STRIDE;
		const name = `subagent ${index + 1}${run.role ? ` · ${run.role}` : ""}`;
		out.push(...threadName(tid, name, 100 + index * SUBAGENT_STRIDE));
		out.push(
			slice(run, run.role ?? "subagent", tid, start, {
				childId: run.childId,
				status: run.status,
				background: run.background === true,
				tokens: run.tokens,
				cost: run.cost,
			}),
		);
		const spawn = run.parent ? toolTid.get(run.parent) : undefined;
		const spawnEvent = run.parent ? byId.get(run.parent) : undefined;
		if (spawn !== undefined && spawnEvent) {
			const id = index + 1;
			out.push(
				{
					name: "spawn",
					ph: "s",
					ts: micros(spawnEvent.t0, start),
					pid: PID,
					tid: spawn,
					cat: "subagent",
					id,
				},
				{
					name: "spawn",
					ph: "f",
					bp: "e",
					ts: Math.max(micros(spawnEvent.t0, start), micros(run.t0, start)),
					pid: PID,
					tid,
					cat: "subagent",
					id,
				},
			);
		}
		const child = input.children.get(run.childId);
		if (child)
			callThreads(
				child.events,
				start,
				tid + 1,
				tid + 2,
				`${name} · `,
				101 + index * SUBAGENT_STRIDE,
				out,
			);
	});

	const ordered = out
		.map((event, order) => ({ event, order }))
		.sort(
			(a, b) =>
				(a.event.ph === "M" ? -1 : 0) - (b.event.ph === "M" ? -1 : 0) ||
				a.event.ts - b.event.ts ||
				PHASE_ORDER[a.event.ph] - PHASE_ORDER[b.event.ph] ||
				a.order - b.order,
		)
		.map(({ event }) => event);
	return {
		traceEvents: ordered,
		displayTimeUnit: "ms",
		otherData: {
			exportedBy: "session insights",
			sessionId: trace.sessionId,
			revision: trace.meta.revision,
			start: trace.meta.start === null ? null : new Date(trace.meta.start).toISOString(),
			...input.otherData,
		},
	};
}
