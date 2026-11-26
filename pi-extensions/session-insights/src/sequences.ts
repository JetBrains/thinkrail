import {
	ACTIVITIES,
	type Activity,
	type ActivityNode,
	type EdgeThreshold,
	type FailureRow,
	type FlowLink,
	type FlowNode,
	type FlowOutcome,
	type FlowState,
	type IndexState,
	METRIC_SOURCES,
	SEQUENCE_RULES,
	SESSION_INSIGHTS_API_VERSION,
	type SequenceCell,
	type SequenceChain,
	type SequenceExample,
	type SequenceFlow,
	type SequenceStep,
	type StatsSequences,
	type StatsSequencesParams,
	type StatsSequencesResult,
} from "./core.ts";
import {
	parseStatsParams,
	type ScopedSession,
	type StatsInput,
	statsScope,
} from "./crossSession.ts";
import type { SequenceStep as DigestStep } from "./digest.ts";
import { safeCut } from "./redact.ts";
import { byText } from "./stats.ts";

const K = ACTIVITIES.length;
const INDEX = new Map<Activity, number>(ACTIVITIES.map((activity, at) => [activity, at]));
const LABEL_CHARS = 100;
const FLOW_STATES: readonly FlowState[] = [
	"recovered",
	"repeatFailed",
	"notRun",
	"look",
	"edit",
	"run",
	"otherError",
	"other",
	"end",
];
const OUTCOMES: readonly FlowOutcome[] = ["recovered", "later", "never", "ended"];
/** States never grouped as rare: the ones the flow is about. */
const KEPT_STATES: readonly FlowState[] = ["recovered", "repeatFailed", "otherError", "end"];

/** `{ scope }` params of `stats.sequences`. */
export function parseSequencesParams(value: unknown): StatsSequencesParams {
	return parseStatsParams(value, "stats.sequences");
}

function cutLabel(label: string): string {
	if (label.length <= LABEL_CHARS) return label;
	const kept = [...label].slice(0, LABEL_CHARS - 1).join("");
	return `${kept.slice(0, safeCut(label, kept.length))}…`;
}

function stepOf(step: DigestStep): SequenceStep {
	return {
		eventId: step.eventId,
		tool: step.tool,
		activity: step.activity,
		label: cutLabel(step.label),
		failed: step.failed,
		...(step.missing ? { missing: true as const } : {}),
	};
}

function activityIndex(activity: Activity): number {
	return INDEX.get(activity) ?? K - 1;
}

/** What a call after a failure was, before merging repeats and grouping rare states. */
function stateOf(step: DigestStep, failed: DigestStep): FlowState {
	if (step.missing) return "notRun";
	if (step.key === failed.key && step.tool === failed.tool)
		return step.failed ? "repeatFailed" : "recovered";
	if (step.failed) return "otherError";
	switch (step.activity) {
		case "search":
		case "read":
			return "look";
		case "edit":
			return "edit";
		case "test":
		case "build":
		case "lint":
		case "git":
		case "run":
			return "run";
		default:
			return "other";
	}
}

interface Path {
	session: number;
	origin: string;
	states: FlowState[];
	outcome: FlowOutcome;
	key: string;
	tool: string;
	activity: Activity;
	/** Index of the failed call and of the call that recovered it (`-1` when none did in the window). */
	at: number;
	recoveredAt: number;
}

function followFailure(steps: readonly DigestStep[], at: number, session: number): Path {
	const failed = steps[at] as DigestStep;
	const states: FlowState[] = [];
	let next = at + 1;
	let terminal: "recovered" | "end" | null = null;
	let recoveredAt = -1;
	while (states.length < SEQUENCE_RULES.flowSteps) {
		const step = steps[next];
		if (!step) {
			states.push("end");
			terminal = "end";
			break;
		}
		const state = stateOf(step, failed);
		next += 1;
		if (states.at(-1) === state) continue;
		states.push(state);
		if (state === "recovered") {
			terminal = "recovered";
			recoveredAt = next - 1;
			break;
		}
	}
	while (states.length < SEQUENCE_RULES.flowSteps) states.push(states.at(-1) ?? "end");
	let outcome: FlowOutcome;
	if (terminal === "recovered") outcome = "recovered";
	else if (terminal === "end") outcome = "ended";
	else {
		outcome = "never";
		for (let later = next; later < steps.length; later++) {
			const step = steps[later] as DigestStep;
			if (step.key === failed.key && step.tool === failed.tool && !step.failed && !step.missing) {
				outcome = "later";
				break;
			}
		}
	}
	return {
		session,
		origin: failed.activity,
		states,
		outcome,
		key: failed.key,
		tool: failed.tool,
		activity: failed.activity,
		at,
		recoveredAt,
	};
}

function groupRare(paths: Path[]): void {
	const total = paths.length;
	const floor = total * SEQUENCE_RULES.flowRareShare;
	const origins = new Map<string, number>();
	for (const path of paths) origins.set(path.origin, (origins.get(path.origin) ?? 0) + 1);
	for (const path of paths) if ((origins.get(path.origin) ?? 0) < floor) path.origin = "other";
	for (let column = 0; column < SEQUENCE_RULES.flowSteps; column++) {
		const counts = new Map<FlowState, number>();
		for (const path of paths) {
			const state = path.states[column] as FlowState;
			counts.set(state, (counts.get(state) ?? 0) + 1);
		}
		for (const path of paths) {
			const state = path.states[column] as FlowState;
			if (!KEPT_STATES.includes(state) && (counts.get(state) ?? 0) < floor)
				path.states[column] = "other";
		}
	}
}

function keyAt(path: Path, column: number): string {
	if (column === 0) return path.origin;
	if (column <= SEQUENCE_RULES.flowSteps) return path.states[column - 1] as FlowState;
	return path.outcome;
}

function columnOrder(column: number): readonly string[] {
	if (column === 0) return ACTIVITIES;
	if (column <= SEQUENCE_RULES.flowSteps) return FLOW_STATES;
	return OUTCOMES;
}

function exampleOf(
	ready: readonly ScopedSession[],
	paths: readonly Path[],
	failing: readonly FailureRow[],
): SequenceFlow["example"] {
	const wanted = failing[0]?.key;
	const fits = (path: Path) =>
		path.recoveredAt >= 0 && path.recoveredAt - path.at < SEQUENCE_RULES.exampleSteps;
	const candidates = paths.filter((path) => fits(path) && path.key === wanted);
	const pick =
		candidates.find((path) => path.recoveredAt - path.at >= 2) ??
		candidates[0] ??
		paths.find((path) => fits(path) && path.recoveredAt - path.at >= 2) ??
		paths.find(fits);
	if (!pick) return null;
	const session = ready.find((entry) => entry.index === pick.session);
	if (!session) return null;
	const steps = session.digest.steps;
	const failed = steps[pick.at] as DigestStep;
	const out: (SequenceStep & { state: FlowState | null })[] = [];
	for (let at = pick.at; at <= pick.recoveredAt; at++) {
		const step = steps[at] as DigestStep;
		out.push({ ...stepOf(step), state: at === pick.at ? null : stateOf(step, failed) });
	}
	return { session: pick.session, steps: out };
}

function buildFlow(ready: readonly ScopedSession[]): SequenceFlow {
	const paths: Path[] = [];
	for (const session of ready) {
		const steps = session.digest.steps;
		steps.forEach((step, at) => {
			if (step.failed) paths.push(followFailure(steps, at, session.index));
		});
	}
	const rows = new Map<string, FailureRow & { sessionSet: Set<number> }>();
	for (const path of paths) {
		const id = `${path.tool}\u0000${path.key}`;
		let row = rows.get(id);
		if (!row) {
			row = {
				key: path.key,
				tool: path.tool,
				activity: path.activity,
				failures: 0,
				outcomes: { recovered: 0, later: 0, never: 0, ended: 0 },
				sessions: [],
				sessionSet: new Set(),
			};
			rows.set(id, row);
		}
		row.failures += 1;
		(row.outcomes as Record<FlowOutcome, number>)[path.outcome] += 1;
		row.sessionSet.add(path.session);
	}
	const failing: FailureRow[] = [...rows.values()]
		.sort((a, b) => b.failures - a.failures || byText(a.key, b.key))
		.slice(0, SEQUENCE_RULES.failuresShown)
		.map(({ sessionSet, ...row }) => ({
			...row,
			sessions: [...sessionSet].sort((a, b) => a - b),
		}));
	const example = exampleOf(ready, paths, failing);
	groupRare(paths);
	const columns: FlowNode[][] = [];
	for (let column = 0; column <= SEQUENCE_RULES.flowSteps + 1; column++) {
		const counts = new Map<string, number>();
		for (const path of paths) {
			const key = keyAt(path, column);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		columns.push(
			columnOrder(column)
				.filter((key) => counts.has(key))
				.map((key) => ({ key, count: counts.get(key) ?? 0 })),
		);
	}
	const links: FlowLink[] = [];
	for (let column = 0; column <= SEQUENCE_RULES.flowSteps; column++) {
		const counts = new Map<string, number>();
		for (const path of paths) {
			const id = `${keyAt(path, column)}\u0000${keyAt(path, column + 1)}`;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		const from = columnOrder(column);
		const to = columnOrder(column + 1);
		for (const source of from)
			for (const target of to) {
				const count = counts.get(`${source}\u0000${target}`);
				if (count) links.push({ column, source, target, count });
			}
	}
	return {
		failures: paths.length,
		sessions: new Set(paths.map((path) => path.session)).size,
		columns,
		links,
		failing,
		example,
	};
}

function buildChains(ready: readonly ScopedSession[]): { chains: SequenceChain[]; total: number } {
	const counts = new Map<string, number>();
	let total = 0;
	for (const session of ready) {
		const collapsed: number[] = [];
		for (const step of session.digest.steps) {
			const at = activityIndex(step.activity);
			if (collapsed.at(-1) !== at) collapsed.push(at);
		}
		for (let at = 0; at + SEQUENCE_RULES.chainSteps <= collapsed.length; at++) {
			const key = collapsed.slice(at, at + SEQUENCE_RULES.chainSteps).join(",");
			counts.set(key, (counts.get(key) ?? 0) + 1);
			total += 1;
		}
	}
	const chains = [...counts.entries()]
		.map(([key, count]) => ({ key, ids: key.split(",").map(Number), count }))
		.sort((a, b) => {
			if (b.count !== a.count) return b.count - a.count;
			for (let at = 0; at < a.ids.length; at++) {
				const delta = (a.ids[at] ?? 0) - (b.ids[at] ?? 0);
				if (delta !== 0) return delta;
			}
			return 0;
		})
		.slice(0, SEQUENCE_RULES.chainsShown)
		.map(({ ids, count }) => ({
			activities: ids.map((id) => ACTIVITIES[id] as Activity),
			count,
			share: total > 0 ? count / total : 0,
		}));
	return { chains, total };
}

/** The scope's transition matrix, process map, frequent chains and what follows a failed call. */
export function buildSequences(ready: readonly ScopedSession[]): StatsSequences {
	const counts = new Array<number>(K * K).fill(0);
	const afterError = new Array<number>(K * K).fill(0);
	const perSession = new Map<number, Map<number, number>>();
	const first = new Map<number, Map<number, number>>();
	const calls = new Array<number>(K).fill(0);
	const failed = new Array<number>(K).fill(0);
	const starts = new Array<number>(K).fill(0);
	const ends = new Array<number>(K).fill(0);
	let sessionsWithCalls = 0;
	for (const session of ready) {
		const steps = session.digest.steps;
		if (steps.length === 0) continue;
		sessionsWithCalls += 1;
		const head = activityIndex((steps[0] as DigestStep).activity);
		const tail = activityIndex((steps.at(-1) as DigestStep).activity);
		starts[head] = (starts[head] ?? 0) + 1;
		ends[tail] = (ends[tail] ?? 0) + 1;
		steps.forEach((step, at) => {
			const from = activityIndex(step.activity);
			calls[from] = (calls[from] ?? 0) + 1;
			if (step.failed) failed[from] = (failed[from] ?? 0) + 1;
			const next = steps[at + 1];
			if (!next) return;
			const cell = from * K + activityIndex(next.activity);
			counts[cell] = (counts[cell] ?? 0) + 1;
			if (step.failed) afterError[cell] = (afterError[cell] ?? 0) + 1;
			let sessions = perSession.get(cell);
			if (!sessions) {
				sessions = new Map();
				perSession.set(cell, sessions);
			}
			sessions.set(session.index, (sessions.get(session.index) ?? 0) + 1);
			let firsts = first.get(cell);
			if (!firsts) {
				firsts = new Map();
				first.set(cell, firsts);
			}
			if (!firsts.has(session.index)) firsts.set(session.index, at);
		});
	}
	const rowSum = ACTIVITIES.map((_, from) => {
		let sum = 0;
		for (let to = 0; to < K; to++) sum += counts[from * K + to] ?? 0;
		return sum;
	});
	const transitions = rowSum.reduce((sum, value) => sum + value, 0);
	const present = ACTIVITIES.map((_, at) => at).filter((at) => (calls[at] ?? 0) > 0);
	const bySession = new Map(ready.map((session) => [session.index, session]));
	const cells: SequenceCell[] = [];
	for (const from of present)
		for (const to of present) {
			const cell = from * K + to;
			const count = counts[cell] ?? 0;
			if (count === 0) continue;
			const sessions = [...(perSession.get(cell) ?? new Map<number, number>()).entries()];
			const firsts = first.get(cell);
			const top = [...sessions]
				.sort((a, b) => b[1] - a[1] || a[0] - b[0])
				.slice(0, SEQUENCE_RULES.cellSessions)
				.map(([session, times]) => ({
					session,
					count: times,
					eventId: bySession.get(session)?.digest.steps[firsts?.get(session) ?? 0]?.eventId ?? "",
				}));
			const lead = top[0];
			let example: SequenceExample | null = null;
			const at = lead ? firsts?.get(lead.session) : undefined;
			const steps = lead ? bySession.get(lead.session)?.digest.steps : undefined;
			if (lead && at !== undefined && steps) {
				const lo = Math.max(0, at - 1);
				const hi = Math.min(steps.length - 1, at + 2);
				example = {
					session: lead.session,
					steps: steps
						.slice(lo, hi + 1)
						.map((step, k) => ({ ...stepOf(step), pair: lo + k === at || lo + k === at + 1 })),
				};
			}
			const errors = afterError[cell] ?? 0;
			cells.push({
				source: ACTIVITIES[from] as Activity,
				target: ACTIVITIES[to] as Activity,
				count,
				share: count / (rowSum[from] || 1),
				afterError: errors,
				errorMark: errors / count >= SEQUENCE_RULES.errorMarkShare,
				top,
				sessions: sessions.map(([session]) => session).sort((a, b) => a - b),
				example,
			});
		}
	const nodes: ActivityNode[] = present.map((at) => ({
		activity: ACTIVITIES[at] as Activity,
		calls: calls[at] ?? 0,
		failed: failed[at] ?? 0,
		starts: starts[at] ?? 0,
		ends: ends[at] ?? 0,
		transitions: rowSum[at] ?? 0,
	}));
	const thresholds: EdgeThreshold[] = SEQUENCE_RULES.edgeShares.map((share) => {
		const min = Math.max(1, Math.ceil(transitions * share));
		const shown = new Set<Activity>();
		let hiddenEdges = 0;
		let hiddenTransitions = 0;
		for (const cell of cells) {
			if (cell.count >= min) {
				shown.add(cell.source);
				shown.add(cell.target);
			} else {
				hiddenEdges += 1;
				hiddenTransitions += cell.count;
			}
		}
		return {
			share,
			min,
			hiddenEdges,
			hiddenTransitions,
			hiddenNodes: nodes.map((node) => node.activity).filter((activity) => !shown.has(activity)),
		};
	});
	const { chains, total } = buildChains(ready);
	return {
		activities: nodes.map((node) => node.activity),
		nodes,
		cells,
		calls: calls.reduce((sum, value) => sum + value, 0),
		failed: failed.reduce((sum, value) => sum + value, 0),
		transitions,
		sessionsWithCalls,
		thresholds,
		chains,
		chainTotal: total,
		flow: buildFlow(ready),
		rules: SEQUENCE_RULES,
	};
}

/** `stats.sequences`: the scope's action sequences from the sessions' digests. */
export async function buildStatsSequences(
	input: StatsInput,
	state: IndexState,
): Promise<StatsSequencesResult> {
	const scope = await statsScope(input, state);
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		digests: scope.progress,
		sessions: scope.sessions,
		sequences: buildSequences(scope.ready),
		sources: METRIC_SOURCES,
	};
}
