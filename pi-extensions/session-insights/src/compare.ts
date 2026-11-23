import {
	COMPARE_RULES,
	type CompareDirection,
	type CompareMetric,
	type CompareMetricId,
	type CompareStat,
	type CompareVerdict,
	type IndexState,
	type ListProject,
	METRIC_SOURCES,
	type Origin,
	SESSION_INSIGHTS_API_VERSION,
	type SliceBy,
	type SliceConfound,
	type SliceOption,
	type SliceSide,
	type SlicesCompare,
	type SlicesCompareParams,
	type SlicesCompareResult,
} from "./core.ts";
import { type ScopedSession, type StatsInput, statsScope } from "./crossSession.ts";
import { localDay } from "./day.ts";
import { parseSessionsListParams } from "./list.ts";
import { type BootStat, bootstrapDifference, byText, seedOf, statOf } from "./stats.ts";
import { isRecord } from "./totals.ts";

const BY: readonly SliceBy[] = ["model", "period", "project", "label", "filter"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_CHARS = 200;

/** `{ scope, by, a?, b? }` of `slices.compare`; a period's `a` is a `YYYY-MM-DD` day. */
export function parseCompareParams(value: unknown): SlicesCompareParams {
	const fail = () => new Error("Invalid slices.compare params");
	if (!isRecord(value)) throw fail();
	let scope: SlicesCompareParams["scope"];
	try {
		scope = parseSessionsListParams(value).scope;
	} catch {
		throw fail();
	}
	const by = value.by;
	if (typeof by !== "string" || !(BY as readonly string[]).includes(by)) throw fail();
	const out: SlicesCompareParams = { scope, by: by as SliceBy };
	for (const side of ["a", "b"] as const) {
		const text = value[side];
		if (text === undefined) continue;
		if (typeof text !== "string" || text.length > TEXT_CHARS) throw fail();
		out[side] = text;
	}
	if (out.by === "period" && out.a !== undefined && !DAY.test(out.a)) throw fail();
	return out;
}

/** The model of most of a session's recorded model calls (ties: the alphabetically first). */
export function mainModel(session: ScopedSession): string | null {
	let best: string | null = null;
	let calls = 0;
	for (const [model, use] of [...session.digest.models.entries()].sort((x, y) =>
		byText(x[0], y[0]),
	)) {
		if (!model || use.calls <= calls) continue;
		best = model;
		calls = use.calls;
	}
	return best;
}

interface MetricSpec {
	id: CompareMetricId;
	stat: CompareStat;
	direction: CompareDirection;
	origin: Origin;
	/** A session's value (and a ratio's denominator); `null` when it has none. */
	value: (session: ScopedSession) => { value: number; weight?: number } | null;
}

const present = (value: number | null) => (value === null ? null : { value });

const METRICS: readonly MetricSpec[] = [
	{
		id: "failedShare",
		stat: "ratio",
		direction: "lower",
		origin: "counted",
		value: ({ row }) => {
			const calls = row.toolCalls.value ?? 0;
			return calls > 0 ? { value: row.toolErrors.value ?? 0, weight: calls } : null;
		},
	},
	{
		id: "toolCalls",
		stat: "median",
		direction: "neutral",
		origin: "counted",
		value: ({ row }) => present(row.toolCalls.value),
	},
	{
		id: "turns",
		stat: "median",
		direction: "neutral",
		origin: "counted",
		value: ({ digest }) => ({ value: digest.turns }),
	},
	{
		id: "tokens",
		stat: "median",
		direction: "lower",
		origin: "recorded",
		value: ({ row }) => present(row.tokens.value?.total ?? null),
	},
	{
		id: "cost",
		stat: "median",
		direction: "lower",
		origin: "recorded",
		value: ({ row }) => (row.cost.origin === "recorded" ? present(row.cost.value) : null),
	},
	{
		id: "activeTime",
		stat: "median",
		direction: "lower",
		origin: "approximated",
		value: ({ row }) => present(row.activeMs.value),
	},
	{
		id: "retries",
		stat: "mean",
		direction: "lower",
		origin: "approximated",
		value: ({ digest }) => ({ value: digest.retries }),
	},
	{
		id: "contextPeak",
		stat: "median",
		direction: "lower",
		origin: "recorded",
		value: ({ digest }) => (digest.peak.tokens > 0 ? { value: digest.peak.tokens } : null),
	},
];

function textOf(session: ScopedSession): string {
	return `${session.row.title ?? ""}\n${session.row.firstPrompt ?? ""}`.toLowerCase();
}

function dayOf(session: ScopedSession): string | null {
	const start = session.row.start.value;
	return start === null ? null : localDay(start);
}

function countBy<T>(items: readonly T[], key: (item: T) => string | null): SliceOption[] {
	const counts = new Map<string, number>();
	for (const item of items) {
		const id = key(item);
		if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
		.map(([id, sessions]) => ({ key: id, name: null, sessions }));
}

/** The day that splits the sessions in half (the upper middle one's), moved to the next day with a session when it is the first one. */
function defaultSplitDay(ready: readonly ScopedSession[]): string {
	const days = ready
		.map(dayOf)
		.filter((day): day is string => day !== null)
		.sort();
	const middle = days[Math.floor(days.length / 2)] ?? "";
	if (middle !== days[0]) return middle;
	return days.find((day) => day > middle) ?? middle;
}

interface Sides {
	a: string;
	b: string;
	inA: (session: ScopedSession) => boolean;
	inB: (session: ScopedSession) => boolean;
}

type LabelsOf = (sessionId: string) => readonly string[];

function hasLabel(labelsOf: LabelsOf, label: string): (session: ScopedSession) => boolean {
	const wanted = label.toLocaleLowerCase("en");
	return (session) =>
		wanted !== "" &&
		labelsOf(session.row.sessionId).some((item) => item.toLocaleLowerCase("en") === wanted);
}

function sidesOf(
	params: SlicesCompareParams,
	ready: readonly ScopedSession[],
	options: {
		models: readonly SliceOption[];
		projects: readonly SliceOption[];
		labels: readonly SliceOption[];
	},
	labelsOf: LabelsOf,
): Sides {
	const { models, projects, labels } = options;
	switch (params.by) {
		case "model": {
			const a = params.a ?? models[0]?.key ?? "";
			const b = params.b ?? models.find((option) => option.key !== a)?.key ?? "";
			return { a, b, inA: (s) => mainModel(s) === a, inB: (s) => mainModel(s) === b };
		}
		case "project": {
			const a = params.a ?? projects[0]?.key ?? "";
			const b = params.b ?? projects.find((option) => option.key !== a)?.key ?? "";
			const projectOf = (s: ScopedSession) => s.row.projectId ?? "";
			return { a, b, inA: (s) => projectOf(s) === a, inB: (s) => projectOf(s) === b };
		}
		case "period": {
			const a = params.a ?? defaultSplitDay(ready);
			return {
				a,
				b: "",
				inA: (s) => {
					const day = dayOf(s);
					return day !== null && day < a;
				},
				inB: (s) => {
					const day = dayOf(s);
					return day !== null && day >= a;
				},
			};
		}
		case "label": {
			const a = (params.a ?? labels[0]?.key ?? "").trim();
			const b = (params.b ?? labels.find((option) => option.key !== a)?.key ?? "").trim();
			const inA = hasLabel(labelsOf, a);
			return { a, b, inA, inB: b === "" ? (s) => a !== "" && !inA(s) : hasLabel(labelsOf, b) };
		}
		case "filter": {
			const a = (params.a ?? "").trim();
			const b = (params.b ?? "").trim();
			const matches = (text: string) => (s: ScopedSession) =>
				text !== "" && textOf(s).includes(text.toLowerCase());
			const inA = matches(a);
			return { a, b, inA, inB: b === "" ? (s) => a !== "" && !inA(s) : matches(b) };
		}
	}
}

function side(key: string, name: string | null, sessions: readonly ScopedSession[]): SliceSide {
	const starts = sessions
		.map((session) => session.row.start.value)
		.filter((start): start is number => start !== null);
	return {
		key,
		name,
		sessions: sessions.map((session) => session.index),
		first: starts.length > 0 ? Math.min(...starts) : null,
		last: starts.length > 0 ? Math.max(...starts) : null,
	};
}

function distance(
	a: readonly ScopedSession[],
	b: readonly ScopedSession[],
	key: (session: ScopedSession) => string,
): { distance: number; a: string | null; b: string | null } {
	const share = (sessions: readonly ScopedSession[]) => {
		const counts = new Map<string, number>();
		for (const session of sessions) counts.set(key(session), (counts.get(key(session)) ?? 0) + 1);
		return counts;
	};
	const left = share(a);
	const right = share(b);
	let total = 0;
	for (const id of new Set([...left.keys(), ...right.keys()]))
		total += Math.abs((left.get(id) ?? 0) / a.length - (right.get(id) ?? 0) / b.length);
	const lead = (counts: Map<string, number>) =>
		[...counts.entries()].sort((x, y) => y[1] - x[1] || byText(x[0], y[0]))[0]?.[0] ?? null;
	return { distance: total / 2, a: lead(left), b: lead(right) };
}

/** Whether the slices also differ in time or in task mix (projects, main models) — the note's facts. */
export function confoundsOf(
	by: SliceBy,
	a: readonly ScopedSession[],
	b: readonly ScopedSession[],
	sideA: SliceSide,
	sideB: SliceSide,
	projectName: (id: string) => string | null,
): SliceConfound[] {
	const out: SliceConfound[] = [];
	if (a.length === 0 || b.length === 0) return out;
	if (
		by !== "period" &&
		sideA.first !== null &&
		sideA.last !== null &&
		sideB.first !== null &&
		sideB.last !== null
	) {
		const overlap = Math.min(sideA.last, sideB.last) - Math.max(sideA.first, sideB.first);
		const shorter = Math.min(sideA.last - sideA.first, sideB.last - sideB.first);
		const apart = shorter > 0 ? overlap < COMPARE_RULES.timeOverlap * shorter : overlap < 0;
		if (apart)
			out.push({
				kind: "time",
				a: { first: sideA.first, last: sideA.last },
				b: { first: sideB.first, last: sideB.last },
			});
	}
	if (by !== "project") {
		const mix = distance(a, b, (session) => session.row.projectId ?? "");
		if (mix.distance >= COMPARE_RULES.mixDistance)
			out.push({
				kind: "projects",
				distance: mix.distance,
				a: mix.a === null ? null : projectName(mix.a),
				b: mix.b === null ? null : projectName(mix.b),
			});
	}
	if (by !== "model") {
		const mix = distance(a, b, (session) => mainModel(session) ?? "");
		if (mix.distance >= COMPARE_RULES.mixDistance)
			out.push({ kind: "models", distance: mix.distance, a: mix.a || null, b: mix.b || null });
	}
	return out;
}

function verdictOf(
	spec: MetricSpec,
	delta: number | null,
	interval: { low: number; high: number } | null,
): CompareVerdict {
	if (delta === null || !interval) return "noData";
	if (interval.low <= 0 && interval.high >= 0) return "same";
	const up = interval.low > 0;
	if (spec.direction === "neutral") return up ? "higher" : "lower";
	return up ? "worse" : "better";
}

function sampleOf(spec: MetricSpec, sessions: readonly ScopedSession[]) {
	const indices: number[] = [];
	const values: number[] = [];
	const weights: number[] = [];
	const shown: number[] = [];
	for (const session of sessions) {
		const point = spec.value(session);
		if (!point) continue;
		indices.push(session.index);
		values.push(point.value);
		weights.push(point.weight ?? 1);
		shown.push(point.weight ? point.value / point.weight : point.value);
	}
	return { indices, values, weights, shown };
}

async function compareMetric(
	spec: MetricSpec,
	a: readonly ScopedSession[],
	b: readonly ScopedSession[],
	definition: string,
): Promise<CompareMetric> {
	const left = sampleOf(spec, a);
	const right = sampleOf(spec, b);
	const kind = spec.stat as BootStat;
	const statA = statOf(kind, { values: left.values, weights: left.weights });
	const statB = statOf(kind, { values: right.values, weights: right.weights });
	const delta = statA !== null && statB !== null ? statB - statA : null;
	const relative = delta !== null && statA ? delta / Math.abs(statA) : null;
	const enough =
		left.values.length >= COMPARE_RULES.minSessions &&
		right.values.length >= COMPARE_RULES.minSessions;
	let interval: { low: number; high: number } | null = null;
	let verdict: CompareVerdict;
	if (left.values.length === 0 || right.values.length === 0) verdict = "noData";
	else if (!enough) verdict = "tooFew";
	else {
		interval = await bootstrapDifference(
			kind,
			{ values: left.values, weights: left.weights },
			{ values: right.values, weights: right.weights },
			{
				resamples: COMPARE_RULES.resamples,
				seed: seedOf(`${definition}\u0000${spec.id}`),
				level: COMPARE_RULES.level,
			},
		);
		verdict = verdictOf(spec, delta, interval);
	}
	return {
		id: spec.id,
		stat: spec.stat,
		direction: spec.direction,
		a: { value: statA, origin: spec.origin },
		b: { value: statB, origin: spec.origin },
		delta,
		relative,
		low: interval?.low ?? null,
		high: interval?.high ?? null,
		verdict,
		sampleA: { sessions: left.indices, values: left.shown },
		sampleB: { sessions: right.indices, values: right.shown },
	};
}

/** Each label on the scope's sessions with its sessions, most first (one spelling per label, case-insensitively). */
function labelOptions(ready: readonly ScopedSession[], labelsOf: LabelsOf): SliceOption[] {
	const counts = new Map<string, { key: string; sessions: number }>();
	for (const session of ready)
		for (const label of labelsOf(session.row.sessionId)) {
			const lower = label.toLocaleLowerCase("en");
			const count = counts.get(lower);
			if (count) count.sessions += 1;
			else counts.set(lower, { key: label, sessions: 1 });
		}
	return [...counts.values()]
		.sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key, "en"))
		.map(({ key, sessions }) => ({ key, name: null, sessions }));
}

/** Two slices of the scope's sessions, metric by metric, with seeded bootstrap intervals. */
export async function compareSlices(
	ready: readonly ScopedSession[],
	params: SlicesCompareParams,
	projects: readonly ListProject[],
	labelsOf: LabelsOf = () => [],
): Promise<SlicesCompare> {
	const nameOf = (id: string) => projects.find((project) => project.id === id)?.name ?? null;
	const models = countBy(ready, mainModel);
	const projectOptions = countBy(ready, (session) => session.row.projectId ?? "").map((option) => ({
		...option,
		name: option.key ? nameOf(option.key) : null,
	}));
	const labels = labelOptions(ready, labelsOf);
	const sides = sidesOf(params, ready, { models, projects: projectOptions, labels }, labelsOf);
	const inA = ready.filter(sides.inA);
	const inB = ready.filter(sides.inB);
	const named = (key: string) => (params.by === "project" && key ? nameOf(key) : null);
	const sideA = side(sides.a, named(sides.a), inA);
	const sideB = side(sides.b, named(sides.b), inB);
	const definition = [params.by, sides.a, sides.b].join("\u0000");
	const metrics: CompareMetric[] = [
		{
			id: "sessions",
			stat: "count",
			direction: "neutral",
			a: { value: inA.length, origin: "counted" },
			b: { value: inB.length, origin: "counted" },
			delta: inB.length - inA.length,
			relative: inA.length > 0 ? (inB.length - inA.length) / inA.length : null,
			low: null,
			high: null,
			verdict: "none",
			sampleA: { sessions: sideA.sessions, values: [] },
			sampleB: { sessions: sideB.sessions, values: [] },
		},
	];
	for (const spec of METRICS) metrics.push(await compareMetric(spec, inA, inB, definition));
	const days = ready
		.map(dayOf)
		.filter((day): day is string => day !== null)
		.sort();
	return {
		by: params.by,
		a: sideA,
		b: sideB,
		metrics,
		confounds: confoundsOf(params.by, inA, inB, sideA, sideB, nameOf),
		distinguishable: metrics.filter(
			(metric) =>
				metric.low !== null && metric.high !== null && (metric.low > 0 || metric.high < 0),
		).length,
		options: {
			models,
			projects: projectOptions,
			labels,
			days: days.length > 0 ? { first: days[0] ?? "", last: days.at(-1) ?? "" } : null,
		},
		rules: COMPARE_RULES,
	};
}

/** `slices.compare`: two slices of the scope's sessions from their digests. */
export async function buildSlicesCompare(
	input: StatsInput,
	state: IndexState,
	params: SlicesCompareParams,
): Promise<SlicesCompareResult> {
	const scope = await statsScope(input, state);
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		digests: scope.progress,
		sessions: scope.sessions,
		compare: await compareSlices(scope.ready, params, input.projects, input.labelsOf),
		sources: METRIC_SOURCES,
	};
}
