import type {
	AlignRow,
	AlignStep,
	AlignTurn,
	SessionAlignment,
	TurnPair,
} from "@thinkrail/pi-session-insights/core";

/** A line of the aligned columns: a turn heading, an aligned row, or a folded run of one-sided rows. */
export type AlignItem =
	| { kind: "turn"; key: string; pair: TurnPair | null; a: AlignTurn | null; b: AlignTurn | null }
	| { kind: "row"; key: string; row: AlignRow }
	| { kind: "fold"; key: string; side: "a" | "b"; rows: readonly AlignRow[] };

/** One-sided runs at least this long fold into one line until opened. */
export const FOLD_ROWS = 3;

function plain(step: AlignStep | undefined): boolean {
	return (
		step !== undefined &&
		!step.failed &&
		step.activity !== "ask" &&
		step.activity !== "subagent" &&
		step.activity !== "skill"
	);
}

/**
 * The lines to draw, from the server's rows: a heading wherever the turn (pair) changes, runs of plain
 * one-sided rows folded unless opened, and only the differences when asked. Presentation only.
 */
export function alignItems(
	alignment: Pick<SessionAlignment, "a" | "b" | "pairs">,
	rows: readonly AlignRow[],
	stepsA: ReadonlyMap<number, AlignStep>,
	stepsB: ReadonlyMap<number, AlignStep>,
	options: { differences: boolean; open: ReadonlySet<string> },
): AlignItem[] {
	const items: AlignItem[] = [];
	let block: string | null = null;
	let at = 0;
	const blockOf = (row: AlignRow): string => {
		if (row.pair !== null) return `p${row.pair}`;
		if (row.a !== null) return `a${stepsA.get(row.a)?.turn ?? -1}`;
		return `b${row.b === null ? -1 : (stepsB.get(row.b)?.turn ?? -1)}`;
	};
	while (at < rows.length) {
		const row = rows[at] as AlignRow;
		const id = blockOf(row);
		if (id !== block) {
			block = id;
			if (row.pair !== null) {
				const pair = alignment.pairs[row.pair] ?? null;
				items.push({
					kind: "turn",
					key: `turn:${id}`,
					pair,
					a: pair ? (alignment.a.turns[pair.a] ?? null) : null,
					b: pair ? (alignment.b.turns[pair.b] ?? null) : null,
				});
			} else if (row.a !== null) {
				const turn = stepsA.get(row.a)?.turn ?? -1;
				items.push({
					kind: "turn",
					key: `turn:${id}`,
					pair: null,
					a: alignment.a.turns[turn] ?? null,
					b: null,
				});
			} else {
				const turn = row.b === null ? -1 : (stepsB.get(row.b)?.turn ?? -1);
				items.push({
					kind: "turn",
					key: `turn:${id}`,
					pair: null,
					a: null,
					b: alignment.b.turns[turn] ?? null,
				});
			}
		}
		if (row.op === "onlyA" || row.op === "onlyB") {
			let end = at;
			while (end < rows.length && rows[end]?.op === row.op && blockOf(rows[end] as AlignRow) === id)
				end += 1;
			const run = rows.slice(at, end);
			const side = row.op === "onlyA" ? "a" : "b";
			const steps = side === "a" ? stepsA : stepsB;
			const foldKey = `fold:${side}:${side === "a" ? row.a : row.b}`;
			const foldable =
				run.length >= FOLD_ROWS &&
				run.every((entry) => plain(steps.get((side === "a" ? entry.a : entry.b) ?? -1)));
			if (foldable && !options.open.has(foldKey))
				items.push({ kind: "fold", key: foldKey, side, rows: run });
			else
				for (const entry of run)
					items.push({ kind: "row", key: `row:${entry.a ?? ""}:${entry.b ?? ""}`, row: entry });
			at = end;
			continue;
		}
		if (!(options.differences && row.op === "same"))
			items.push({ kind: "row", key: `row:${row.a ?? ""}:${row.b ?? ""}`, row });
		at += 1;
	}
	return items;
}
