export interface GridPosition {
	row: number;
	col: number;
}

export interface GridCell extends GridPosition {
	key: string;
	tabIndex: 0 | -1;
}

const PAGE_ROWS = 10;

export function gridAttributes(cell: GridCell) {
	return {
		"data-grid-key": cell.key,
		"data-grid-row": cell.row,
		"data-grid-col": cell.col,
		tabIndex: cell.tabIndex,
	};
}

export function gridPosition(element: HTMLElement): (GridPosition & { key: string }) | null {
	const { gridKey, gridRow, gridCol } = element.dataset;
	const row = Number(gridRow);
	const col = Number(gridCol);
	if (gridKey === undefined || !Number.isInteger(row) || !Number.isInteger(col)) return null;
	return { key: gridKey, row, col };
}

function at(row: number, col: number, widths: readonly number[]): GridPosition | null {
	const width = widths[row];
	if (width === undefined || width === 0) return null;
	return { row, col: Math.max(0, Math.min(col, width - 1)) };
}

export function gridMove(
	key: string,
	jump: boolean,
	from: GridPosition,
	widths: readonly number[],
): GridPosition | null {
	const last = widths.length - 1;
	const width = widths[from.row] ?? 0;
	switch (key) {
		case "ArrowRight":
			return from.col + 1 < width ? { row: from.row, col: from.col + 1 } : null;
		case "ArrowLeft":
			return from.col > 0 ? { row: from.row, col: from.col - 1 } : null;
		case "ArrowDown":
			return from.row < last ? at(from.row + 1, from.col, widths) : null;
		case "ArrowUp":
			return from.row > 0 ? at(from.row - 1, from.col, widths) : null;
		case "PageDown":
			return from.row < last ? at(Math.min(last, from.row + PAGE_ROWS), from.col, widths) : null;
		case "PageUp":
			return from.row > 0 ? at(Math.max(0, from.row - PAGE_ROWS), from.col, widths) : null;
		case "Home":
			return jump ? at(0, 0, widths) : { row: from.row, col: 0 };
		case "End":
			return jump ? at(last, Number.MAX_SAFE_INTEGER, widths) : at(from.row, width - 1, widths);
		default:
			return null;
	}
}
