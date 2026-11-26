import {
	type Figure,
	type IndexState,
	type ListProject,
	METRIC_SOURCES,
	type Origin,
	SESSION_INSIGHTS_API_VERSION,
	SPARK_POINTS,
	type StatsUsage,
	type StatsUsageResult,
	type TokenTotals,
	USAGE_CHART_SERIES,
	USAGE_COMMANDS,
	type UsageMarker,
	type UsageModelRow,
	type UsageProjectRow,
	type UsageRoleRow,
	type UsageSeries,
	type UsageSeriesKind,
	type UsageSkillRow,
	type UsageToolRow,
} from "./core.ts";
import { type ScopedSession, type StatsInput, statsScope } from "./crossSession.ts";
import { localDay } from "./day.ts";
import type { ToolDigest } from "./digest.ts";
import { byText, dayRange, mean, median, wilson } from "./stats.ts";
import { costOrigin, emptySpend, type SpendTotals, tokensOf, tokenTotals } from "./totals.ts";

const CHARS_PER_TOKEN = 4;

function slot<K, V>(map: Map<K, V>, key: K, create: () => V): V {
	let value = map.get(key);
	if (value === undefined) {
		value = create();
		map.set(key, value);
	}
	return value;
}

function sum(into: SpendTotals, from: SpendTotals): void {
	into.input += from.input;
	into.output += from.output;
	into.cacheRead += from.cacheRead;
	into.cacheWrite += from.cacheWrite;
	into.cost += from.cost;
	into.unpricedTokens += from.unpricedTokens;
}

function counted(value: number): Figure {
	return { value, origin: "counted" };
}

/** Days and how they fold into sparkline points. */
class Calendar {
	readonly days: string[];
	readonly at: Map<string, number>;
	readonly step: number;
	readonly points: number;

	constructor(days: readonly string[]) {
		this.days = days.length > 0 ? dayRange(days[0] ?? "", days.at(-1) ?? "") : [];
		this.at = new Map(this.days.map((day, index) => [day, index]));
		this.step = Math.max(1, Math.ceil(this.days.length / SPARK_POINTS));
		this.points = Math.ceil(this.days.length / this.step);
	}

	zeros(): number[] {
		return new Array<number>(this.days.length).fill(0);
	}

	spark(perDay: ReadonlyMap<string, number>): number[] {
		const out = new Array<number>(this.points).fill(0);
		for (const [day, value] of perDay) {
			const index = this.at.get(day);
			if (index !== undefined) {
				const point = Math.floor(index / this.step);
				out[point] = (out[point] ?? 0) + value;
			}
		}
		return out;
	}
}

interface SeriesDraft {
	key: string;
	kind: UsageSeriesKind;
	name: string | null;
	tokens: number[];
	cost: number[];
	spend: SpendTotals;
}

function draft(calendar: Calendar, key: string, kind: UsageSeriesKind, name: string | null) {
	return { key, kind, name, tokens: calendar.zeros(), cost: calendar.zeros(), spend: emptySpend() };
}

function addDay(series: SeriesDraft, index: number, spend: SpendTotals): void {
	series.tokens[index] = (series.tokens[index] ?? 0) + tokensOf(spend);
	series.cost[index] = (series.cost[index] ?? 0) + spend.cost;
	sum(series.spend, spend);
}

function finish(series: SeriesDraft): UsageSeries {
	return {
		key: series.key,
		kind: series.kind,
		name: series.name,
		tokens: series.tokens,
		cost: series.cost,
		totalTokens: tokensOf(series.spend),
		totalCost: series.spend.cost,
		costOrigin: costOrigin(series.spend),
	};
}

function byTokens(a: SeriesDraft, b: SeriesDraft): number {
	return (
		tokensOf(b.spend) - tokensOf(a.spend) || b.spend.cost - a.spend.cost || byText(a.key, b.key)
	);
}

function modelSeries(calendar: Calendar, sessions: readonly ScopedSession[]): UsageSeries[] {
	const models = new Map<string, SeriesDraft>();
	const subagents = draft(calendar, "subagents", "subagents", null);
	const other = draft(calendar, "other", "other", null);
	for (const { digest } of sessions)
		for (const [day, bucket] of digest.days) {
			const index = calendar.at.get(day);
			if (index === undefined) continue;
			for (const [model, spend] of bucket.models)
				addDay(
					slot(models, model, () => draft(calendar, model, "model", null)),
					index,
					spend,
				);
			addDay(subagents, index, bucket.subagents);
			addDay(other, index, bucket.other);
		}
	const out = capped(calendar, [...models.values()], "otherModels");
	for (const series of [subagents, other]) if (tokensOf(series.spend) > 0) out.push(series);
	return out.map(finish);
}

/** The largest `USAGE_CHART_SERIES` series, the rest stacked as one. */
function capped(
	calendar: Calendar,
	all: readonly SeriesDraft[],
	restKind: "otherModels" | "otherProjects",
): SeriesDraft[] {
	const ranked = all.filter((series) => tokensOf(series.spend) > 0).sort(byTokens);
	const out = ranked.slice(0, USAGE_CHART_SERIES);
	const rest = ranked.slice(USAGE_CHART_SERIES);
	if (rest.length === 0) return out;
	const merged = draft(calendar, restKind, restKind, null);
	for (const series of rest) {
		series.tokens.forEach((tokens, index) => {
			merged.tokens[index] = (merged.tokens[index] ?? 0) + tokens;
			merged.cost[index] = (merged.cost[index] ?? 0) + (series.cost[index] ?? 0);
		});
		sum(merged.spend, series.spend);
	}
	return [...out, merged];
}

function projectSeries(
	calendar: Calendar,
	sessions: readonly ScopedSession[],
	projects: readonly ListProject[],
): UsageSeries[] {
	const names = new Map(projects.map((project) => [project.id, project.name]));
	const out = new Map<string, SeriesDraft>();
	for (const { row, digest } of sessions) {
		const key = row.projectId ?? "";
		const series = slot(out, key, () =>
			draft(calendar, key, "project", row.projectId ? (names.get(row.projectId) ?? null) : null),
		);
		for (const [day, bucket] of digest.days) {
			const index = calendar.at.get(day);
			if (index === undefined) continue;
			for (const spend of bucket.models.values()) addDay(series, index, spend);
			addDay(series, index, bucket.subagents);
			addDay(series, index, bucket.other);
		}
	}
	return capped(calendar, [...out.values()], "otherProjects").map(finish);
}

function outsideSeries(calendar: Calendar, sessions: readonly ScopedSession[]): UsageSeries | null {
	const series = draft(calendar, "outside", "outside", null);
	for (const { digest, join, summary } of sessions) {
		for (const child of join?.children ?? []) {
			const day =
				digest.childDays.get(child.childId) ??
				(summary.start === null ? null : localDay(summary.start));
			const index = day === null ? undefined : calendar.at.get(day);
			if (index === undefined) continue;
			series.tokens[index] = (series.tokens[index] ?? 0) + child.tokens;
			series.cost[index] = (series.cost[index] ?? 0) + child.cost;
			series.spend.input += child.tokens;
			series.spend.cost += child.cost;
		}
	}
	return tokensOf(series.spend) > 0 ? finish(series) : null;
}

function markers(calendar: Calendar, byModel: readonly UsageSeries[], outside: UsageSeries | null) {
	const out: UsageMarker[] = [];
	const pricedBefore = (index: number) =>
		byModel.some((series) => series.cost.slice(0, index).some((cost) => cost > 0));
	for (const series of byModel) {
		if (series.kind !== "model") continue;
		const active = series.tokens.flatMap((tokens, index) => (tokens > 0 ? [index] : []));
		const first = active[0];
		if (first === undefined) continue;
		if (series.totalCost === 0) {
			if (pricedBefore(first))
				out.push({ day: calendar.days[first] ?? "", kind: "unpricedModel", model: series.key });
			continue;
		}
		let lastPriced = -1;
		series.cost.forEach((cost, index) => {
			if (cost > 0) lastPriced = index;
		});
		const stopped = active.find((index) => index > lastPriced);
		if (stopped !== undefined)
			out.push({ day: calendar.days[stopped] ?? "", kind: "costStopped", model: series.key });
	}
	const subagents = byModel.find((series) => series.kind === "subagents");
	const firstSubagent = [subagents, outside]
		.flatMap((series) => {
			const index = series?.tokens.findIndex((tokens) => tokens > 0) ?? -1;
			return index >= 0 ? [index] : [];
		})
		.sort((a, b) => a - b)[0];
	if (firstSubagent !== undefined)
		out.push({ day: calendar.days[firstSubagent] ?? "", kind: "subagentSpend", model: null });
	const spent = [...byModel, ...(outside ? [outside] : [])];
	const secondDay = calendar.days.filter((_, index) =>
		spent.some((series) => (series.tokens[index] ?? 0) > 0),
	)[1];
	return out
		.filter((marker) => secondDay !== undefined && byText(marker.day, secondDay) >= 0)
		.sort((a, b) => byText(a.day, b.day) || byText(a.kind, b.kind));
}

function durationFigure(value: number | null, origin: Origin = "recorded"): Figure {
	return value === null ? { value: null, origin: "notMeasured" } : { value, origin };
}

interface ToolDraft {
	tool: ToolDigest;
	sessions: number[];
	durations: number[];
	days: Map<string, number>;
}

function toolRows(
	calendar: Calendar,
	entries: readonly { session: number; key: string; digest: ToolDigest }[],
): UsageToolRow[] {
	const drafts = new Map<string, ToolDraft>();
	for (const { session, key, digest } of entries) {
		const row = slot(drafts, key, () => ({
			tool: {
				...digest,
				calls: 0,
				errors: 0,
				notRun: 0,
				durations: [],
				days: new Map(),
				last: null,
			},
			sessions: [],
			durations: [],
			days: new Map(),
		}));
		row.tool.calls += digest.calls;
		row.tool.errors += digest.errors;
		row.tool.notRun += digest.notRun;
		row.tool.last = Math.max(row.tool.last ?? 0, digest.last ?? 0) || null;
		row.durations.push(...digest.durations);
		for (const [day, calls] of digest.days) row.days.set(day, (row.days.get(day) ?? 0) + calls);
		row.sessions.push(session);
	}
	return [...drafts]
		.map(([name, row]) => ({
			name,
			family: row.tool.family,
			calls: counted(row.tool.calls),
			errors: counted(row.tool.errors),
			notRun: row.tool.notRun,
			errorRate: wilson(row.tool.errors, row.tool.calls - row.tool.notRun),
			sessions: [...new Set(row.sessions)].sort((a, b) => a - b),
			durationAvg: durationFigure(mean(row.durations)),
			durationP50: durationFigure(median(row.durations)),
			measured: row.durations.length,
			last: row.tool.last,
			perDay: calendar.spark(row.days),
		}))
		.sort((a, b) => (b.calls.value ?? 0) - (a.calls.value ?? 0) || byText(a.name, b.name));
}

async function modelRows(
	calendar: Calendar,
	sessions: readonly ScopedSession[],
	input: StatsInput,
): Promise<UsageModelRow[]> {
	const drafts = new Map<
		string,
		{
			spend: SpendTotals;
			calls: number;
			errors: number;
			latencies: number[];
			peak: number;
			catalog: { provider: string; id: string } | null;
			sessions: number[];
			days: Map<string, number>;
		}
	>();
	for (const { index, digest } of sessions) {
		for (const [model, use] of digest.models) {
			const row = slot(drafts, model, () => ({
				spend: emptySpend(),
				calls: 0,
				errors: 0,
				latencies: [],
				peak: 0,
				catalog: null,
				sessions: [],
				days: new Map(),
			}));
			sum(row.spend, use.spend);
			row.calls += use.calls;
			row.errors += use.errors;
			row.latencies.push(...use.latencies);
			row.peak = Math.max(row.peak, use.peak);
			row.catalog ??= use.catalog;
			row.sessions.push(index);
		}
		for (const [day, bucket] of digest.days)
			for (const [model, spend] of bucket.models) {
				const row = drafts.get(model);
				if (row) row.days.set(day, (row.days.get(day) ?? 0) + tokensOf(spend));
			}
	}
	const rows: UsageModelRow[] = [];
	for (const [model, row] of drafts) {
		const host = row.catalog
			? await (input.contextWindow?.(row.catalog.provider, row.catalog.id) ?? null)
			: null;
		const window: Figure =
			host !== null && host >= row.peak
				? { value: host, origin: "host" }
				: row.peak > 0
					? { value: row.peak, origin: "approximated" }
					: { value: null, origin: "notMeasured" };
		const context = row.spend.input + row.spend.cacheRead + row.spend.cacheWrite;
		rows.push({
			model,
			calls: counted(row.calls),
			errors: counted(row.errors),
			errorRate: wilson(row.errors, row.calls),
			tokens: { value: tokenTotals(row.spend), origin: "recorded" },
			cost: { value: row.spend.cost, origin: costOrigin(row.spend) },
			cacheShare:
				context > 0
					? { value: row.spend.cacheRead / context, origin: "counted" }
					: { value: null, origin: "notMeasured" },
			latencyP50: durationFigure(median(row.latencies)),
			measured: row.latencies.length,
			contextWindow: window,
			sessions: [...new Set(row.sessions)].sort((a, b) => a - b),
			perDay: calendar.spark(row.days),
		});
	}
	return rows.sort(
		(a, b) =>
			(b.tokens.value?.total ?? 0) - (a.tokens.value?.total ?? 0) || byText(a.model, b.model),
	);
}

function projectRows(
	calendar: Calendar,
	sessions: readonly ScopedSession[],
	projects: readonly ListProject[],
): UsageProjectRow[] {
	const names = new Map(projects.map((project) => [project.id, project.name]));
	const drafts = new Map<
		string,
		{
			projectId: string | null;
			spend: SpendTotals;
			outside: { cost: number; tokens: number };
			unmeasured: boolean;
			models: Map<string, number>;
			sessions: number[];
			days: Map<string, number>;
		}
	>();
	for (const { index, row, digest, join } of sessions) {
		const draftRow = slot(drafts, row.projectId ?? "", () => ({
			projectId: row.projectId,
			spend: emptySpend(),
			outside: { cost: 0, tokens: 0 },
			unmeasured: false,
			models: new Map(),
			sessions: [],
			days: new Map(),
		}));
		draftRow.sessions.push(index);
		draftRow.outside.cost += row.subagentsOutside.value?.cost ?? 0;
		draftRow.outside.tokens += row.subagentsOutside.value?.tokens ?? 0;
		if (row.subagentsOutside.origin === "notMeasured" && (join?.count ?? 0) > 0)
			draftRow.unmeasured = true;
		for (const [model, use] of digest.models)
			draftRow.models.set(model, (draftRow.models.get(model) ?? 0) + tokensOf(use.spend));
		for (const [day, bucket] of digest.days) {
			const spends = [...bucket.models.values(), bucket.subagents, bucket.other];
			for (const spend of spends) {
				sum(draftRow.spend, spend);
				draftRow.days.set(day, (draftRow.days.get(day) ?? 0) + tokensOf(spend));
			}
		}
	}
	return [...drafts.values()]
		.map((row) => ({
			projectId: row.projectId,
			name: row.projectId ? (names.get(row.projectId) ?? null) : null,
			sessions: row.sessions,
			tokens: { value: tokenTotals(row.spend), origin: "recorded" as const },
			cost: { value: row.spend.cost, origin: costOrigin(row.spend) },
			outside: {
				value: row.outside,
				origin: row.unmeasured ? "notMeasured" : "recorded",
			} as Figure<{
				cost: number;
				tokens: number;
			}>,
			models: [...row.models]
				.sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
				.map(([model]) => model),
			perDay: calendar.spark(row.days),
		}))
		.sort(
			(a, b) =>
				(b.tokens.value?.total ?? 0) - (a.tokens.value?.total ?? 0) ||
				byText(a.projectId ?? "", b.projectId ?? ""),
		);
}

function skillRows(calendar: Calendar, sessions: readonly ScopedSession[]): UsageSkillRow[] {
	const drafts = new Map<
		string,
		{
			listed: number;
			chars: number;
			loads: number;
			sessions: number[];
			last: number | null;
			days: Map<string, number>;
		}
	>();
	const create = () => ({
		listed: 0,
		chars: 0,
		loads: 0,
		sessions: [] as number[],
		last: null as number | null,
		days: new Map<string, number>(),
	});
	for (const { index, digest } of sessions) {
		for (const [name, chars] of digest.listed ?? []) {
			const row = slot(drafts, name, create);
			row.listed += 1;
			row.chars = Math.max(row.chars, chars);
		}
		for (const [name, loads] of digest.loads) {
			const row = slot(drafts, name, create);
			row.loads += loads.loads;
			row.sessions.push(index);
			row.last = Math.max(row.last ?? 0, loads.last);
			for (const [day, count] of loads.days) row.days.set(day, (row.days.get(day) ?? 0) + count);
		}
	}
	return [...drafts]
		.map(([name, row]) => ({
			name,
			listedSessions: row.listed,
			loads: counted(row.loads),
			sessions: row.sessions.sort((a, b) => a - b),
			neverLoaded: row.listed > 0 && row.loads === 0,
			descriptionTokens:
				row.listed > 0
					? ({ value: Math.ceil(row.chars / CHARS_PER_TOKEN), origin: "approximated" } as Figure)
					: ({ value: null, origin: "notMeasured" } as Figure),
			last: row.last,
			perDay: calendar.spark(row.days),
		}))
		.sort(
			(a, b) =>
				(b.loads.value ?? 0) - (a.loads.value ?? 0) ||
				b.listedSessions - a.listedSessions ||
				byText(a.name, b.name),
		);
}

function roleRows(calendar: Calendar, sessions: readonly ScopedSession[]): UsageRoleRow[] {
	const drafts = new Map<
		string,
		{
			runs: number;
			failed: number;
			tokens: number;
			cost: number;
			unmeasured: number;
			durations: number[];
			sessions: number[];
			days: Map<string, number>;
		}
	>();
	for (const { index, digest } of sessions)
		for (const [role, use] of digest.roles) {
			const row = slot(drafts, role, () => ({
				runs: 0,
				failed: 0,
				tokens: 0,
				cost: 0,
				unmeasured: 0,
				durations: [],
				sessions: [],
				days: new Map(),
			}));
			row.runs += use.runs;
			row.failed += use.failed;
			row.tokens += use.tokens;
			row.cost += use.cost;
			row.unmeasured += use.unmeasured;
			row.durations.push(...use.durations);
			row.sessions.push(index);
			for (const [day, runs] of use.days) row.days.set(day, (row.days.get(day) ?? 0) + runs);
		}
	return [...drafts]
		.map(([role, row]) => {
			const measured: Origin =
				row.unmeasured === row.runs
					? "notMeasured"
					: row.unmeasured > 0
						? "partiallyRecorded"
						: "recorded";
			const costOriginOf: Origin =
				measured === "recorded" && row.cost === 0 && row.tokens > 0 ? "notRecorded" : measured;
			return {
				role,
				runs: counted(row.runs),
				failed: counted(row.failed),
				failRate: wilson(row.failed, row.runs),
				tokens: { value: measured === "notMeasured" ? null : row.tokens, origin: measured },
				cost: { value: measured === "notMeasured" ? null : row.cost, origin: costOriginOf },
				durationP50: durationFigure(median(row.durations), "approximated"),
				sessions: row.sessions.sort((a, b) => a - b),
				perDay: calendar.spark(row.days),
			};
		})
		.sort((a, b) => (b.runs.value ?? 0) - (a.runs.value ?? 0) || byText(a.role, b.role));
}

function activeDays(sessions: readonly ScopedSession[]): string[] {
	const days = new Set<string>();
	for (const { digest } of sessions) {
		for (const day of digest.days.keys()) days.add(day);
		for (const tool of digest.tools.values()) for (const day of tool.days.keys()) days.add(day);
	}
	return [...days].sort();
}

/** Usage over the scope's sessions whose digests are built. Deterministic. */
export async function buildUsage(
	input: StatsInput,
	sessions: readonly ScopedSession[],
): Promise<StatsUsage> {
	const calendar = new Calendar(activeDays(sessions));
	const byModel = modelSeries(calendar, sessions);
	const outside = outsideSeries(calendar, sessions);
	const spend = emptySpend();
	for (const { digest } of sessions)
		for (const bucket of digest.days.values()) {
			for (const model of bucket.models.values()) sum(spend, model);
			sum(spend, bucket.subagents);
			sum(spend, bucket.other);
		}
	const outsideTotal = { cost: 0, tokens: 0 };
	let unmeasured = false;
	for (const { row, join } of sessions) {
		outsideTotal.cost += row.subagentsOutside.value?.cost ?? 0;
		outsideTotal.tokens += row.subagentsOutside.value?.tokens ?? 0;
		if (row.subagentsOutside.origin === "notMeasured" && (join?.count ?? 0) > 0) unmeasured = true;
	}
	const commandEntries = sessions.flatMap(({ index, digest }) =>
		[...digest.commands].map(([key, command]) => ({ session: index, key, digest: command })),
	);
	return {
		days: calendar.days,
		sparkDays: calendar.step,
		headline: spend.cost > 0 ? "cost" : "tokens",
		byModel,
		byProject: projectSeries(calendar, sessions, input.projects),
		outside,
		markers: markers(calendar, byModel, outside),
		totals: {
			tokens: { value: tokenTotals(spend), origin: "recorded" } as Figure<TokenTotals>,
			cost: { value: spend.cost, origin: costOrigin(spend) },
			outside: { value: outsideTotal, origin: unmeasured ? "notMeasured" : "recorded" },
		},
		models: await modelRows(calendar, sessions, input),
		projects: projectRows(calendar, sessions, input.projects),
		tools: toolRows(
			calendar,
			sessions.flatMap(({ index, digest }) =>
				[...digest.tools].map(([key, tool]) => ({ session: index, key, digest: tool })),
			),
		),
		commands: toolRows(calendar, commandEntries).slice(0, USAGE_COMMANDS),
		skills: skillRows(calendar, sessions),
		roles: roleRows(calendar, sessions),
		listingSessions: sessions.filter(({ digest }) => digest.listed !== null).length,
	};
}

/** `stats.usage`: per-day spend by model or project with change markers, and the usage tables. */
export async function buildStatsUsage(
	input: StatsInput,
	state: IndexState,
): Promise<StatsUsageResult> {
	const scope = await statsScope(input, state);
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		digests: scope.progress,
		sessions: scope.sessions,
		usage: await buildUsage(input, scope.ready),
		sources: METRIC_SOURCES,
	};
}
