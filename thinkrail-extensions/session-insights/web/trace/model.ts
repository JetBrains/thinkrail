import type {
	Interval,
	RecoveryChain,
	RepeatGroup,
	ToolFamily,
	TraceEvent,
} from "@thinkrail/pi-session-insights/core";

/** `selection`: the events a chain, a plan step or a skill picked (see `TraceFocus`). */
export type TraceFilter = "all" | "errors" | "repeats" | "retries" | "selection";

/** Above this many events in the whole trace, turns start collapsed so the first screen stays an outline. */
const OUTLINE_EVENTS = 2500;
/** Focus mode folds this many or more non-matching rows in a row into one "hidden" row. */
export const FOCUS_RUN = 3;

/**
 * The rows the tree shows: an event index, or `-(first + 1)` for a folded run of non-matching rows
 * starting at event `first` (`runs` holds its length). `keep` marks matches and their ancestors.
 */
export interface RowList {
	rows: readonly number[];
	runs: ReadonlyMap<number, number>;
	keep: Uint8Array | null;
}

export interface RowOptions {
	/** Dim and fold non-matching rows instead of hiding them. */
	focus?: boolean;
	/** Events skipped with their subtrees: collapsed repeats. */
	hidden?: Uint8Array | null;
	/** Folded runs the user opened, by their first event index. */
	expanded?: ReadonlySet<number>;
}

export function runRow(first: number): number {
	return -(first + 1);
}

export function runStart(row: number): number {
	return -row - 1;
}

export function isFailure(event: TraceEvent): boolean {
	return event.error === true && (event.kind === "tool" || event.kind === "llm");
}

/** The trace as an index over its pre-order events: parents, subtree extents, ids. */
export class TraceModel {
	readonly events: readonly TraceEvent[];
	readonly parent: Int32Array;
	/** `end[i]`: one past the last descendant of event `i` (pre-order keeps a subtree contiguous). */
	readonly end: Int32Array;
	private readonly index: Map<string, number>;
	private readonly outline: boolean;

	/**
	 * `total`: the session's whole event count (the first page's `meta.total`), so turns start collapsed
	 * or open alike while pages arrive and when subagent transcripts are nested in.
	 */
	constructor(events: readonly TraceEvent[], total: number = events.length) {
		this.events = events;
		this.parent = new Int32Array(events.length).fill(-1);
		this.end = new Int32Array(events.length);
		this.index = new Map(events.map((event, at) => [event.id, at]));
		this.outline = total > OUTLINE_EVENTS;
		const stack: number[] = [];
		events.forEach((event, at) => {
			for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
				if (events[top]?.id === event.parent) break;
				this.end[top] = at;
				stack.pop();
			}
			this.parent[at] = stack.at(-1) ?? -1;
			stack.push(at);
		});
		for (const open of stack) this.end[open] = events.length;
	}

	get size(): number {
		return this.events.length;
	}

	at(index: number): TraceEvent | undefined {
		return this.events[index];
	}

	indexOf(id: string): number {
		return this.index.get(id) ?? -1;
	}

	hasChildren(index: number): boolean {
		return (this.end[index] ?? 0) > index + 1;
	}

	isOpenByDefault(index: number): boolean {
		const event = this.events[index];
		if (!event) return false;
		return event.kind === "turn" ? !this.outline : event.kind !== "subagent";
	}

	isOpen(index: number, open: ReadonlyMap<string, boolean>): boolean {
		const event = this.events[index];
		if (!event || !this.hasChildren(index)) return false;
		return open.get(event.id) ?? this.isOpenByDefault(index);
	}

	ancestors(index: number): number[] {
		const out: number[] = [];
		for (let at = this.parent[index] ?? -1; at >= 0; at = this.parent[at] ?? -1) out.push(at);
		return out;
	}

	/** A mask of the events with these ids. */
	mask(ids: Iterable<string>): Uint8Array {
		const out = new Uint8Array(this.events.length);
		for (const id of ids) {
			const at = this.index.get(id);
			if (at !== undefined) out[at] = 1;
		}
		return out;
	}

	/** Failed calls, as a mask. */
	failureMask(): Uint8Array {
		const out = new Uint8Array(this.events.length);
		this.events.forEach((event, at) => {
			if (isFailure(event)) out[at] = 1;
		});
		return out;
	}

	/** Model calls, tool calls and subagents that started inside any of the intervals. */
	during(intervals: readonly Interval[]): Uint8Array {
		const out = new Uint8Array(this.events.length);
		this.events.forEach((event, at) => {
			if (event.kind !== "llm" && event.kind !== "tool" && event.kind !== "subagent") return;
			if (intervals.some((span) => event.t0 >= span.t0 && event.t0 <= span.t1)) out[at] = 1;
		});
		return out;
	}

	/**
	 * The rows the tree shows, in order. Without a match: open subtrees expanded. With one: only matches
	 * and their ancestors (opened); in focus mode the whole tree with matches' ancestors opened and runs
	 * of non-matching rows folded. Hidden events are skipped with their subtrees.
	 */
	visible(
		open: ReadonlyMap<string, boolean>,
		match: Uint8Array | null,
		options: RowOptions = {},
	): RowList {
		const hidden = options.hidden ?? null;
		const n = this.events.length;
		let keep: Uint8Array | null = null;
		let above: Uint8Array | null = null;
		if (match) {
			keep = new Uint8Array(n);
			above = new Uint8Array(n);
			for (let at = 0; at < n; at++) {
				if (!match[at]) continue;
				keep[at] = 1;
				for (let up = this.parent[at] ?? -1; up >= 0 && !above[up]; up = this.parent[up] ?? -1) {
					above[up] = 1;
					keep[up] = 1;
				}
			}
		}
		const rows: number[] = [];
		let at = 0;
		while (at < n) {
			const skip = hidden?.[at] || (keep && !options.focus && !keep[at]);
			if (skip) {
				at = this.end[at] ?? at + 1;
				continue;
			}
			rows.push(at);
			const expanded =
				keep && !options.focus
					? this.hasChildren(at)
					: this.isOpen(at, open) || (above?.[at] === 1 && this.hasChildren(at));
			at = expanded ? at + 1 : (this.end[at] ?? at + 1);
		}
		if (!keep || !options.focus) return { rows, runs: new Map(), keep };
		const folded: number[] = [];
		const runs = new Map<number, number>();
		for (let k = 0; k < rows.length; ) {
			const row = rows[k] as number;
			if (keep[row]) {
				folded.push(row);
				k += 1;
				continue;
			}
			let next = k;
			while (next < rows.length && !keep[rows[next] as number]) next += 1;
			const length = next - k;
			if (length >= FOCUS_RUN && !options.expanded?.has(row)) {
				folded.push(runRow(row));
				runs.set(row, length);
			} else folded.push(...rows.slice(k, next));
			k = next;
		}
		return { rows: folded, runs, keep };
	}

	failures(): number[] {
		const out: number[] = [];
		this.events.forEach((event, at) => {
			if (isFailure(event)) out.push(at);
		});
		return out;
	}

	/** What happened next: the first calls after an event's own subtree. */
	following(index: number, count: number): number[] {
		const out: number[] = [];
		for (
			let at = this.end[index] ?? index + 1;
			at < this.events.length && out.length < count;
			at++
		) {
			const kind = this.events[at]?.kind;
			if (kind === "tool" || kind === "llm") out.push(at);
		}
		return out;
	}
}

/**
 * Collapsed repeats: every member after the first, and a model call whose tool calls are all hidden
 * (unless the call matches). A group stays unfolded when the user opened it, or when a filter `match`
 * lies inside a member it would fold while its head does not match (a matching head shows with the
 * group's ×N control); `open` is the heads unfolded either way.
 */
export function repeatHidden(
	model: TraceModel,
	repeats: readonly RepeatGroup[],
	opened: ReadonlySet<string>,
	match: Uint8Array | null = null,
): {
	hidden: Uint8Array | null;
	heads: ReadonlyMap<number, RepeatGroup>;
	open: ReadonlySet<string>;
} {
	const heads = new Map<number, RepeatGroup>();
	if (repeats.length === 0) return { hidden: null, heads, open: opened };
	const matched = matchCounts(model, match);
	const holdsMatch = (at: number) =>
		matched !== null && (matched[model.end[at] ?? at + 1] ?? 0) - (matched[at] ?? 0) > 0;
	const open = new Set(opened);
	const hidden = new Uint8Array(model.size);
	for (const group of repeats) {
		const [first, ...rest] = group.ids;
		const head = first === undefined ? -1 : model.indexOf(first);
		if (first === undefined || head < 0) continue;
		heads.set(head, group);
		const members = rest.map((id) => model.indexOf(id)).filter((at) => at >= 0);
		if (!match?.[head] && members.some(holdsMatch)) open.add(first);
		if (open.has(first)) continue;
		for (const at of members) hidden[at] = 1;
	}
	model.events.forEach((event, at) => {
		if (event.kind !== "llm" || !model.hasChildren(at) || match?.[at]) return;
		const end = model.end[at] ?? at + 1;
		let all = true;
		for (let child = at + 1; child < end; child++)
			if (model.parent[child] === at && !hidden[child]) all = false;
		if (all) hidden[at] = 1;
	});
	return { hidden, heads, open };
}

/** `counts[i]`: matches before event `i`, so a subtree's matches are `counts[end] - counts[start]`. */
function matchCounts(model: TraceModel, match: Uint8Array | null): Int32Array | null {
	if (!match) return null;
	const counts = new Int32Array(model.size + 1);
	for (let at = 0; at < model.size; at++) counts[at + 1] = (counts[at] ?? 0) + (match[at] ? 1 : 0);
	return counts;
}

/**
 * `opened` with every repeat that folds `index` away unfolded — a member after the first, an event inside
 * one, or a model call folding with its calls — so a selection is never inside a fold; `opened` itself
 * when nothing folds it.
 */
export function unfoldFor(
	model: TraceModel,
	repeats: readonly RepeatGroup[],
	opened: ReadonlySet<string>,
	index: number,
	match: Uint8Array | null = null,
): ReadonlySet<string> {
	const headOf = new Map<number, string>();
	for (const group of repeats)
		for (const id of group.ids.slice(1)) {
			const at = model.indexOf(id);
			if (at >= 0 && group.ids[0]) headOf.set(at, group.ids[0]);
		}
	const path = [...model.ancestors(index).reverse(), index];
	let next = opened;
	for (let round = 0; round <= path.length; round++) {
		const { hidden } = repeatHidden(model, repeats, next, match);
		const folded = path.find((at) => hidden?.[at] === 1);
		if (folded === undefined) return next;
		const event = model.at(folded);
		const groups = new Set<string>();
		if (event?.kind === "llm") {
			for (let child = folded + 1; child < (model.end[folded] ?? folded + 1); child++) {
				const head = model.parent[child] === folded ? headOf.get(child) : undefined;
				if (head) groups.add(head);
			}
		} else {
			const head = headOf.get(folded);
			if (head) groups.add(head);
		}
		if ([...groups].every((head) => next.has(head))) return next;
		next = new Set([...next, ...groups]);
	}
	return next;
}

/** Event ids of tool chains with a retry: the `r`/`R` targets and the Retries filter. */
export function retryIds(chains: readonly RecoveryChain[]): string[] {
	return chains
		.filter((chain) => chain.kind === "tool" && chain.attempts.length > 1)
		.flatMap((chain) => chain.attempts);
}

/** The open map with every ancestor of `index` opened, so a selection is never hidden inside a closed row. */
export function revealed(
	model: TraceModel,
	open: ReadonlyMap<string, boolean>,
	index: number,
): ReadonlyMap<string, boolean> {
	const closed = model.ancestors(index).filter((at) => !model.isOpen(at, open));
	if (closed.length === 0) return open;
	const next = new Map(open);
	for (const at of closed) {
		const id = model.at(at)?.id;
		if (id) next.set(id, true);
	}
	return next;
}

/** The next (`step` 1) or previous (-1) index in `candidates` from `from`, wrapping around. */
export function cycle(candidates: readonly number[], from: number, step: 1 | -1): number | null {
	if (step === 1) return candidates.find((at) => at > from) ?? candidates[0] ?? null;
	return candidates.findLast((at) => at < from) ?? candidates.at(-1) ?? null;
}

export type SeriesKey =
	| "series-1"
	| "series-2"
	| "series-3"
	| "series-4"
	| "series-5"
	| "series-6"
	| "series-7"
	| "series-8"
	| "primary";

export const FAMILY_SERIES = {
	discovery: "series-1",
	writing: "series-2",
	execution: "series-4",
	reading: "series-5",
	subagent: "series-6",
	planning: "series-7",
	other: "series-8",
	ask: "primary",
} as const satisfies Record<ToolFamily, SeriesKey>;

export const LLM_SERIES: SeriesKey = "series-3";

export function seriesOf(event: TraceEvent): SeriesKey | null {
	switch (event.kind) {
		case "llm":
			return LLM_SERIES;
		case "tool":
			return FAMILY_SERIES[event.family];
		case "subagent":
			return FAMILY_SERIES.subagent;
		default:
			return null;
	}
}
