import { buildSessionAnalysis } from "./analysis.ts";
import { buildContextView } from "./context.ts";
import {
	type ContextCall,
	type Figure,
	type FindingsListResult,
	OVERVIEW_RULES,
	type OverviewChain,
	type OverviewCost,
	type OverviewErrors,
	type OverviewFinding,
	type OverviewPlan,
	type RecoveryChain,
	type SessionAnalysis,
	type SessionContext,
	type SessionCost,
	type SessionFiles,
	type SessionOutcome,
	type SessionOverviewCards,
	type SessionOverviewParams,
	type SessionPlan,
	type ToolEvent,
	type TraceEvent,
} from "./core.ts";
import { buildSessionCost } from "./costWhy.ts";
import { buildSessionFiles } from "./files.ts";
import { sliceYielder } from "./lines.ts";
import { parseSessionParams } from "./list.ts";
import { labelOf } from "./redact.ts";
import { buildSessionTimeline, type ContextWindowLookup } from "./timeline.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";
import { parseRevision } from "./traceQueries.ts";
import { buildSessionSubagents, childActivity, type SubagentsInput, waveDrafts } from "./waves.ts";

/** The Overview's cards of one trace revision: what an answer adds per ask (the outcome, the findings) left out. */
export type OverviewCards = Omit<SessionOverviewCards, "findings" | "digests">;

export interface OverviewCardsInput {
	trace: BuiltTrace;
	contextWindow?: ContextWindowLookup;
	/** What the subagent waves are built from; their overview is built only when the session spawned any. */
	subagents: SubagentsInput | null;
	/** Once aborted, the build stops at its next stage and rejects with the reason. */
	signal?: AbortSignal;
	/** A stage that ran this long yields to the event loop before the next one (8 ms). */
	sliceMs?: number;
}

/** What one answer adds to its revision's cards. */
export interface OverviewAnswer {
	sessionId: string;
	/** The embedder's outcome of the session. */
	outcome: SessionOutcome | null;
	/** `findings.list` over the session's scope. */
	findings: FindingsListResult;
}

const SLICE_MS = 8;

/** `{ sessionId, revision? }`: a poll pins the revision its first answer carried. */
export function parseOverviewParams(value: unknown): SessionOverviewParams {
	const method = "session.overview";
	const { sessionId } = parseSessionParams(value, method);
	const revision = parseRevision(isRecord(value) ? value.revision : undefined, method);
	return revision === undefined ? { sessionId } : { sessionId, revision };
}

const RECOVERED: ReadonlySet<RecoveryChain["outcome"]> = new Set([
	"recovered",
	"sameModel",
	"afterSwitch",
]);

function counted(value: number | null): Figure {
	return { value, origin: "counted" };
}

function notMeasured(): Figure {
	return { value: null, origin: "notMeasured" };
}

function plan(source: SessionPlan | null): OverviewPlan | null {
	const kept = (source?.steps ?? [])
		.map((step, at) => ({ step, n: at + 1 }))
		.filter(({ step }) => step.status !== "removed");
	if (kept.length === 0) return null;
	return {
		steps: kept.slice(0, OVERVIEW_RULES.planSteps).map(({ step, n }) => ({
			id: step.id,
			n,
			title: step.title,
			status: step.status,
			errors: step.errors,
			cost: step.cost,
			tokens: { value: step.tokens.value?.total ?? null, origin: step.tokens.origin },
			events: [...new Set(step.changes.map((change) => change.eventId))],
		})),
		more: Math.max(0, kept.length - OVERVIEW_RULES.planSteps),
		done: counted(kept.filter(({ step }) => step.status === "done").length),
		total: counted(kept.length),
	};
}

function failedAttempts(chains: readonly RecoveryChain[]): number {
	return chains.reduce((sum, chain) => sum + chain.attempts.length - 1, 0);
}

function notableChain(analysis: SessionAnalysis, byId: ReadonlyMap<string, TraceEvent>) {
	const ranked = [...analysis.chains].sort(
		(a, b) =>
			(a.kind === "tool" ? 0 : 1) - (b.kind === "tool" ? 0 : 1) ||
			b.attempts.length - a.attempts.length ||
			a.index - b.index,
	);
	const chain = ranked[0];
	if (!chain) return null;
	const notable: OverviewChain = {
		index: chain.index,
		kind: chain.kind,
		outcome: chain.outcome,
		attempts: chain.attempts.map((eventId) => {
			const event = byId.get(eventId);
			return {
				eventId,
				name:
					event?.kind === "tool" ? event.tool : event?.kind === "llm" ? event.model : chain.name,
				label: labelOf(event?.label ?? "", OVERVIEW_RULES.labelChars),
				failed: event?.error === true,
				...(event?.kind === "tool" && event.missing === true ? { missing: true as const } : {}),
			};
		}),
		between: chain.between.map((ids) => ids.length),
		line: chain.line,
		recoveredIn: chain.recoveredIn,
	};
	return notable;
}

function errors(trace: BuiltTrace, analysis: SessionAnalysis): OverviewErrors | null {
	const failures = analysis.toolFailures + analysis.modelRecovery.failures;
	if (failures === 0) return null;
	const recovered = analysis.chains.filter((chain) => RECOVERED.has(chain.outcome));
	const byId = new Map(trace.events.map((event) => [event.id, event]));
	return {
		failures: counted(failures),
		recovered: counted(failedAttempts(recovered)),
		recoveredIn:
			recovered.length === 0
				? { value: null, origin: "counted" }
				: {
						value: recovered.reduce((sum, chain) => sum + (chain.recoveredIn.value ?? 0), 0),
						origin: recovered.every((chain) => chain.recoveredIn.origin === "counted")
							? "counted"
							: "approximated",
					},
		chains: analysis.chains.length,
		chain: notableChain(analysis, byId),
	};
}

function cost(source: SessionCost): OverviewCost {
	const d = source.diagnosis;
	const value = (call: SessionCost["calls"][number]) =>
		source.headline === "tokens" ? call.tokens : call.cost;
	const perBar = Math.max(1, Math.ceil(source.calls.length / OVERVIEW_RULES.callBars));
	const bars: number[] = [];
	for (let at = 0; at < source.calls.length; at += perBar)
		bars.push(Math.max(...source.calls.slice(at, at + perBar).map(value)));
	return {
		headline: source.headline,
		total: source.total,
		diagnosis: d,
		cacheShare: counted(d.calls > 0 ? d.cacheReadShare : null),
		rewrites: { value: d.rewrites?.calls ?? 0, origin: "approximated" },
		compactions: counted(source.compactions.length),
		highContext: d.highContext ? counted(d.highContext.calls) : notMeasured(),
		calls: counted(source.calls.length),
		bars,
		perBar,
	};
}

function context(source: SessionContext): SessionOverviewCards["context"] {
	let peakCall: ContextCall | null = null;
	for (const call of source.calls) if (!peakCall || call.total > peakCall.total) peakCall = call;
	const model = peakCall ? (peakCall.model ?? "") : null;
	const limit = source.limits.find((item) => item.model === model) ?? null;
	const peak = source.peak.value;
	return {
		peak: source.peak,
		window: limit ? { value: limit.value, origin: limit.origin } : notMeasured(),
		peakShare:
			limit && peak !== null
				? {
						value: peak / limit.value,
						origin: limit.origin === "host" ? "counted" : "approximated",
					}
				: notMeasured(),
		average: source.average,
		cacheShare: source.cacheShare,
		misses: source.misses,
		compactions: counted(source.compactions.length),
	};
}

function files(source: SessionFiles): SessionOverviewCards["files"] {
	const touched = source.rows.filter((row) => row.edits + row.writes + row.failed > 0);
	return {
		totals: source.totals,
		rows: touched.slice(0, OVERVIEW_RULES.files).map((row) => ({
			path: row.path,
			inside: row.inside,
			added: row.added,
			removed: row.removed,
			failed: row.failed > 0,
			rework: row.rework,
		})),
		more: Math.max(0, touched.length - OVERVIEW_RULES.files),
	};
}

function findings(list: FindingsListResult, sessionId: string): OverviewFinding[] | null {
	if (list.state.phase !== "ready" || list.digests.ready < list.digests.total) return null;
	const index = list.sessions.findIndex((ref) => ref.sessionId === sessionId);
	if (index < 0) return [];
	return list.findings
		.filter((finding) => !finding.hidden && finding.sessions.includes(index))
		.map((finding) => {
			const link = finding.links.find((item) => item.session === index);
			return {
				id: finding.id,
				rule: finding.rule,
				group: finding.group,
				severity: finding.severity,
				heuristic: finding.heuristic,
				subject: finding.subject,
				count: finding.count,
				total: finding.total,
				ratio: finding.ratio,
				figures: finding.figures,
				names: finding.names,
				sessions: finding.sessions.length,
				link: link
					? {
							count: link.count,
							events: link.events,
							...(link.value !== undefined ? { value: link.value } : {}),
						}
					: null,
			};
		});
}

/**
 * The Overview's cards of one trace snapshot: what happened, why it cost what it did, errors, context
 * and cache, files, subagents and turns, composed from the sections' own builders in stages that yield
 * like the queries do, so an embedder can keep them per revision and answer every ask from them.
 */
export async function buildOverviewCards(input: OverviewCardsInput): Promise<OverviewCards> {
	const { trace } = input;
	const { events, meta } = trace;
	const options = input.contextWindow ? { contextWindow: input.contextWindow } : {};
	const yielder = sliceYielder(input.sliceMs ?? SLICE_MS, undefined, input.signal);
	const stage = async () => {
		if (yielder.due()) await yielder.pause();
	};
	const analysis = buildSessionAnalysis(trace, []);
	await stage();
	const timeline = await buildSessionTimeline(trace, options);
	await stage();
	const spend = await buildSessionCost(trace, options);
	await stage();
	const window = await buildContextView(trace, options);
	await stage();
	const subagents =
		input.subagents && waveDrafts(trace).length > 0
			? await buildSessionSubagents(input.subagents)
			: null;
	await stage();
	const sessionFiles = buildSessionFiles(trace);
	await stage();
	const tools = events.filter((event): event is ToolEvent => event.kind === "tool");
	const toolChains = analysis.chains.filter((chain) => chain.kind === "tool");
	const userWaits = timeline.turns.map((turn) => turn.userWait.value ?? 0);
	return {
		revision: meta.revision,
		happened: {
			outcome: null,
			turns: counted(timeline.turns.length),
			llmCalls: timeline.llmCalls,
			toolCalls: counted(tools.length),
			toolFailures: counted(analysis.toolFailures),
			recovered: counted(
				failedAttempts(toolChains.filter((chain) => chain.outcome === "recovered")),
			),
			userWait: { value: userWaits.reduce((sum, ms) => sum + ms, 0), origin: "approximated" },
			start: counted(meta.start),
			end: counted(meta.end),
			span: counted(meta.start === null || meta.end === null ? null : meta.end - meta.start),
			activity: childActivity(trace),
			plan: plan(analysis.plan),
			skills: [...new Set(analysis.skills.map((skill) => skill.name))],
		},
		cost: cost(spend),
		errors: errors(trace, analysis),
		context: context(window),
		files: files(sessionFiles),
		subagents: {
			count: counted(subagents?.runs.length ?? 0),
			overview: subagents?.overview ?? null,
		},
		turns: {
			prompts: counted(timeline.turns.filter((turn) => turn.trigger === "prompt").length),
			asks: counted(tools.filter((event) => event.family === "ask").length),
		},
	};
}

/** One answer: its revision's cards with the session's outcome now and the scope's findings that link it. */
export function composeOverview(
	cards: OverviewCards,
	answer: OverviewAnswer,
): SessionOverviewCards {
	return {
		...cards,
		happened: { ...cards.happened, outcome: answer.outcome },
		findings: findings(answer.findings, answer.sessionId),
		digests: answer.findings.digests,
	};
}
