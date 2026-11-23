import type { SearchFilter, SearchFilterKey, SkillActivation } from "./core.ts";
import { failureKey } from "./friction.ts";
import { skillActivations, turnsOf } from "./plan.ts";
import type { BuiltTrace } from "./trace.ts";

export const KIND_TURN = 0;
export const KIND_LLM = 1;
export const KIND_TOOL = 2;

/** Strings the search columns share across sessions, by id: append-only, one per process. */
export class Interner {
	private readonly ids = new Map<string, number>();
	private readonly values: string[] = [];

	id(value: string): number {
		let id = this.ids.get(value);
		if (id === undefined) {
			id = this.values.length;
			this.values.push(value);
			this.ids.set(value, id);
		}
		return id;
	}

	/** `""` for -1 (no value). */
	value(id: number): string {
		return id < 0 ? "" : (this.values[id] ?? "");
	}
}

export const searchStrings = new Interner();

/** Events per value of a dimension (interned id → count), so a scope's vocabulary is a merge of maps. */
export interface SearchCounts {
	tool: Map<number, number>;
	model: Map<number, number>;
	skill: Map<number, number>;
	path: Map<number, number>;
	cluster: Map<number, number>;
}

/**
 * One session's searchable events (prompts, model calls, tool calls of the active branch, in trace
 * order) as columns: facets as interned ids, and the byte ranges of each event's line (and a tool's
 * result line) so free text is matched by reading only those lines. No text is kept.
 */
export interface SearchColumns {
	file: string;
	revision: string;
	length: number;
	kind: Uint8Array;
	turn: Uint32Array;
	t: Float64Array;
	tool: Int32Array;
	model: Int32Array;
	skill: Int32Array;
	/** A `read` / `edit` / `write` call's workspace-relative file. */
	path: Int32Array;
	/** A failure's error cluster key; -1 otherwise. */
	cluster: Int32Array;
	error: Uint8Array;
	/** Index into `entryIds`: the event's entry (an orphan tool result's own entry). */
	entry: Int32Array;
	/** A tool call's index among its message's calls; -1 for other events and orphan results. */
	call: Int32Array;
	/** The event's own line (a tool's call line); -1 when it has none (an orphan result). */
	lineAt: Float64Array;
	lineLength: Uint32Array;
	/** A tool's result line; -1 when it has none. */
	resultAt: Float64Array;
	resultLength: Uint32Array;
	entryIds: readonly string[];
	counts: SearchCounts;
}

function bump(map: Map<number, number>, id: number): void {
	if (id >= 0) map.set(id, (map.get(id) ?? 0) + 1);
}

/** The skill in action at `t` inside `turn`: the latest activation whose scope covers it. */
function skillAt(
	activations: readonly SkillActivation[] | undefined,
	t: number,
): SkillActivation | null {
	let found: SkillActivation | null = null;
	for (const activation of activations ?? [])
		if (activation.t <= t && t < activation.scopeEnd) found = activation;
	return found;
}

/** The search columns of a built trace. Deterministic; ids are only meaningful inside the process. */
export function searchColumns(trace: BuiltTrace, strings: Interner = searchStrings): SearchColumns {
	const events = trace.events.filter(
		(event) => event.kind === "turn" || event.kind === "llm" || event.kind === "tool",
	);
	const n = events.length;
	const columns: SearchColumns = {
		file: trace.file,
		revision: trace.meta.revision,
		length: n,
		kind: new Uint8Array(n),
		turn: new Uint32Array(n),
		t: new Float64Array(n),
		tool: new Int32Array(n).fill(-1),
		model: new Int32Array(n).fill(-1),
		skill: new Int32Array(n).fill(-1),
		path: new Int32Array(n).fill(-1),
		cluster: new Int32Array(n).fill(-1),
		error: new Uint8Array(n),
		entry: new Int32Array(n),
		call: new Int32Array(n).fill(-1),
		lineAt: new Float64Array(n).fill(-1),
		lineLength: new Uint32Array(n),
		resultAt: new Float64Array(n).fill(-1),
		resultLength: new Uint32Array(n),
		entryIds: [],
		counts: {
			tool: new Map(),
			model: new Map(),
			skill: new Map(),
			path: new Map(),
			cluster: new Map(),
		},
	};
	const turnOf = turnsOf(trace.events);
	const byTurn = new Map<string | null, SkillActivation[]>();
	for (const activation of skillActivations(trace, turnOf)) {
		const turn = turnOf.get(activation.eventId) ?? null;
		const list = byTurn.get(turn) ?? [];
		list.push(activation);
		byTurn.set(turn, list);
	}
	const entryIds: string[] = [];
	const entryIndex = new Map<string, number>();
	const entryOf = (id: string) => {
		let index = entryIndex.get(id);
		if (index === undefined) {
			index = entryIds.length;
			entryIds.push(id);
			entryIndex.set(id, index);
		}
		return index;
	};
	let turnN = 0;
	let model = -1;
	let unanswered = -1;
	events.forEach((event, pos) => {
		const source = trace.sources.get(event.id);
		columns.t[pos] = event.t0;
		if (source) columns.entry[pos] = entryOf(source.entryId);
		switch (event.kind) {
			case "turn":
				turnN = event.n;
				columns.kind[pos] = KIND_TURN;
				unanswered = pos;
				model = -1;
				break;
			case "llm":
				columns.kind[pos] = KIND_LLM;
				model = event.model ? strings.id(event.model) : -1;
				if (unanswered >= 0) {
					columns.model[unanswered] = model;
					bump(columns.counts.model, model);
					unanswered = -1;
				}
				break;
			case "tool": {
				columns.kind[pos] = KIND_TOOL;
				columns.tool[pos] = strings.id(event.tool);
				const file = trace.facts.get(event.id)?.call?.file;
				if (file?.inside) columns.path[pos] = strings.id(file.path);
				break;
			}
		}
		columns.turn[pos] = turnN;
		if (event.kind !== "turn") columns.model[pos] = model;
		if (event.kind !== "turn" && event.error && (event.kind === "llm" || event.kind === "tool")) {
			columns.error[pos] = 1;
			columns.cluster[pos] = strings.id(failureKey(trace, event));
		}
		const activation = skillAt(byTurn.get(turnOf.get(event.id) ?? null), event.t0);
		if (activation) columns.skill[pos] = strings.id(activation.name);
		if (source) {
			if (event.kind === "tool") {
				if (source.callIndex !== undefined) {
					columns.call[pos] = source.callIndex;
					columns.lineAt[pos] = source.range.offset;
					columns.lineLength[pos] = source.range.length;
				}
				if (source.result) {
					columns.resultAt[pos] = source.result.range.offset;
					columns.resultLength[pos] = source.result.range.length;
				}
			} else {
				columns.lineAt[pos] = source.range.offset;
				columns.lineLength[pos] = source.range.length;
			}
		}
		bump(columns.counts.tool, columns.tool[pos] ?? -1);
		if (event.kind !== "turn") bump(columns.counts.model, columns.model[pos] ?? -1);
		bump(columns.counts.skill, columns.skill[pos] ?? -1);
		bump(columns.counts.path, columns.path[pos] ?? -1);
		bump(columns.counts.cluster, columns.cluster[pos] ?? -1);
	});
	columns.entryIds = entryIds;
	return columns;
}

/** The event id the trace gave the event at `pos`. */
export function eventIdAt(columns: SearchColumns, pos: number): string {
	const entry = columns.entryIds[columns.entry[pos] ?? 0] ?? "";
	if (columns.kind[pos] !== KIND_TOOL) return entry;
	const call = columns.call[pos] ?? -1;
	return call >= 0 ? `tool:${entry}:${call}` : `tool:${entry}`;
}

type Predicate = (value: string) => boolean;

/** Filters of a query by key: every key must match, any of its values. */
export interface FilterPlan {
	tool: Predicate | null;
	model: Predicate | null;
	skill: Predicate | null;
	file: Predicate | null;
	project: Predicate | null;
	label: Predicate | null;
	/** `error:yes` passes failures, `error:no` the rest, a cluster value failures in a matching cluster. */
	error: { yes: boolean; no: boolean; cluster: Predicate | null } | null;
}

function valuesOf(filters: readonly SearchFilter[], key: SearchFilterKey): string[] {
	return filters.filter((filter) => filter.key === key).map((filter) => filter.value.toLowerCase());
}

/**
 * Compiles the filters: `tool:` and `skill:` match a value exactly, `model:`, `file:` and an `error:`
 * cluster value match when the value contains the text, `project:` the project's name or id, `label:`
 * one of the session's labels exactly; `skill:none` / `project:none` / `label:none` match events with
 * none. Case-insensitive throughout.
 */
export function filterPlan(filters: readonly SearchFilter[]): FilterPlan {
	const exact = (values: string[]): Predicate | null =>
		values.length === 0
			? null
			: (value) => {
					const lower = value.toLowerCase();
					return values.some((wanted) => (wanted === "none" ? lower === "" : wanted === lower));
				};
	const contains = (values: string[]): Predicate | null =>
		values.length === 0
			? null
			: (value) => {
					if (!value) return false;
					const lower = value.toLowerCase();
					return values.some((wanted) => lower.includes(wanted));
				};
	const errors = valuesOf(filters, "error");
	return {
		tool: exact(valuesOf(filters, "tool")),
		model: contains(valuesOf(filters, "model")),
		skill: exact(valuesOf(filters, "skill")),
		file: contains(valuesOf(filters, "file")),
		project: exact(valuesOf(filters, "project")),
		label: exact(valuesOf(filters, "label")),
		error:
			errors.length === 0
				? null
				: {
						yes: errors.includes("yes"),
						no: errors.includes("no"),
						cluster: contains(errors.filter((value) => value !== "yes" && value !== "no")),
					},
	};
}

/** Memoized per interned id, so a query evaluates each distinct value once. */
function memo(predicate: Predicate | null, strings: Interner): ((id: number) => boolean) | null {
	if (!predicate) return null;
	const seen = new Map<number, boolean>();
	return (id) => {
		let hit = seen.get(id);
		if (hit === undefined) {
			hit = predicate(strings.value(id));
			seen.set(id, hit);
		}
		return hit;
	};
}

export interface CompiledFilters {
	/** Whether a session in the project named `name` (id `id`, both `""` for none) can match at all. */
	project(name: string, id: string): boolean;
	/** Whether a session with these labels can match at all. */
	labels(labels: readonly string[]): boolean;
	/** Positions of the session's events the filters keep, in trace order. */
	matches(columns: SearchColumns): Int32Array;
}

export function compileFilters(
	plan: FilterPlan,
	strings: Interner = searchStrings,
): CompiledFilters {
	const tool = memo(plan.tool, strings);
	const model = memo(plan.model, strings);
	const skill = memo(plan.skill, strings);
	const file = memo(plan.file, strings);
	const error = plan.error;
	const cluster = memo(error?.cluster ?? null, strings);
	const passesError = (columns: SearchColumns, pos: number) => {
		if (!error) return true;
		const failed = columns.error[pos] === 1;
		if (failed ? error.yes : error.no) return true;
		return failed && (cluster?.(columns.cluster[pos] ?? -1) ?? false);
	};
	return {
		project: (name, id) => !plan.project || plan.project(name) || (id !== "" && plan.project(id)),
		labels: (labels) => {
			const label = plan.label;
			if (!label) return true;
			return labels.length === 0 ? label("") : labels.some((item) => label(item));
		},
		matches(columns) {
			const out: number[] = [];
			for (let pos = 0; pos < columns.length; pos++) {
				if (tool && !tool(columns.tool[pos] ?? -1)) continue;
				if (model && !model(columns.model[pos] ?? -1)) continue;
				if (skill && !skill(columns.skill[pos] ?? -1)) continue;
				if (file && !file(columns.path[pos] ?? -1)) continue;
				if (!passesError(columns, pos)) continue;
				out.push(pos);
			}
			return Int32Array.from(out);
		},
	};
}
