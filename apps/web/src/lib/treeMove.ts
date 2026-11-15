export interface TreeMoveRow {
	level: number;
	expanded: boolean | undefined;
}

export type TreeMove = { kind: "focus"; index: number } | { kind: "toggle" } | { kind: "stay" };

const STAY: TreeMove = { kind: "stay" };
const TOGGLE: TreeMove = { kind: "toggle" };
const focusRow = (index: number): TreeMove => ({ kind: "focus", index });

export function resolveTreeMove(
	key: string,
	rows: readonly TreeMoveRow[],
	index: number,
): TreeMove | null {
	const row = rows[index];
	if (!row) return null;
	switch (key) {
		case "ArrowDown":
			return index + 1 < rows.length ? focusRow(index + 1) : STAY;
		case "ArrowUp":
			return index > 0 ? focusRow(index - 1) : STAY;
		case "Home":
			return focusRow(0);
		case "End":
			return focusRow(rows.length - 1);
		case "ArrowRight":
			if (row.expanded === false) return TOGGLE;
			return row.expanded === true && (rows[index + 1]?.level ?? 0) > row.level
				? focusRow(index + 1)
				: STAY;
		case "ArrowLeft": {
			if (row.expanded === true) return TOGGLE;
			const parent = rows.slice(0, index).findLastIndex((other) => other.level < row.level);
			return parent >= 0 ? focusRow(parent) : STAY;
		}
		default:
			return null;
	}
}
