import type { TurnSummary } from "@thinkrail/pi-session-insights/core";
import type { TraceModel } from "../trace/model";

/** A turn's step: one of its model calls with the tools it issued, or a marker or orphan tool result. */
export interface TurnStep {
	index: number;
	tools: readonly number[];
}

export type TurnFilter = "all" | "errors" | "subagents";

/** The turn's direct children in trace order, each model call carrying its tool calls. */
export function turnSteps(model: TraceModel, turn: number): TurnStep[] {
	const steps: TurnStep[] = [];
	const end = model.end[turn] ?? turn + 1;
	for (let at = turn + 1; at < end; at = model.end[at] ?? at + 1) {
		const event = model.at(at);
		if (!event) break;
		const tools: number[] = [];
		if (event.kind === "llm") {
			const callEnd = model.end[at] ?? at + 1;
			for (let child = at + 1; child < callEnd; child = model.end[child] ?? child + 1)
				if (model.at(child)?.kind === "tool") tools.push(child);
		}
		steps.push({ index: at, tools });
	}
	return steps;
}

/** The turn event an event belongs to (itself for a turn), `-1` outside every turn. */
export function turnOf(model: TraceModel, index: number): number {
	if (model.at(index)?.kind === "turn") return index;
	const turn = model.ancestors(index).find((at) => model.at(at)?.kind === "turn");
	return turn ?? -1;
}

export function keepTurn(turn: TurnSummary, filter: TurnFilter): boolean {
	if (filter === "errors") return (turn.errors.value ?? 0) > 0;
	if (filter === "subagents") return (turn.subagents.value ?? 0) > 0;
	return true;
}

/** The turn and step that hold an event: what the cards expand and highlight for a selection. */
export function locateInTurn(
	model: TraceModel,
	index: number,
): { turn: number; step: number | null } | null {
	const turn = turnOf(model, index);
	if (turn < 0) return null;
	if (turn === index) return { turn, step: null };
	let step = index;
	for (let at = model.parent[index] ?? -1; at >= 0 && at !== turn; at = model.parent[at] ?? -1)
		step = at;
	return { turn, step };
}
