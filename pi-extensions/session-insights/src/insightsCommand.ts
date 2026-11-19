import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { buildSessionAnalysis } from "./analysis.ts";
import { fileSummaryCache } from "./cache.ts";
import type { ExportKind, IndexState, ListProject, SessionOverview } from "./core.ts";
import { buildSessionCost } from "./costWhy.ts";
import type { StatsInput } from "./crossSession.ts";
import { DigestStore, digestInStages } from "./digest.ts";
import {
	type ChildTranscriptLocator,
	listSessionFiles,
	vanillaChildTranscriptDirs,
} from "./discovery.ts";
import { exportTitle, renderSessionHtml } from "./exportHtml.ts";
import { chromeTraceOutput, exportBaseName, exportFailure, writeExport } from "./exports.ts";
import { buildFindingsList } from "./findings.ts";
import {
	type ContextPeak,
	type ExportLine,
	INSIGHTS_USAGE,
	type InsightsScope,
	overviewReport,
	sessionReport,
} from "./insightsReport.ts";
import {
	buildSessionSummary,
	buildSessionsList,
	childTranscriptsOf,
	type SessionPlacement,
	type SessionsListInput,
	subagentJoinOf,
} from "./list.ts";
import { SessionIndex } from "./sessionIndex.ts";
import { JsonStore } from "./store.ts";
import type { SessionSummary } from "./summary.ts";
import { buildSessionTimeline, type ContextWindowLookup } from "./timeline.ts";
import type { BuiltTrace } from "./trace.ts";
import { TraceStore } from "./traceStore.ts";
import { buildStatsUsage } from "./usage.ts";
import { buildSessionSubagents, SubagentActivityCache } from "./waves.ts";

/** How long one wait for the index or the digests lasts before the command reports progress again. */
const PROGRESS_MS = 250;
const MIN_PROGRESS_MS = 10;
const SHORT_ID_MIN = 8;
const AMBIGUOUS_SHOWN = 5;
const SESSION_ARG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

// ── Arguments ──

export interface InsightsRequest {
	/** Every folder's sessions instead of the current folder's. */
	all: boolean;
	/** One session's report: a full id or a unique prefix of one. */
	sessionId: string | null;
	/** Also write that session (else the latest in scope) as an HTML page… */
	html: boolean;
	/** …and as a Chrome trace. */
	trace: boolean;
	help: boolean;
}

export type ParsedInsightsArgs =
	| { ok: true; request: InsightsRequest }
	| { ok: false; message: string };

/** The flags `/insights` takes, for argument completion. */
export const INSIGHTS_FLAGS: readonly { flag: string; description: string }[] = [
	{ flag: "--all", description: "every folder's sessions" },
	{ flag: "--session", description: "one session by id or unique prefix" },
	{ flag: "--html", description: "write the session as an HTML page" },
	{ flag: "--trace", description: "write the session as a Chrome trace" },
	{ flag: "--help", description: "what the command does" },
];

/** `--all`, `--session <id>` (or `--session=<id>`, or a bare id), `--html`, `--trace`, `--help`. */
export function parseInsightsArgs(text: string): ParsedInsightsArgs {
	const request: InsightsRequest = {
		all: false,
		sessionId: null,
		html: false,
		trace: false,
		help: false,
	};
	const fail = (message: string): ParsedInsightsArgs => ({
		ok: false,
		message: `${message}\n\n${INSIGHTS_USAGE}`,
	});
	const words = text.trim().split(/\s+/).filter(Boolean);
	const session = (id: string): string | null => {
		if (!SESSION_ARG.test(id)) return `Not a session id: ${id.slice(0, 40)}`;
		if (request.sessionId !== null && request.sessionId !== id)
			return "Give one session at a time.";
		request.sessionId = id;
		return null;
	};
	for (let at = 0; at < words.length; at++) {
		const word = words[at] ?? "";
		let problem: string | null = null;
		if (word === "--all" || word === "-a") request.all = true;
		else if (word === "--html") request.html = true;
		else if (word === "--trace") request.trace = true;
		else if (word === "--help" || word === "-h") request.help = true;
		else if (word === "--session" || word === "-s") {
			const next = words[at + 1];
			if (next === undefined || next.startsWith("-")) problem = "--session needs a session id.";
			else {
				at += 1;
				problem = session(next);
			}
		} else if (word.startsWith("--session=")) problem = session(word.slice("--session=".length));
		else if (word.startsWith("-")) problem = `Unknown option ${word.slice(0, 40)}.`;
		else problem = session(word);
		if (problem) return fail(problem);
	}
	return { ok: true, request };
}

// ── Where things are ──

export interface InsightsLocations {
	/** pi's sessions folder (`<agentDir>/sessions` in vanilla pi). */
	sessionsRoot: string;
	/** A parent session's subagent transcript folders (`<agentDir>/delegation/default/<parent>/`). */
	childTranscriptDirs: ChildTranscriptLocator;
	/** The disposable summary cache and the hidden-findings document. */
	cacheDir: string;
	/** Exports land in `<exportsDir>/session-insights/`. */
	exportsDir: string;
}

/** Vanilla pi's layout under its agent dir (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`). */
export function vanillaInsightsLocations(agentDir: string = getAgentDir()): InsightsLocations {
	return {
		sessionsRoot: join(agentDir, "sessions"),
		childTranscriptDirs: vanillaChildTranscriptDirs(agentDir),
		cacheDir: join(agentDir, "session-insights", "cache"),
		exportsDir: agentDir,
	};
}

/** Everything a command run reuses: the index, traces, digests and stores, kept warm between runs. */
export class InsightsEngine {
	readonly locations: InsightsLocations;
	readonly index: SessionIndex;
	readonly traces = new TraceStore();
	readonly digests: DigestStore;
	readonly store: JsonStore;
	readonly activity = new SubagentActivityCache();

	constructor(locations: InsightsLocations, onError?: (error: unknown) => void) {
		this.locations = locations;
		this.index = new SessionIndex({
			sessionFiles: () => listSessionFiles(locations.sessionsRoot),
			childTranscriptDirs: locations.childTranscriptDirs,
			cache: fileSummaryCache(locations.cacheDir),
			redactor: this.traces.redaction,
			...(onError ? { onError } : {}),
		});
		this.digests = new DigestStore(async (summary) => {
			const trace = await this.traces.peek(summary.file);
			return trace ? digestInStages(trace, summary) : null;
		}, onError);
		this.store = new JsonStore(locations.cacheDir);
	}
}

// ── A run ──

export interface InsightsIO {
	/** The folder the command runs in: the default scope. */
	cwd: string;
	/** The model's context window, from the host's model registry. */
	contextWindow?: ContextWindowLookup;
	/** Called while indexing and reading sessions, at most every `progressMs`. */
	progress?: (message: string) => void;
	progressMs?: number;
}

const NOWHERE: SessionPlacement = {
	projectId: null,
	workspaceId: null,
	workspaceName: null,
	workspace: "none",
};

function folderKey(path: string): string {
	const resolved = resolve(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Each session id once (the first file listed, as the index answers), newest first. */
function uniqueSessions(summaries: readonly SessionSummary[]): SessionSummary[] {
	const seen = new Set<string>();
	const out: SessionSummary[] = [];
	for (const summary of summaries) {
		if (seen.has(summary.sessionId)) continue;
		seen.add(summary.sessionId);
		out.push(summary);
	}
	return out.sort(
		(a, b) =>
			(b.start ?? Number.NEGATIVE_INFINITY) - (a.start ?? Number.NEGATIVE_INFINITY) ||
			(a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
	);
}

function commonPrefix(a: string, b: string): number {
	let at = 0;
	while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
	return at;
}

/** Each id's shortest prefix that no other id starts with: at least 8 characters, never ending on `-`. */
export function shortIds(ids: readonly string[]): (sessionId: string) => string {
	const sorted = [...new Set(ids)].sort();
	const short = new Map<string, string>();
	sorted.forEach((id, at) => {
		const before = at > 0 ? commonPrefix(id, sorted[at - 1] ?? "") : 0;
		const after = at < sorted.length - 1 ? commonPrefix(id, sorted[at + 1] ?? "") : 0;
		let length = Math.min(id.length, Math.max(SHORT_ID_MIN, before + 1, after + 1));
		if (id[length - 1] === "-" && length < id.length) length += 1;
		short.set(id, id.slice(0, length));
	});
	return (sessionId) => short.get(sessionId) ?? sessionId;
}

async function indexAll(
	index: SessionIndex,
	progress: (message: string) => void,
	tick: number,
): Promise<IndexState> {
	for (;;) {
		const state = await index.ensureFresh(tick);
		if (state.phase === "ready") return state;
		progress(
			state.total === null
				? "listing session files…"
				: `indexing session files ${state.indexed}/${state.total}…`,
		);
	}
}

async function digestAll(
	digests: DigestStore,
	summaries: readonly SessionSummary[],
	progress: (message: string) => void,
	tick: number,
): Promise<void> {
	for (;;) {
		const { ready, total, stale = 0 } = await digests.ensure(summaries, tick);
		if (ready - stale >= total) return;
		progress(`reading sessions ${ready}/${total}…`);
	}
}

type Resolved = { ok: true; summary: SessionSummary } | { ok: false; message: string };

function resolveSession(
	summaries: readonly SessionSummary[],
	wanted: string,
	shortId: (sessionId: string) => string,
): Resolved {
	const exact = summaries.find((summary) => summary.sessionId === wanted);
	if (exact) return { ok: true, summary: exact };
	const matches = summaries.filter((summary) => summary.sessionId.startsWith(wanted));
	const [only] = matches;
	if (only && matches.length === 1) return { ok: true, summary: only };
	if (matches.length === 0)
		return { ok: false, message: `No pi session has an id starting with ${wanted}.` };
	const shown = matches
		.slice(0, AMBIGUOUS_SHOWN)
		.map((summary) => shortId(summary.sessionId))
		.join(", ");
	const more =
		matches.length > AMBIGUOUS_SHOWN ? `, +${matches.length - AMBIGUOUS_SHOWN} more` : "";
	return {
		ok: false,
		message: `${wanted} matches ${matches.length} sessions (${shown}${more}); give more of the id.`,
	};
}

/** The highest request context of the session's model calls, with that model's window. */
function contextPeak(
	trace: BuiltTrace,
	timeline: Awaited<ReturnType<typeof buildSessionTimeline>>,
): ContextPeak | null {
	let peak: { id: string; tokens: number } | null = null;
	for (const point of timeline.context)
		if (!peak || point.tokens > peak.tokens) peak = { id: point.id, tokens: point.tokens };
	if (!peak || peak.tokens <= 0) return null;
	const id = peak.id;
	const event = trace.events.find((candidate) => candidate.id === id);
	const model = event?.kind === "llm" ? event.model : null;
	const limit = timeline.limits.find((candidate) => candidate.model === model) ?? null;
	return { tokens: peak.tokens, model, limit };
}

interface RunContext {
	engine: InsightsEngine;
	state: IndexState;
	contextWindow: ContextWindowLookup | undefined;
	/** Every session, placed in its folder: what a session report or an export looks up. */
	everywhere: SessionsListInput;
}

async function exportSession(
	run: RunContext,
	summary: SessionSummary,
	overview: SessionOverview,
	kind: Extract<ExportKind, "html" | "trace">,
): Promise<ExportLine> {
	const { engine } = run;
	const { traces, index, locations } = engine;
	const target = { dir: locations.exportsDir, relative: "" };
	const trace = await traces.trace(summary.file);
	if (!trace) return { result: exportFailure(kind, "SESSION_NOT_FOUND"), path: null };
	const redactor = traces.redaction;
	const title = exportTitle(overview, redactor);
	const base = exportBaseName(trace, title);
	const transcripts = childTranscriptsOf(index, summary.sessionId);
	let result: ExportLine["result"];
	if (kind === "html") {
		const joined = subagentJoinOf(index, summary.sessionId);
		const html = await renderSessionHtml({
			overview,
			trace,
			store: traces,
			timeline: await buildSessionTimeline(trace, {
				...(run.contextWindow ? { contextWindow: run.contextWindow } : {}),
				outside: joined?.children ?? [],
			}),
			analysis: buildSessionAnalysis(trace, [...transcripts.keys()]),
			subagents: await buildSessionSubagents({
				trace,
				file: summary.file,
				store: traces,
				transcripts,
				removed: false,
				activity: engine.activity,
			}),
			labels: null,
		});
		result = await writeExport(target, {
			kind: "html",
			name: `${base}.html`,
			folder: false,
			files: [{ path: "", content: html, check: "html" }],
			notes: [],
			sources: [trace.file],
		});
	} else {
		const children = new Map<string, BuiltTrace>();
		for (const [childId, transcript] of transcripts) {
			const child = await traces.peek(transcript.file);
			if (child) children.set(childId, child);
		}
		const missing = trace.events.some(
			(event) => event.kind === "subagent" && !children.has(event.childId),
		);
		result = await writeExport(
			target,
			chromeTraceOutput({ trace, title, children, base }, missing ? ["childrenMissing"] : []),
		);
	}
	return {
		result,
		path: result.ok ? join(locations.exportsDir, ...result.path.split("/").filter(Boolean)) : null,
	};
}

async function exportsFor(
	run: RunContext,
	request: InsightsRequest,
	summary: SessionSummary | null,
	progress: (message: string) => void,
): Promise<ExportLine[]> {
	const kinds: ("html" | "trace")[] = [
		...(request.html ? (["html"] as const) : []),
		...(request.trace ? (["trace"] as const) : []),
	];
	if (kinds.length === 0 || !summary) return [];
	const overview = (await buildSessionSummary(run.everywhere, run.state, summary.sessionId))
		.session;
	if (!overview) return [];
	const lines: ExportLine[] = [];
	for (const kind of kinds) {
		progress(`writing the ${kind === "html" ? "HTML page" : "Chrome trace"}…`);
		lines.push(await exportSession(run, summary, overview, kind));
	}
	return lines;
}

async function sessionText(
	run: RunContext,
	request: InsightsRequest,
	summary: SessionSummary,
	shortId: (sessionId: string) => string,
	progress: (message: string) => void,
): Promise<string> {
	const { engine } = run;
	const { index, traces } = engine;
	progress("reading the session…");
	const trace = await traces.trace(summary.file);
	const overview = (await buildSessionSummary(run.everywhere, run.state, summary.sessionId))
		.session;
	if (!trace || !overview) return `The session ${shortId(summary.sessionId)} could not be read.`;
	const contextWindow = run.contextWindow ? { contextWindow: run.contextWindow } : {};
	const joined = subagentJoinOf(index, summary.sessionId);
	const timeline = await buildSessionTimeline(trace, {
		...contextWindow,
		outside: joined?.children ?? [],
	});
	const analysis = buildSessionAnalysis(trace, [
		...childTranscriptsOf(index, summary.sessionId).keys(),
	]);
	const cost = await buildSessionCost(trace, contextWindow);
	const turnLabels = new Map<string, string>();
	for (const event of trace.events)
		if (event.kind === "turn") turnLabels.set(event.id, event.label);
	const exports = await exportsFor(run, request, summary, progress);
	return sessionReport({
		overview,
		shortId: shortId(summary.sessionId),
		cwd: trace.cwd,
		timeline,
		analysis,
		cost,
		peak: contextPeak(trace, timeline),
		turnLabels,
		redactor: traces.redaction,
		exports,
	});
}

/**
 * Builds `/insights`' report from the sessions on disk: the scope's findings and usage, or one
 * session's summary, plus the exports asked for. Deterministic for the same files and arguments.
 */
export async function runInsights(
	engine: InsightsEngine,
	request: InsightsRequest,
	io: InsightsIO,
): Promise<string> {
	if (request.help) return INSIGHTS_USAGE;
	const progress = io.progress ?? (() => {});
	// A wait of 0 would spin on microtasks and starve the I/O the index and digests wait on.
	const tick = Math.max(MIN_PROGRESS_MS, io.progressMs ?? PROGRESS_MS);
	const { index, traces } = engine;
	const redactor = traces.redaction;
	const state = await indexAll(index, progress, tick);
	const summaries = uniqueSessions(index.summaries());
	const shortId = shortIds(summaries.map((summary) => summary.sessionId));
	const folders = new Map<string, ListProject>();
	for (const summary of summaries) {
		const key = folderKey(summary.cwd);
		if (!folders.has(key)) folders.set(key, { id: key, name: summary.cwd, kind: "repository" });
	}
	const placeIn =
		(only: string | null) =>
		(cwd: string): SessionPlacement | null => {
			const key = folderKey(cwd);
			if (only !== null && key !== only) return null;
			return { ...NOWHERE, projectId: key };
		};
	const listInput = (only: string | null): SessionsListInput => ({
		index,
		projects: [...folders.values()],
		place: placeIn(only),
		status: () => ({ live: false, outcome: null }),
	});
	const run: RunContext = {
		engine,
		state,
		contextWindow: io.contextWindow,
		everywhere: listInput(null),
	};

	if (request.sessionId !== null) {
		const resolved = resolveSession(summaries, request.sessionId, shortId);
		if (!resolved.ok) return resolved.message;
		return sessionText(run, request, resolved.summary, shortId, progress);
	}

	const scope: InsightsScope = request.all
		? { kind: "all" }
		: { kind: "cwd", cwd: resolve(io.cwd) };
	const only = scope.kind === "all" ? null : folderKey(scope.cwd);
	const input = listInput(only);
	const inScope = summaries.filter((summary) => input.place(summary.cwd) !== null);
	await digestAll(engine.digests, inScope, progress, tick);
	progress("summing up…");
	const stats: StatsInput = {
		...input,
		digests: engine.digests,
		...(io.contextWindow ? { contextWindow: io.contextWindow } : {}),
		budgetMs: 0,
	};
	const list = await buildSessionsList(input, state);
	const usage = await buildStatsUsage(stats, state);
	const findings = await buildFindingsList({ ...stats, store: engine.store, redactor }, state);
	const latest = list.rows[0];
	const target = latest
		? (summaries.find((summary) => summary.sessionId === latest.sessionId) ?? null)
		: null;
	const exports = await exportsFor(run, request, target, progress);
	return overviewReport({
		scope,
		sessionsRoot: engine.locations.sessionsRoot,
		indexed: summaries.length,
		rows: list.rows,
		usage: usage.usage,
		findings: findings.findings,
		findingSessions: findings.sessions,
		shortId,
		redactor,
		exports,
	});
}
