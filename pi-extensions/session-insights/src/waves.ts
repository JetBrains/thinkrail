import {
	ACTIVITY_TICKS,
	type ActivityTick,
	type CappedText,
	EXCERPT_CHARS,
	type Figure,
	type Origin,
	type RationaleSource,
	type SessionSubagents,
	type SpawnWave,
	type SubagentActivity,
	type SubagentDetail,
	type SubagentEvent,
	type SubagentFailure,
	type SubagentReturn,
	type SubagentRun,
	type SubagentTranscript,
	type ToolFamily,
	type TraceEvent,
} from "./core.ts";
import { BODY_CAPS } from "./eventBody.ts";
import { analysePlan, turnsOf } from "./plan.ts";
import type { Redactor } from "./redact.ts";
import { byText } from "./stats.ts";
import { costOrigin, isRecord, type SpendTotals, tokensOf } from "./totals.ts";
import { type BuiltTrace, contentText } from "./trace.ts";
import type { TraceStore } from "./traceStore.ts";
import { packTracks } from "./waits.ts";

const RESULT_HEAD = /^Subagent "[^"]*" \([^)]*\) [\w-]+:\s*/;
const FAILURES_SHOWN = 20;
const ACTIVITY_CACHE = 512;

export interface ChildTranscript {
	childId: string;
	file: string;
	spend: SpendTotals | null;
}

export interface SubagentsInput {
	trace: BuiltTrace;
	/** The parent session file. */
	file: string;
	store: TraceStore;
	/** The session's subagent transcripts, by child id. */
	transcripts: ReadonlyMap<string, ChildTranscript>;
	/** The embedder places the session in a removed workspace. */
	removed: boolean;
	activity: SubagentActivityCache;
}

/** Each child transcript revision's activity, so paging the subagents view rebuilds no unchanged trace. */
export class SubagentActivityCache {
	private readonly entries = new Map<string, SubagentActivity | null>();

	async of(store: TraceStore, file: string): Promise<SubagentActivity | null> {
		const trace = await store.peek(file);
		if (!trace) return null;
		const key = `${file}\u0000${trace.meta.revision}`;
		if (this.entries.has(key)) return this.entries.get(key) ?? null;
		const activity = childActivity(trace);
		this.entries.set(key, activity);
		while (this.entries.size > ACTIVITY_CACHE) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		return activity;
	}
}

function failed(event: TraceEvent): boolean {
	return event.error === true && (event.kind === "tool" || event.kind === "llm");
}

/** A subagent transcript's model and tool calls as ticks on its own clock, at most `ACTIVITY_TICKS`. */
export function childActivity(trace: BuiltTrace): SubagentActivity | null {
	const { meta, events } = trace;
	if (meta.start === null || meta.end === null) return null;
	const t0 = meta.start;
	const families: ToolFamily[] = [];
	const familyIndex = (family: ToolFamily) => {
		let at = families.indexOf(family);
		if (at < 0) {
			at = families.length;
			families.push(family);
		}
		return at;
	};
	let ticks: ActivityTick[] = [];
	let llmCalls = 0;
	let toolCalls = 0;
	let errors = 0;
	let model: string | null = null;
	for (const event of events) {
		if (event.kind !== "llm" && event.kind !== "tool") continue;
		const error = failed(event) ? 1 : 0;
		errors += error;
		if (event.kind === "llm") {
			llmCalls += 1;
			model ??= event.model;
		} else toolCalls += 1;
		ticks.push([
			event.t0 - t0,
			Math.max(0, event.t1 - event.t0),
			event.kind === "llm" ? -1 : familyIndex(event.family),
			error,
		]);
	}
	if (ticks.length > ACTIVITY_TICKS) {
		const span = Math.max(1, meta.end - t0);
		const slot = Math.ceil(span / (ACTIVITY_TICKS / 2));
		const merged = new Map<
			string,
			{ at: number; kind: number; votes: Map<number, number>; error: 0 | 1 }
		>();
		for (const [offset, , kind, error] of ticks) {
			const at = Math.floor(offset / slot);
			const key = `${at}:${kind < 0 ? "m" : "t"}`;
			const bucket = merged.get(key) ?? { at, kind, votes: new Map(), error: 0 };
			bucket.votes.set(kind, (bucket.votes.get(kind) ?? 0) + 1);
			if (error) bucket.error = 1;
			merged.set(key, bucket);
		}
		ticks = [...merged.values()]
			.sort((a, b) => a.at - b.at || a.kind - b.kind)
			.map((bucket) => {
				const kind = [...bucket.votes].sort(([a, x], [b, y]) => y - x || a - b)[0]?.[0] ?? -1;
				return [bucket.at * slot, slot, kind, bucket.error] as const;
			});
	}
	return { t0, t1: meta.end, families, ticks, llmCalls, toolCalls, errors, model };
}

function timingOrigin(event: TraceEvent): Origin {
	return event.timing === "recorded"
		? "counted"
		: event.timing === "approximated"
			? "approximated"
			: "notMeasured";
}

interface RunDraft {
	event: SubagentEvent;
	spawn: TraceEvent | null;
	turn: string | null;
	wave: number;
	lane: number;
}

/** Runs grouped into waves (spawns inside one turn whose runs overlap) and packed onto lanes. */
export function waveDrafts(trace: BuiltTrace): RunDraft[] {
	const { events } = trace;
	const turnOf = turnsOf(events);
	const byId = new Map(events.map((event) => [event.id, event]));
	const drafts: RunDraft[] = events
		.filter((event): event is SubagentEvent => event.kind === "subagent")
		.map((event) => ({
			event,
			spawn: event.parent ? (byId.get(event.parent) ?? null) : null,
			turn: turnOf.get(event.id) ?? null,
			wave: 0,
			lane: 0,
		}))
		.sort(
			(a, b) =>
				(a.spawn?.t0 ?? a.event.t0) - (b.spawn?.t0 ?? b.event.t0) ||
				a.event.t0 - b.event.t0 ||
				(a.event.childId < b.event.childId ? -1 : 1),
		);
	let wave = -1;
	let waveEnd = Number.NEGATIVE_INFINITY;
	let waveTurn: string | null | undefined;
	for (const draft of drafts) {
		const start = draft.spawn?.t0 ?? draft.event.t0;
		if (start >= waveEnd || draft.turn !== waveTurn) {
			wave += 1;
			waveTurn = draft.turn;
			waveEnd = Number.NEGATIVE_INFINITY;
		}
		draft.wave = wave;
		waveEnd = Math.max(waveEnd, draft.event.t1, start);
	}
	for (let n = 0; n <= wave; n++) {
		const members = drafts.filter((draft) => draft.wave === n);
		const packed = packTracks(
			members.map((draft) => ({ id: draft.event.id, t0: draft.event.t0, t1: draft.event.t1 })),
			Number.MAX_SAFE_INTEGER,
		);
		for (const draft of members) draft.lane = packed.of.get(draft.event.id) ?? 0;
	}
	return drafts;
}

function blocksOf(entry: Record<string, unknown>): unknown[] {
	const message = isRecord(entry.message) ? entry.message : {};
	return Array.isArray(message.content) ? message.content : [];
}

function excerpt(redactor: Redactor, text: string): string {
	return redactor.cap(text, EXCERPT_CHARS).text;
}

/** The parent's words before a spawn: the reply text, else thinking, else the previous reply. */
async function rationaleOf(
	input: SubagentsInput,
	draft: RunDraft,
): Promise<{ text: string; source: RationaleSource; eventId: string } | null> {
	const { store, file, trace } = input;
	if (draft.spawn?.kind !== "tool") return null;
	const read = await store.read(file, draft.spawn.id);
	if (!read) return null;
	const callIndex = read.source.callIndex ?? 0;
	const texts: string[] = [];
	const thoughts: string[] = [];
	let calls = 0;
	for (const block of blocksOf(read.parsed.entry)) {
		if (!isRecord(block)) continue;
		if (block.type === "toolCall") {
			if (calls === callIndex) break;
			calls += 1;
		} else if (block.type === "text" && typeof block.text === "string" && block.text.trim())
			texts.push(block.text.trim());
		else if (
			block.type === "thinking" &&
			typeof block.thinking === "string" &&
			block.thinking.trim()
		)
			thoughts.push(block.thinking.trim());
	}
	const spawner = draft.spawn.parent;
	if (spawner && texts.length > 0)
		return { text: texts.join("\n\n"), source: "text", eventId: spawner };
	if (spawner && thoughts.length > 0)
		return { text: thoughts.join("\n\n"), source: "thinking", eventId: spawner };
	const at = trace.events.findIndex((event) => event.id === spawner);
	for (let k = at - 1; k >= 0; k--) {
		const candidate = trace.events[k];
		if (candidate?.kind !== "llm" || candidate.replyChars === 0) continue;
		const previous = await store.read(file, candidate.id);
		const reply = previous ? contentText(blocksOf(previous.parsed.entry)).trim() : "";
		if (reply) return { text: reply, source: "previous", eventId: candidate.id };
		break;
	}
	return null;
}

async function resultOf(
	input: SubagentsInput,
	childId: string,
): Promise<{
	text: string;
	via: SubagentReturn["via"];
	status: string | null;
	eventId: string;
	at: number;
} | null> {
	const delivery = input.trace.deliveries.get(childId);
	if (!delivery) return null;
	const read = await input.store.read(input.file, delivery.eventId);
	if (!read) return null;
	const source =
		delivery.via === "completion"
			? read.parsed.entry
			: read.parsed.result && isRecord(read.parsed.result.message)
				? read.parsed.result.message
				: null;
	const text = source ? contentText(source.content).replace(RESULT_HEAD, "") : "";
	return {
		text,
		via: delivery.via,
		status: delivery.status,
		eventId: delivery.eventId,
		at: delivery.at,
	};
}

function spendFigures(
	event: SubagentEvent,
	transcript: ChildTranscript | undefined,
): { tokens: Figure; cost: Figure } {
	if (transcript?.spend)
		return {
			tokens: { value: tokensOf(transcript.spend), origin: "recorded" },
			cost: { value: transcript.spend.cost, origin: costOrigin(transcript.spend) },
		};
	if (event.tokens !== null)
		return {
			tokens: { value: event.tokens, origin: "recorded" },
			cost: {
				value: event.cost ?? 0,
				origin: event.cost ? "recorded" : event.tokens > 0 ? "notRecorded" : "recorded",
			},
		};
	return {
		tokens: { value: null, origin: "notMeasured" },
		cost: { value: null, origin: "notMeasured" },
	};
}

async function runOf(
	input: SubagentsInput,
	draft: RunDraft,
	withActivity: boolean,
): Promise<SubagentRun> {
	const { event } = draft;
	const transcript = input.transcripts.get(event.childId);
	const state: SubagentTranscript = transcript
		? "available"
		: input.removed
			? "removed"
			: "missing";
	const [rationale, result, activity] = await Promise.all([
		rationaleOf(input, draft),
		resultOf(input, event.childId),
		withActivity && transcript ? input.activity.of(input.store, transcript.file) : null,
	]);
	const redactor = input.store.redaction;
	const consumer = event.consumedBy
		? input.trace.events.find((candidate) => candidate.id === event.consumedBy)
		: undefined;
	return {
		childId: event.childId,
		eventId: event.id,
		spawnEventId: draft.spawn?.id ?? event.id,
		role: event.role,
		title: event.label,
		status: event.status,
		background: event.background === true,
		model: activity?.model ?? input.trace.childModels.get(event.childId) ?? null,
		spawnAt: draft.spawn?.t0 ?? event.t0,
		t0: event.t0,
		t1: event.t1,
		duration: { value: event.t1 - event.t0, origin: timingOrigin(event) },
		...spendFigures(event, transcript),
		wave: draft.wave,
		lane: draft.lane,
		rationale: rationale
			? {
					text: excerpt(redactor, rationale.text),
					chars: rationale.text.length,
					source: rationale.source,
					eventId: rationale.eventId,
				}
			: null,
		result: result
			? {
					text: excerpt(redactor, result.text),
					chars: result.text.length,
					via: result.via,
					status: result.status,
					eventId: result.eventId,
					at: result.at,
				}
			: null,
		consumedBy: consumer?.id ?? null,
		consumedAt: consumer?.t0 ?? null,
		readDelayMs: consumer ? Math.max(0, consumer.t0 - Math.max(event.t1, result?.at ?? 0)) : null,
		transcript: state,
		activity: activity ?? null,
	};
}

function sumFigure(figures: readonly Figure[]): Figure {
	if (figures.length === 0) return { value: 0, origin: "counted" };
	const value = figures.reduce((sum, figure) => sum + (figure.value ?? 0), 0);
	const origins = new Set(figures.map((figure) => figure.origin));
	if (origins.has("notMeasured")) return { value, origin: "notMeasured" };
	if (origins.has("partiallyRecorded") || (origins.has("notRecorded") && origins.size > 1))
		return { value, origin: "partiallyRecorded" };
	if (origins.has("notRecorded")) return { value, origin: "notRecorded" };
	return { value, origin: "recorded" };
}

function maxParallel(runs: readonly SubagentRun[]): number {
	const points: [number, number][] = [];
	for (const run of runs) {
		points.push([run.t0, 1]);
		points.push([Math.max(run.t1, run.t0 + 1), -1]);
	}
	points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let open = 0;
	let peak = 0;
	for (const [, delta] of points) {
		open += delta;
		peak = Math.max(peak, open);
	}
	return peak;
}

/** The waves view: every run with its quotes, activity and figures, the waves and an overview. */
export async function buildSessionSubagents(input: SubagentsInput): Promise<SessionSubagents> {
	const drafts = waveDrafts(input.trace);
	const runs: SubagentRun[] = [];
	for (const draft of drafts) runs.push(await runOf(input, draft, true));
	const turnN = new Map<string, number>();
	for (const event of input.trace.events) if (event.kind === "turn") turnN.set(event.id, event.n);
	const waves: SpawnWave[] = [];
	const count = drafts.reduce((most, draft) => Math.max(most, draft.wave + 1), 0);
	for (let n = 0; n < count; n++) {
		const members = runs.filter((run) => run.wave === n);
		const first = members[0];
		if (!first) continue;
		const turnId = drafts.find((draft) => draft.wave === n)?.turn ?? null;
		waves.push({
			n: n + 1,
			turnId,
			turnN: turnId ? (turnN.get(turnId) ?? null) : null,
			t0: Math.min(...members.map((run) => run.spawnAt)),
			t1: Math.max(...members.map((run) => Math.max(run.t1, run.consumedAt ?? run.t1))),
			lanes: Math.max(...members.map((run) => run.lane + 1)),
			childIds: members.map((run) => run.childId),
			rationale: first.rationale,
			tokens: sumFigure(members.map((run) => run.tokens)),
			cost: sumFigure(members.map((run) => run.cost)),
		});
	}
	const roles = new Map<string | null, number>();
	for (const run of runs) roles.set(run.role, (roles.get(run.role) ?? 0) + 1);
	return {
		revision: input.trace.meta.revision,
		waves,
		runs,
		overview: {
			roles: [...roles]
				.sort(([a, x], [b, y]) => y - x || byText(String(a ?? ""), String(b ?? "")))
				.map(([role, n]) => ({ role, n })),
			maxParallel: maxParallel(runs),
			tokens: sumFigure(runs.map((run) => run.tokens)),
			cost: sumFigure(runs.map((run) => run.cost)),
			failed: drafts.filter((draft) => draft.event.error).length,
			withErrors: runs.filter((run) => (run.activity?.errors ?? 0) > 0).length,
			unmeasured: runs.filter((run) => run.tokens.origin === "notMeasured").length,
		},
	};
}

function capped(
	redactor: Redactor,
	text: string,
	max: number,
	headTail = false,
): CappedText | null {
	if (!text.trim()) return null;
	return headTail ? redactor.capHeadTail(text, max) : redactor.cap(text, max);
}

/** One subagent's why / how / what: full quotes, its own tools, failures and skills, and its wave. */
export async function buildSubagentDetail(
	input: SubagentsInput,
	childId: string,
): Promise<SubagentDetail | null> {
	const drafts = waveDrafts(input.trace);
	const draft = drafts.find((candidate) => candidate.event.childId === childId);
	if (!draft) return null;
	const run = await runOf(input, draft, true);
	const redactor = input.store.redaction;
	const [rationale, result, spawn] = await Promise.all([
		rationaleOf(input, draft),
		resultOf(input, childId),
		draft.spawn ? input.store.read(input.file, draft.spawn.id) : null,
	]);
	let task = "";
	if (spawn) {
		let calls = 0;
		for (const block of blocksOf(spawn.parsed.entry)) {
			if (!isRecord(block) || block.type !== "toolCall") continue;
			if (calls === (spawn.source.callIndex ?? 0)) {
				const args = isRecord(block.arguments) ? block.arguments : {};
				task = typeof args.task === "string" ? args.task : "";
				break;
			}
			calls += 1;
		}
	}
	const transcript = input.transcripts.get(childId);
	const child = transcript ? await input.store.peek(transcript.file) : null;
	const tools = new Map<
		string,
		{ tool: string; family: ToolFamily; calls: number; errors: number }
	>();
	const failures: SubagentFailure[] = [];
	for (const event of child?.events ?? []) {
		if (event.kind === "tool") {
			const row = tools.get(event.tool) ?? {
				tool: event.tool,
				family: event.family,
				calls: 0,
				errors: 0,
			};
			row.calls += 1;
			if (event.error) row.errors += 1;
			tools.set(event.tool, row);
		}
		if (failures.length < FAILURES_SHOWN && failed(event))
			failures.push({
				eventId: event.id,
				tool: event.kind === "tool" ? event.tool : null,
				line:
					event.kind === "tool"
						? (child?.facts.get(event.id)?.result?.errorLine ?? event.label)
						: (child?.llmFailures.get(event.id)?.errorLine ??
							(event.kind === "llm" ? (event.stop ?? "") : "")),
			});
	}
	const skills = child ? [...new Set(analysePlan(child).skills.map((skill) => skill.name))] : [];
	return {
		run,
		task: capped(redactor, task, BODY_CAPS.task),
		rationale: rationale ? capped(redactor, rationale.text, BODY_CAPS.text) : null,
		result: result ? capped(redactor, result.text, BODY_CAPS.result, true) : null,
		tools: [...tools.values()].sort((a, b) => b.calls - a.calls || (a.tool < b.tool ? -1 : 1)),
		failures,
		skills,
		siblings: drafts
			.filter((candidate) => candidate.wave === draft.wave)
			.map(({ event }) => ({
				childId: event.childId,
				role: event.role,
				title: event.label,
				status: event.status,
				t0: event.t0,
				t1: event.t1,
			})),
	};
}
