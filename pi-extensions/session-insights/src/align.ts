import { activityOf } from "./activity.ts";
import {
	ALIGN_RULES,
	type AlignOp,
	type AlignRow,
	type AlignSide,
	type AlignStep,
	type AlignTurn,
	METRIC_SOURCES,
	SESSION_INSIGHTS_API_VERSION,
	type SessionAlignment,
	type SessionsAlignParams,
	type SessionsAlignResult,
	type ToolEvent,
	type TurnPair,
} from "./core.ts";
import type { CallFacts } from "./facts.ts";
import { jaccard } from "./repeats.ts";
import { toolFamily } from "./toolFamily.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";
import { parseRevision } from "./traceQueries.ts";

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "background_command"]);
const SEARCH_TOOLS: ReadonlySet<string> = new Set(["grep", "find", "ls"]);
const KEPT_HEADS: ReadonlySet<string> = new Set([
	"git",
	"gh",
	"bun",
	"bunx",
	"npm",
	"npx",
	"pnpm",
	"yarn",
]);
/** Classes whose matches are the same action without shared objects (so are identical calls). */
const SAME_BY_CLASS: ReadonlySet<string> = new Set(["set_title", "ask_user_question"]);
const ID_CHARS = 200;
/** Blocks at most this large are aligned with a full table; larger ones split (Hirschberg). */
const FULL_TABLE_CELLS = 4096;
const SLICE_MS = 8;

/** `{ a, b, cursor?, revisions? }` of `sessions.align`. */
export function parseAlignParams(value: unknown): SessionsAlignParams {
	const method = "sessions.align";
	const fail = () => new Error(`Invalid ${method} params`);
	if (!isRecord(value)) throw fail();
	const { a, b, cursor, revisions } = value;
	const id = (text: unknown) =>
		typeof text === "string" && text.length > 0 && text.length <= ID_CHARS;
	if (!id(a) || !id(b)) throw fail();
	if (cursor !== undefined && (!Number.isInteger(cursor) || (cursor as number) < 0)) throw fail();
	let pinned: { a: string; b: string } | undefined;
	if (revisions !== undefined) {
		if (!isRecord(revisions)) throw fail();
		const left = parseRevision(revisions.a, method);
		const right = parseRevision(revisions.b, method);
		if (left === undefined || right === undefined) throw fail();
		pinned = { a: left, b: right };
	}
	return {
		a: a as string,
		b: b as string,
		...(cursor !== undefined ? { cursor: cursor as number } : {}),
		...(pinned ? { revisions: pinned } : {}),
	};
}

/**
 * What matching compares: `skill:<name>` for a `SKILL.md` read, `file` for reads and reading commands,
 * `search` for searches, `git checkout` for checkouts, switches and worktrees, a git / gh / package
 * manager command by its head, any other command by its head, else the tool.
 */
export function alignClass(event: ToolEvent, call: CallFacts | null | undefined): string {
	if (call?.skill) return `skill:${call.skill}`;
	if (event.tool === "read") return "file";
	if (SEARCH_TOOLS.has(event.tool)) return "search";
	if (!SHELL_TOOLS.has(event.tool)) return event.tool;
	const head = event.head ?? "bash";
	if (/^git (?:checkout|switch|worktree)\b/.test(head)) return "git checkout";
	if (KEPT_HEADS.has(head.split(" ")[0] ?? "")) return head;
	const family = toolFamily("bash", head);
	if (family === "reading") return "file";
	if (family === "discovery") return "search";
	return head;
}

interface SideModel {
	side: AlignSide;
	steps: AlignStep[];
	objects: (readonly number[])[];
	/** Each call's identity (tool and normalized arguments). */
	keys: string[];
	/** Each turn's steps as `[first, end)`. */
	ranges: [number, number][];
	words: (readonly number[])[];
}

function sideOf(sessionId: string, trace: BuiltTrace): SideModel {
	const turns: AlignTurn[] = [];
	const ranges: [number, number][] = [];
	const words: (readonly number[])[] = [];
	const steps: AlignStep[] = [];
	const objects: (readonly number[])[] = [];
	const keys: string[] = [];
	let turnStart = 0;
	const openTurn = (turn: AlignTurn, t0: number, promptWords: readonly number[]) => {
		const last = ranges.at(-1);
		if (last) last[1] = steps.length;
		turns.push(turn);
		ranges.push([steps.length, steps.length]);
		words.push(promptWords);
		turnStart = t0;
	};
	for (const event of trace.events) {
		if (event.kind === "turn") {
			openTurn(
				{
					n: event.n,
					eventId: event.id,
					trigger: event.trigger,
					label: event.label,
					calls: 0,
					durationMs: Math.max(0, event.t1 - event.t0),
				},
				event.t0,
				trace.promptWords.get(event.id) ?? [],
			);
			continue;
		}
		if (event.kind !== "tool") continue;
		if (turns.length === 0)
			openTurn(
				{ n: 0, eventId: "", trigger: "prompt", label: "", calls: 0, durationMs: 0 },
				event.t0,
				[],
			);
		const call = trace.facts.get(event.id)?.call;
		const turn = turns.length - 1;
		const current = turns[turn] as AlignTurn;
		current.calls += 1;
		steps.push({
			eventId: event.id,
			tool: event.tool,
			activity: activityOf(event, call),
			klass: alignClass(event, call),
			label: event.label,
			failed: event.error === true,
			turn,
			offset: Math.max(0, event.t0 - turnStart),
		});
		objects.push(call?.objects ?? []);
		keys.push(call?.key ?? "");
	}
	const last = ranges.at(-1);
	if (last) last[1] = steps.length;
	return {
		side: { sessionId, revision: trace.meta.revision, turns, calls: steps.length },
		steps,
		objects,
		keys,
		ranges,
		words,
	};
}

/** Live and peak floats the alignment tables hold, to pin the memory bound. */
export interface AlignMeter {
	live: number;
	peak: number;
}

function hold(meter: AlignMeter, cells: number): void {
	meter.live += cells;
	meter.peak = Math.max(meter.peak, meter.live);
}

/** `score(i, j)` of a pair that may match, else `-Infinity`. */
export type PairScore = (i: number, j: number) => number;

interface Clock {
	at: number;
}

async function breathe(clock: Clock): Promise<void> {
	if (performance.now() - clock.at < SLICE_MS) return;
	await new Promise((resolve) => setTimeout(resolve, 0));
	clock.at = performance.now();
}

function fullTable(
	i0: number,
	i1: number,
	j0: number,
	j1: number,
	score: PairScore,
	meter: AlignMeter,
	out: [number, number][],
): void {
	const n = i1 - i0;
	const m = j1 - j0;
	const width = m + 1;
	const cells = (n + 1) * width;
	hold(meter, cells);
	const table = new Float64Array(cells);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--) {
			const s = score(i0 + i, j0 + j);
			const skip = Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
			table[i * width + j] =
				s > Number.NEGATIVE_INFINITY
					? Math.max(skip, s + (table[(i + 1) * width + j + 1] ?? 0))
					: skip;
		}
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		const s = score(i0 + i, j0 + j);
		const here = table[i * width + j] ?? 0;
		if (
			s > Number.NEGATIVE_INFINITY &&
			Math.abs(here - (s + (table[(i + 1) * width + j + 1] ?? 0))) < 1e-9
		) {
			out.push([i0 + i, j0 + j]);
			i += 1;
			j += 1;
		} else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i += 1;
		else j += 1;
	}
	meter.live -= cells;
}

/** Best scores of `A[i0, i1)` against every prefix of `B[j0, j1)`. */
async function forwardRow(
	i0: number,
	i1: number,
	j0: number,
	j1: number,
	score: PairScore,
	meter: AlignMeter,
	clock: Clock,
): Promise<Float64Array> {
	const width = j1 - j0 + 1;
	hold(meter, 2 * width);
	let previous = new Float64Array(width);
	let current = new Float64Array(width);
	for (let i = i0; i < i1; i++) {
		current[0] = 0;
		for (let k = 1; k < width; k++) {
			const skip = Math.max(previous[k] ?? 0, current[k - 1] ?? 0);
			const s = score(i, j0 + k - 1);
			current[k] = s > Number.NEGATIVE_INFINITY ? Math.max(skip, (previous[k - 1] ?? 0) + s) : skip;
		}
		[previous, current] = [current, previous];
		await breathe(clock);
	}
	meter.live -= width;
	return previous;
}

/** Best scores of `A[i0, i1)` against every suffix of `B[j0, j1)`. */
async function backwardRow(
	i0: number,
	i1: number,
	j0: number,
	j1: number,
	score: PairScore,
	meter: AlignMeter,
	clock: Clock,
): Promise<Float64Array> {
	const width = j1 - j0 + 1;
	hold(meter, 2 * width);
	let previous = new Float64Array(width);
	let current = new Float64Array(width);
	for (let i = i1 - 1; i >= i0; i--) {
		current[width - 1] = 0;
		for (let k = width - 2; k >= 0; k--) {
			const skip = Math.max(previous[k] ?? 0, current[k + 1] ?? 0);
			const s = score(i, j0 + k);
			current[k] = s > Number.NEGATIVE_INFINITY ? Math.max(skip, (previous[k + 1] ?? 0) + s) : skip;
		}
		[previous, current] = [current, previous];
		await breathe(clock);
	}
	meter.live -= width;
	return previous;
}

async function split(
	i0: number,
	i1: number,
	j0: number,
	j1: number,
	score: PairScore,
	meter: AlignMeter,
	clock: Clock,
	out: [number, number][],
): Promise<void> {
	const n = i1 - i0;
	const m = j1 - j0;
	if (n === 0 || m === 0) return;
	if (n * m <= FULL_TABLE_CELLS || n === 1) {
		fullTable(i0, i1, j0, j1, score, meter, out);
		return;
	}
	const middle = i0 + Math.floor(n / 2);
	const forward = await forwardRow(i0, middle, j0, j1, score, meter, clock);
	const backward = await backwardRow(middle, i1, j0, j1, score, meter, clock);
	let best = Number.NEGATIVE_INFINITY;
	let cut = 0;
	for (let k = 0; k <= m; k++) {
		const total = (forward[k] ?? 0) + (backward[k] ?? 0);
		if (total > best + 1e-9) {
			best = total;
			cut = k;
		}
	}
	meter.live -= 2 * (m + 1);
	await split(i0, middle, j0, j0 + cut, score, meter, clock, out);
	await split(middle, i1, j0 + cut, j1, score, meter, clock, out);
}

/**
 * The best-scoring order-preserving matching of `A[0, n)` with `B[0, m)` (no gap penalty; pairs that
 * may not match score `-Infinity`), as matched pairs in order. Hirschberg's split keeps the tables
 * linear in `m`; blocks of at most `FULL_TABLE_CELLS` cells use a full table. Deterministic: ties prefer
 * the first split column, then a match, then skipping in A.
 */
export async function alignPairs(
	n: number,
	m: number,
	score: PairScore,
	meter: AlignMeter = { live: 0, peak: 0 },
): Promise<[number, number][]> {
	const out: [number, number][] = [];
	await split(0, n, 0, m, score, meter, { at: performance.now() }, out);
	return out;
}

/** Objects in more than `ALIGN_RULES.commonObjects` of both sides' calls are dropped as noise. */
function filterObjects(a: SideModel, b: SideModel): [(readonly number[])[], (readonly number[])[]] {
	const counts = new Map<number, number>();
	for (const list of [...a.objects, ...b.objects])
		for (const object of list) counts.set(object, (counts.get(object) ?? 0) + 1);
	const total = a.objects.length + b.objects.length;
	const keep = (list: readonly number[]) =>
		list.filter((object) => (counts.get(object) ?? 0) / total <= ALIGN_RULES.commonObjects);
	return [a.objects.map(keep), b.objects.map(keep)];
}

/** Turn pairs: the first turns, then later turns by prompt word overlap (a weighted LCS). */
export function pairTurns(
	a: readonly (readonly number[])[],
	b: readonly (readonly number[])[],
): TurnPair[] {
	if (a.length === 0 || b.length === 0) return [];
	const pairs: TurnPair[] = [
		{ a: 0, b: 0, similarity: jaccard(a[0] ?? [], b[0] ?? []), by: "first" },
	];
	const n = a.length - 1;
	const m = b.length - 1;
	if (n === 0 || m === 0) return pairs;
	const similarity = (i: number, j: number) => jaccard(a[i + 1] ?? [], b[j + 1] ?? []);
	const score: PairScore = (i, j) => {
		const value = similarity(i, j);
		return value >= ALIGN_RULES.turnSimilarity ? value : Number.NEGATIVE_INFINITY;
	};
	const width = m + 1;
	const table = new Float64Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--) {
			const s = score(i, j);
			const skip = Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
			table[i * width + j] =
				s > Number.NEGATIVE_INFINITY
					? Math.max(skip, s + (table[(i + 1) * width + j + 1] ?? 0))
					: skip;
		}
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		const s = score(i, j);
		if (
			s > Number.NEGATIVE_INFINITY &&
			Math.abs((table[i * width + j] ?? 0) - (s + (table[(i + 1) * width + j + 1] ?? 0))) < 1e-9
		) {
			pairs.push({ a: i + 1, b: j + 1, similarity: s, by: "prompt" });
			i += 1;
			j += 1;
		} else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i += 1;
		else j += 1;
	}
	return pairs;
}

/** A whole alignment, before paging. */
export interface FullAlignment {
	a: SideModel;
	b: SideModel;
	pairs: TurnPair[];
	rows: AlignRow[];
	totals: Record<AlignOp, number>;
	similarity: number;
}

/** Two sessions' calls aligned turn pair by turn pair; calls of an unpaired turn are one-sided. */
export async function alignSessions(
	a: { sessionId: string; trace: BuiltTrace },
	b: { sessionId: string; trace: BuiltTrace },
): Promise<FullAlignment> {
	const left = sideOf(a.sessionId, a.trace);
	const right = sideOf(b.sessionId, b.trace);
	const [objectsA, objectsB] = filterObjects(left, right);
	const classes = new Map<string, number>();
	const classIds = (steps: readonly AlignStep[]) =>
		Int32Array.from(steps, (step) => {
			let id = classes.get(step.klass);
			if (id === undefined) {
				id = classes.size;
				classes.set(step.klass, id);
			}
			return id;
		});
	const classA = classIds(left.steps);
	const classB = classIds(right.steps);
	const pairs = pairTurns(left.words, right.words);
	const rows: AlignRow[] = [];
	const totals: Record<AlignOp, number> = { same: 0, similar: 0, onlyA: 0, onlyB: 0 };
	const push = (row: AlignRow) => {
		rows.push(row);
		totals[row.op] += 1;
	};
	const oneSided = (side: "a" | "b", from: number, to: number) => {
		const ranges = side === "a" ? left.ranges : right.ranges;
		for (let turn = from; turn < to; turn++) {
			const [first, end] = ranges[turn] ?? [0, 0];
			for (let step = first; step < end; step++)
				push(
					side === "a"
						? { op: "onlyA", a: step, b: null, pair: null }
						: { op: "onlyB", a: null, b: step, pair: null },
				);
		}
	};
	let nextA = 0;
	let nextB = 0;
	for (const [index, pair] of pairs.entries()) {
		oneSided("a", nextA, pair.a);
		oneSided("b", nextB, pair.b);
		const [a0, a1] = left.ranges[pair.a] ?? [0, 0];
		const [b0, b1] = right.ranges[pair.b] ?? [0, 0];
		const score: PairScore = (i, j) => {
			if (classA[a0 + i] !== classB[b0 + j]) return Number.NEGATIVE_INFINITY;
			return 1 + 3 * jaccard(objectsA[a0 + i] ?? [], objectsB[b0 + j] ?? []);
		};
		const matches = await alignPairs(a1 - a0, b1 - b0, score);
		let i = 0;
		let j = 0;
		const emit = (toI: number, toJ: number) => {
			for (; i < toI; i++) push({ op: "onlyA", a: a0 + i, b: null, pair: index });
			for (; j < toJ; j++) push({ op: "onlyB", a: null, b: b0 + j, pair: index });
		};
		for (const [mi, mj] of matches) {
			emit(mi, mj);
			const x = left.steps[a0 + mi] as AlignStep;
			const key = left.keys[a0 + mi] ?? "";
			const same =
				(key !== "" && key === right.keys[b0 + mj]) ||
				SAME_BY_CLASS.has(x.klass) ||
				x.klass.startsWith("skill:") ||
				jaccard(objectsA[a0 + mi] ?? [], objectsB[b0 + mj] ?? []) >= ALIGN_RULES.sameObjects;
			push({ op: same ? "same" : "similar", a: a0 + mi, b: b0 + mj, pair: index });
			i = mi + 1;
			j = mj + 1;
		}
		emit(a1 - a0, b1 - b0);
		nextA = pair.a + 1;
		nextB = pair.b + 1;
	}
	oneSided("a", nextA, left.side.turns.length);
	oneSided("b", nextB, right.side.turns.length);
	const calls = left.steps.length + right.steps.length;
	return {
		a: left,
		b: right,
		pairs,
		rows,
		totals,
		similarity: calls > 0 ? (2 * (totals.same + totals.similar)) / calls : 0,
	};
}

/** One page of rows with the steps they name. */
export function alignmentPage(full: FullAlignment, cursor: number): SessionAlignment {
	const start = Math.min(cursor, full.rows.length);
	const end = Math.min(full.rows.length, start + ALIGN_RULES.pageRows);
	const rows = full.rows.slice(start, end);
	const stepsA: Record<number, AlignStep> = {};
	const stepsB: Record<number, AlignStep> = {};
	for (const row of rows) {
		if (row.a !== null) stepsA[row.a] = full.a.steps[row.a] as AlignStep;
		if (row.b !== null) stepsB[row.b] = full.b.steps[row.b] as AlignStep;
	}
	return {
		a: full.a.side,
		b: full.b.side,
		pairs: full.pairs,
		totals: full.totals,
		similarity: full.similarity,
		rows,
		stepsA,
		stepsB,
		cursor: start,
		next: end < full.rows.length ? end : null,
		totalRows: full.rows.length,
		rules: ALIGN_RULES,
	};
}

/** The latest few alignments by both files' revisions, so paging never aligns twice. */
export class AlignmentCache {
	private readonly entries = new Map<string, Promise<FullAlignment>>();
	private readonly size: number;

	constructor(size = 2) {
		this.size = size;
	}

	get(
		a: { sessionId: string; trace: BuiltTrace },
		b: { sessionId: string; trace: BuiltTrace },
	): Promise<FullAlignment> {
		const key = `${a.sessionId}\u0000${a.trace.meta.revision}\u0000${b.sessionId}\u0000${b.trace.meta.revision}`;
		const hit = this.entries.get(key);
		if (hit) {
			this.entries.delete(key);
			this.entries.set(key, hit);
			return hit;
		}
		const work = alignSessions(a, b);
		this.entries.set(key, work);
		work.catch(() => this.entries.delete(key));
		while (this.entries.size > this.size) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		return work;
	}
}

/** A side of `sessions.align`: its trace, a pinned snapshot the file moved past when `newerRevision`. */
export interface AlignInput {
	sessionId: string;
	trace: BuiltTrace;
	newerRevision?: boolean;
}

/** `sessions.align`'s answer for two loaded traces (either `null` when not found; `pending` when a side may still be indexed). */
export async function buildSessionsAlign(
	cache: AlignmentCache,
	a: AlignInput | null,
	b: AlignInput | null,
	cursor: number,
	pending = false,
): Promise<SessionsAlignResult> {
	if (!a || !b)
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: false,
			pending,
			alignment: null,
			newerRevision: false,
			sources: METRIC_SOURCES,
		};
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		found: true,
		pending: false,
		alignment: alignmentPage(await cache.get(a, b), cursor),
		newerRevision: a.newerRevision === true || b.newerRevision === true,
		sources: METRIC_SOURCES,
	};
}
