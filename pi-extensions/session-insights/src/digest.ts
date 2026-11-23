import { activityOf } from "./activity.ts";
import { countedCalls, missCauses } from "./context.ts";
import {
	type Activity,
	type DigestProgress,
	FAILED_RUN_STATUSES,
	FINDING_RULES,
	type MissCause,
	type ToolEvent,
	type ToolFamily,
} from "./core.ts";
import { localDay } from "./day.ts";
import { analyseFriction } from "./friction.ts";
import type { PromptSentence } from "./repeats.ts";
import { type SearchColumns, searchColumns } from "./searchIndex.ts";
import type { SessionSummary } from "./summary.ts";
import { contextOf } from "./timeline.ts";
import { toolFamily } from "./toolFamily.ts";
import { addSpend, emptySpend, type SpendTotals } from "./totals.ts";
import { type BuiltTrace, type CatalogModel, type EventSource, succeeded } from "./trace.ts";

const SHELL_TOOLS: readonly string[] = ["bash", "background_command"];
const EVIDENCE = 3;
const FAILURES_KEPT = 200;
/** A model failure that says the request did not fit the context window. */
const CONTEXT_LIMIT =
	/prompt is too long|too many tokens|exceeds? (?:the )?(?:model'?s? )?(?:maximum )?context|context (?:length|window) (?:exceeded|limit)|maximum context length|context_length_exceeded|input is too long/i;
/** A command that runs tests (for "done without verification", a heuristic). */
const TEST_RUN =
	/(?:^|[\s:])(?:test|tests|vitest|jest|pytest|playwright|mocha|rspec|phpunit|ctest|e2e)(?:[\s:]|$)/;

export interface ToolDigest {
	family: ToolFamily;
	calls: number;
	errors: number;
	/** Calls without a recorded result: issued, never run (neither a success nor a failure). */
	notRun: number;
	/** `durationMs` of the calls that recorded it. */
	durations: number[];
	/** Calls per host-local day. */
	days: Map<string, number>;
	last: number | null;
}

export interface FailureFact {
	eventId: string;
	key: string;
	line: string;
	exit: string | null;
	t: number;
}

export interface CallRef {
	eventId: string;
	source: EventSource;
}

export interface CommandDigest extends ToolDigest {
	/** Exit codes of the failed runs. */
	exits: Map<string, number>;
	failures: FailureFact[];
	/** The first failure followed by a successful run of the same command, and that run. */
	worked: { failed: CallRef; next: CallRef } | null;
}

export interface ModelDigest {
	/** Recorded spend of the model's calls, every branch. */
	spend: SpendTotals;
	calls: number;
	errors: number;
	latencies: number[];
	peak: number;
	catalog: CatalogModel | null;
}

export interface DayDigest {
	models: Map<string, SpendTotals>;
	subagents: SpendTotals;
	other: SpendTotals;
}

export interface SkillLoads {
	loads: number;
	days: Map<string, number>;
	last: number;
	events: string[];
}

export interface RoleDigest {
	runs: number;
	failed: number;
	tokens: number;
	cost: number;
	/** Runs without a final report of their spend. */
	unmeasured: number;
	durations: number[];
	days: Map<string, number>;
	events: string[];
}

export interface FileDigest {
	reads: number;
	edits: number;
	writes: number;
	failed: number;
	added: number;
	removed: number;
	events: string[];
	last: number;
}

/** A tool call of the session in issue order, for the action sequences. */
export interface SequenceStep {
	activity: Activity;
	failed: boolean;
	/** No recorded result: the call never ran. */
	missing: boolean;
	/** The tool, or a shell command's head: a retry of a failure repeats it. */
	key: string;
	tool: string;
	eventId: string;
	label: string;
}

export interface CountedEvents {
	count: number;
	events: string[];
}

/**
 * One session's facts for the statistics across sessions, built once per file revision from its trace
 * and kept in memory only (error lines and prompt excerpts never reach the disk cache).
 */
export interface SessionDigest {
	sessionId: string;
	start: number | null;
	days: Map<string, DayDigest>;
	models: Map<string, ModelDigest>;
	tools: Map<string, ToolDigest>;
	commands: Map<string, CommandDigest>;
	/** Skills a persisted skills section lists, with their entry's characters; `null`: none persisted. */
	listed: Map<string, number> | null;
	loads: Map<string, SkillLoads>;
	roles: Map<string, RoleDigest>;
	/** The day each subagent ran, by child id. */
	childDays: Map<string, string>;
	files: Map<string, FileDigest>;
	outsideTouches: number;
	nodeModulesTouches: number;
	contextLimits: string[];
	/** The models (`models` keys) whose calls failed for the context window, once each. */
	limitModels: Set<string>;
	/** The largest request context and its model. */
	peak: { tokens: number; model: string | null };
	misses: {
		count: number;
		causes: Map<MissCause | "none", number>;
		rewritten: number;
		events: string[];
	};
	oversized: Map<string, CountedEvents & { max: number }>;
	loops: Map<string, CountedEvents & { longest: number }>;
	recovery: Map<string, { chains: number; recovered: number; events: string[] }>;
	unverified: string[];
	sentences: { eventId: string; sentence: PromptSentence }[];
	/** The session's own tool calls in issue order. */
	steps: SequenceStep[];
	turns: number;
	/** Retried attempts after failures plus repeated identical calls (heuristics of the errors section). */
	retries: number;
	/** The searchable events as columns (facets and line ranges, no text). */
	search: SearchColumns;
}

function slot<K, V>(map: Map<K, V>, key: K, create: () => V): V {
	let value = map.get(key);
	if (value === undefined) {
		value = create();
		map.set(key, value);
	}
	return value;
}

function bump(map: Map<string, number>, key: string, by = 1): void {
	map.set(key, (map.get(key) ?? 0) + by);
}

function keep(events: string[], id: string): void {
	if (events.length < EVIDENCE) events.push(id);
}

/** A shell call by its command head, any other by its tool name. */
export function toolKey(event: ToolEvent): string {
	return SHELL_TOOLS.includes(event.tool) && event.head ? event.head : event.tool;
}

function emptyTool(family: ToolFamily): ToolDigest {
	return { family, calls: 0, errors: 0, notRun: 0, durations: [], days: new Map(), last: null };
}

function countTool(digest: ToolDigest, event: ToolEvent): void {
	digest.calls += 1;
	if (event.error) digest.errors += 1;
	if (event.missing) digest.notRun += 1;
	if (event.timing === "recorded") digest.durations.push(Math.max(0, event.t1 - event.t0));
	bump(digest.days, localDay(event.t0));
	digest.last = Math.max(digest.last ?? event.t0, event.t0);
}

function isNodeModules(path: string): boolean {
	return path.startsWith("node_modules/") || path.includes("/node_modules/");
}

function spendDays(trace: BuiltTrace, digest: SessionDigest): void {
	for (const mark of trace.spends) {
		const day = slot(digest.days, localDay(mark.t), () => ({
			models: new Map(),
			subagents: emptySpend(),
			other: emptySpend(),
		}));
		if (mark.source === "model") {
			const model = mark.model ?? "";
			addSpend(slot(day.models, model, emptySpend), mark.spend);
			const use = slot(digest.models, model, () => ({
				spend: emptySpend(),
				calls: 0,
				errors: 0,
				latencies: [],
				peak: 0,
				catalog: trace.models.get(model) ?? null,
			}));
			addSpend(use.spend, mark.spend);
			use.calls += 1;
			if (mark.error) use.errors += 1;
		} else addSpend(mark.source === "subagent" ? day.subagents : day.other, mark.spend);
	}
}

/** A recorded touch of a file: a call without a result never ran, so it touched nothing. */
function fileTouch(digest: SessionDigest, trace: BuiltTrace, event: ToolEvent): void {
	const op = event.tool;
	if ((op !== "read" && op !== "edit" && op !== "write") || event.missing) return;
	const facts = trace.facts.get(event.id);
	const file = facts?.call?.file;
	if (!file) return;
	const failed = event.error === true;
	if (failed && op === "read") return;
	if (!file.inside) {
		if (!failed) digest.outsideTouches += 1;
		return;
	}
	if (isNodeModules(file.path)) {
		if (!failed) digest.nodeModulesTouches += 1;
		return;
	}
	const row = slot(digest.files, file.path, () => ({
		reads: 0,
		edits: 0,
		writes: 0,
		failed: 0,
		added: 0,
		removed: 0,
		events: [],
		last: event.t0,
	}));
	row.last = Math.max(row.last, event.t0);
	if (failed) {
		row.failed += 1;
		return;
	}
	if (op === "read") row.reads += 1;
	else {
		keep(row.events, event.id);
		const edit = facts?.result?.edit ?? null;
		if (op === "edit") {
			row.edits += 1;
			row.added += edit?.added ?? 0;
			row.removed += edit?.removed ?? 0;
		} else {
			row.writes += 1;
			row.added += file.lines ?? 0;
		}
	}
}

function commandFacts(trace: BuiltTrace, digest: SessionDigest, calls: readonly ToolEvent[]): void {
	const pending = new Map<string, CallRef>();
	for (const event of calls) {
		if (!SHELL_TOOLS.includes(event.tool) || !event.head) continue;
		const command = slot(digest.commands, event.head, () => ({
			...emptyTool(toolFamily(event.tool, event.head ?? null)),
			exits: new Map(),
			failures: [],
			worked: null,
		}));
		countTool(command, event);
		const source = trace.sources.get(event.id);
		if (event.error) {
			if (event.exit) bump(command.exits, event.exit);
			const result = trace.facts.get(event.id)?.result;
			if (command.failures.length < FAILURES_KEPT)
				command.failures.push({
					eventId: event.id,
					key: result?.errorKey ?? `${event.tool}: (empty)`,
					line: result?.errorLine ?? "",
					exit: event.exit ?? null,
					t: event.t0,
				});
			if (source && !pending.has(event.head) && !command.worked)
				pending.set(event.head, { eventId: event.id, source });
		} else if (!event.missing && source) {
			const failed = pending.get(event.head);
			if (failed && !command.worked) {
				command.worked = { failed, next: { eventId: event.id, source } };
				pending.delete(event.head);
			}
		}
	}
}

function unverifiedClaims(trace: BuiltTrace): string[] {
	const out: string[] = [];
	let edited = false;
	let tested = false;
	for (const event of trace.events) {
		if (event.kind === "tool") {
			if ((event.tool === "edit" || event.tool === "write") && succeeded(event)) {
				edited = true;
				tested = false;
			} else if (
				SHELL_TOOLS.includes(event.tool) &&
				event.head &&
				!event.missing &&
				TEST_RUN.test(event.head)
			)
				tested = true;
		} else if (event.kind === "llm" && trace.claims.has(event.id) && edited && !tested)
			out.push(event.id);
	}
	return out;
}

function emptyDigest(
	trace: BuiltTrace,
	summary: SessionSummary,
	search: SearchColumns,
): SessionDigest {
	return {
		sessionId: summary.sessionId,
		start: summary.start,
		days: new Map(),
		models: new Map(),
		tools: new Map(),
		commands: new Map(),
		listed: null,
		loads: new Map(),
		roles: new Map(),
		childDays: new Map(),
		files: new Map(),
		outsideTouches: 0,
		nodeModulesTouches: 0,
		contextLimits: [],
		limitModels: new Set(),
		peak: { tokens: 0, model: null },
		misses: { count: 0, causes: new Map(), rewritten: 0, events: [] },
		oversized: new Map(),
		loops: new Map(),
		recovery: new Map(),
		unverified: unverifiedClaims(trace),
		sentences: trace.prompts.flatMap((prompt) =>
			prompt.sentences.map((sentence) => ({ eventId: prompt.eventId, sentence })),
		),
		steps: [],
		turns: 0,
		retries: 0,
		search,
	};
}

/** Spend by day and model, skills, tools, files, roles and model calls: one pass over the events. */
function eventFacts(trace: BuiltTrace, digest: SessionDigest): ToolEvent[] {
	spendDays(trace, digest);
	for (const listing of trace.skillLists) {
		digest.listed ??= new Map();
		for (const skill of listing.skills)
			digest.listed.set(skill.name, Math.max(digest.listed.get(skill.name) ?? 0, skill.chars));
	}
	const load = (name: string, eventId: string, t: number) => {
		const loads = slot(digest.loads, name, () => ({
			loads: 0,
			days: new Map(),
			last: t,
			events: [],
		}));
		loads.loads += 1;
		bump(loads.days, localDay(t));
		loads.last = Math.max(loads.last, t);
		keep(loads.events, eventId);
	};
	for (const prompt of trace.promptSkills) load(prompt.name, prompt.eventId, prompt.t);
	const calls: ToolEvent[] = [];
	for (const event of trace.events) {
		switch (event.kind) {
			case "tool": {
				calls.push(event);
				digest.steps.push({
					activity: activityOf(event, trace.facts.get(event.id)?.call),
					failed: event.error === true,
					missing: event.missing === true,
					key: toolKey(event),
					tool: event.tool,
					eventId: event.id,
					label: event.label,
				});
				countTool(
					slot(digest.tools, event.tool, () => emptyTool(toolFamily(event.tool, null))),
					event,
				);
				fileTouch(digest, trace, event);
				const skill = trace.facts.get(event.id)?.call?.skill;
				if (skill && succeeded(event)) load(skill, event.id, event.t0);
				if ((event.resultChars ?? 0) >= FINDING_RULES.oversizedChars) {
					const big = slot(digest.oversized, toolKey(event), () => ({
						count: 0,
						events: [],
						max: 0,
					}));
					big.count += 1;
					big.max = Math.max(big.max, event.resultChars ?? 0);
					keep(big.events, event.id);
				}
				break;
			}
			case "llm": {
				const model = event.model ?? "";
				const use = digest.models.get(model);
				const context = contextOf(event);
				if (use) {
					if (event.timing === "recorded") use.latencies.push(Math.max(0, event.t1 - event.t0));
					use.peak = Math.max(use.peak, context);
				}
				if (context > digest.peak.tokens) digest.peak = { tokens: context, model: event.model };
				const failure = trace.llmFailures.get(event.id);
				if (failure && CONTEXT_LIMIT.test(failure.errorLine)) {
					digest.contextLimits.push(event.id);
					digest.limitModels.add(model);
				}
				break;
			}
			case "turn":
				digest.turns += 1;
				break;
			case "subagent": {
				const role = slot(digest.roles, event.role ?? "", () => ({
					runs: 0,
					failed: 0,
					tokens: 0,
					cost: 0,
					unmeasured: 0,
					durations: [],
					days: new Map(),
					events: [],
				}));
				role.runs += 1;
				if (FAILED_RUN_STATUSES.includes(event.status ?? "")) role.failed += 1;
				if (event.tokens === null) role.unmeasured += 1;
				else {
					role.tokens += event.tokens;
					role.cost += event.cost ?? 0;
				}
				if (event.timing !== "notMeasured") role.durations.push(Math.max(0, event.t1 - event.t0));
				bump(role.days, localDay(event.t0));
				keep(role.events, event.id);
				digest.childDays.set(event.childId, localDay(event.t1));
				break;
			}
		}
	}
	return calls;
}

/** Heuristic cache misses with the causes visible in the file. */
function missFacts(trace: BuiltTrace, digest: SessionDigest): void {
	for (const call of countedCalls(trace)) {
		if (!call.miss || !call.previous) continue;
		digest.misses.count += 1;
		digest.misses.rewritten += call.event.tokens.cacheWrite;
		keep(digest.misses.events, call.event.id);
		const causes = missCauses(call.previous, call.event, call.changes, call.gapMs);
		if (causes.length === 0) bump(digest.misses.causes, "none");
		for (const cause of causes) bump(digest.misses.causes, cause);
	}
}

/** Loops (identical calls in a row) and recovery chains, from the errors section's analysis. */
function frictionFacts(
	trace: BuiltTrace,
	digest: SessionDigest,
	calls: readonly ToolEvent[],
): void {
	const friction = analyseFriction(trace);
	const byId = new Map(calls.map((call) => [call.id, call]));
	for (const group of friction.repeats) {
		digest.retries += Math.max(0, group.ids.length - 1);
		if (group.ids.length < FINDING_RULES.loopCalls) continue;
		const first = byId.get(group.ids[0] ?? "");
		const loop = slot(digest.loops, first ? toolKey(first) : group.tool, () => ({
			count: 0,
			events: [],
			longest: 0,
		}));
		loop.count += 1;
		loop.longest = Math.max(loop.longest, group.ids.length);
		keep(loop.events, group.ids[0] ?? "");
	}
	for (const chain of friction.chains) {
		if (chain.kind === "tool") digest.retries += Math.max(0, chain.attempts.length - 1);
		if (chain.kind !== "tool" || chain.name === null || chain.outcome === "unfinished") continue;
		const recovery = slot(digest.recovery, chain.name, () => ({
			chains: 0,
			recovered: 0,
			events: [],
		}));
		recovery.chains += 1;
		if (chain.outcome === "recovered") recovery.recovered += 1;
		keep(recovery.events, chain.attempts[0] ?? "");
	}
}

/** The per-session facts of the statistics, from a built trace. Deterministic. */
export function digestOf(trace: BuiltTrace, summary: SessionSummary): SessionDigest {
	const digest = emptyDigest(trace, summary, searchColumns(trace));
	const calls = eventFacts(trace, digest);
	commandFacts(trace, digest, calls);
	missFacts(trace, digest);
	frictionFacts(trace, digest, calls);
	return digest;
}

/** `digestOf` in stages with a turn of the event loop between them, for a background build. */
export async function digestInStages(
	trace: BuiltTrace,
	summary: SessionSummary,
): Promise<SessionDigest> {
	const search = searchColumns(trace);
	await sleep(0);
	const digest = emptyDigest(trace, summary, search);
	await sleep(0);
	const calls = eventFacts(trace, digest);
	await sleep(0);
	commandFacts(trace, digest, calls);
	missFacts(trace, digest);
	await sleep(0);
	frictionFacts(trace, digest, calls);
	return digest;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The digests of indexed sessions, one per file, each built for a summary (a new file revision is a new
 * summary) one at a time in the background, newest first as the caller orders them. While a file's new
 * revision is built its previous digest stays in place (`latest`), so a live session that keeps growing
 * is still counted; the new digest replaces it once built (a build reads the file as it is then, so the
 * latest build is the freshest). A deleted file's digest is kept until restart, or until `signal` aborts:
 * that drops every digest and the queue, and the build running then is the last one.
 */
export class DigestStore {
	private readonly files = new Map<
		string,
		{ summary: SessionSummary; digest: SessionDigest | null }
	>();
	private readonly queued = new WeakSet<SessionSummary>();
	private readonly queue: SessionSummary[] = [];
	private readonly waiters = new Map<
		SessionSummary,
		{ done: Promise<void>; resolve: () => void }
	>();
	private running: Promise<void> | null = null;
	private readonly build: (summary: SessionSummary) => Promise<SessionDigest | null>;
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly signal: AbortSignal | undefined;

	constructor(
		build: (summary: SessionSummary) => Promise<SessionDigest | null>,
		onError?: (error: unknown) => void,
		options: { signal?: AbortSignal } = {},
	) {
		this.build = build;
		this.onError = onError;
		this.signal = options.signal;
		this.signal?.addEventListener("abort", () => this.stop(), { once: true });
	}

	private stop(): void {
		this.queue.length = 0;
		this.files.clear();
		for (const waiter of this.waiters.values()) waiter.resolve();
		this.waiters.clear();
	}

	/** This revision's digest: `undefined` while not built; `null` for a file that could not be read. */
	get(summary: SessionSummary): SessionDigest | null | undefined {
		const built = this.files.get(summary.file);
		return built?.summary === summary ? built.digest : undefined;
	}

	/**
	 * This revision's digest, else the file's previous one while this one is built (what the statistics
	 * count); `undefined` before the file's first digest.
	 */
	latest(summary: SessionSummary): SessionDigest | null | undefined {
		const built = this.files.get(summary.file);
		return built?.summary.sessionId === summary.sessionId ? built.digest : undefined;
	}

	/** The summary's digest, built next if it is not built yet (ahead of the queue). */
	async need(summary: SessionSummary): Promise<SessionDigest | null> {
		const built = this.get(summary);
		if (built !== undefined) return built;
		if (this.signal?.aborted) return null;
		const queued = this.queue.indexOf(summary);
		if (queued >= 0) this.queue.splice(queued, 1);
		this.queued.add(summary);
		this.queue.unshift(summary);
		let waiter = this.waiters.get(summary);
		if (!waiter) {
			let resolve = () => {};
			const done = new Promise<void>((settle) => {
				resolve = settle;
			});
			waiter = { done, resolve };
			this.waiters.set(summary, waiter);
		}
		await Promise.race([this.kick(), waiter.done]);
		return this.get(summary) ?? null;
	}

	/**
	 * Queues the missing digests and waits up to `budgetMs` for them. `ready` counts the sessions with a
	 * digest of this revision or the previous one (so `ready < total` while some session has none at
	 * all), `stale` those counted from the previous revision while this one is built.
	 */
	async ensure(summaries: readonly SessionSummary[], budgetMs: number): Promise<DigestProgress> {
		let missing = false;
		for (const summary of this.signal?.aborted ? [] : summaries) {
			if (this.get(summary) !== undefined) continue;
			missing = true;
			if (this.queued.has(summary)) continue;
			this.queued.add(summary);
			this.queue.push(summary);
		}
		if (missing) {
			const work = this.kick();
			if (budgetMs > 0) await Promise.race([work, sleep(budgetMs)]);
		}
		let ready = 0;
		let stale = 0;
		for (const summary of summaries) {
			if (this.latest(summary) === undefined) continue;
			ready += 1;
			if (this.get(summary) === undefined) stale += 1;
		}
		return { ready, total: summaries.length, stale };
	}

	private kick(): Promise<void> {
		this.running ??= this.drain().finally(() => {
			this.running = null;
		});
		return this.running;
	}

	private async drain(): Promise<void> {
		for (let summary = this.queue.shift(); summary; summary = this.queue.shift()) {
			if (this.get(summary) === undefined) {
				let digest: SessionDigest | null = null;
				try {
					digest = await this.build(summary);
				} catch (error) {
					if (!this.signal?.aborted) this.onError?.(error);
				}
				if (this.signal?.aborted) return;
				this.files.set(summary.file, { summary, digest });
			}
			this.queued.delete(summary);
			this.waiters.get(summary)?.resolve();
			this.waiters.delete(summary);
		}
	}
}
