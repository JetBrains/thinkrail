export interface PtyGrid {
	cols: number;
	rows: number;
}

interface PtyResizer {
	resize(cols: number, rows: number): void;
}

export function resizePtyIfChanged(pty: PtyResizer, current: PtyGrid, next: PtyGrid): boolean {
	if (current.cols === next.cols && current.rows === next.rows) return false;
	pty.resize(next.cols, next.rows);
	current.cols = next.cols;
	current.rows = next.rows;
	return true;
}
