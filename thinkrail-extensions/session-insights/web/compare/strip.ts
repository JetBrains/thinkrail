import type { AlignTurn } from "@thinkrail/pi-session-insights/core";

/** The turn strip's width in its view box units. */
export const STRIP_W = 1000;
/** The gap between two turn blocks while the turns are few. */
const STRIP_GAP = 4;
/** At most this share of the strip goes to gaps, so many turns shrink them instead of their blocks. */
const GAP_SHARE = 0.2;
/** A turn's least width in calls, so a turn without calls still shows. */
const MIN_UNITS = 3;

export interface TurnBlock {
	turn: AlignTurn;
	x: number;
	width: number;
}

/**
 * Both sessions' turns as blocks in order, sized by calls on one scale. The gaps between blocks take
 * `STRIP_GAP` units, or less once they would pass `GAP_SHARE` of the strip, so every block keeps a
 * positive width and the longer side fills the strip exactly.
 */
export function turnBlocks(
	a: readonly AlignTurn[],
	b: readonly AlignTurn[],
): { a: TurnBlock[]; b: TurnBlock[] } {
	const units = (turn: AlignTurn) => Math.max(MIN_UNITS, turn.calls);
	const sum = (turns: readonly AlignTurn[]) =>
		turns.reduce((total, turn) => total + units(turn), 0);
	const gaps = Math.max(a.length, b.length) - 1;
	const gap = gaps > 0 ? Math.min(STRIP_GAP, (STRIP_W * GAP_SHARE) / gaps) : 0;
	const perUnit = (STRIP_W - gap * Math.max(0, gaps)) / Math.max(1, sum(a), sum(b));
	const place = (turns: readonly AlignTurn[]) => {
		let x = 0;
		return turns.map((turn) => {
			const width = units(turn) * perUnit;
			const block = { turn, x, width };
			x += width + gap;
			return block;
		});
	};
	return { a: place(a), b: place(b) };
}
