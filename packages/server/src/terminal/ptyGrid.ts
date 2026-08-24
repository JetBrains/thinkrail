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

// The restore must stay deferred and grid-checked; see terminal/SPEC.md.
export const NUDGE_RESTORE_DELAY_MS = 50;

export interface NudgePtyRedrawOptions {
	isStillLive?: () => boolean;
	schedule?: (fn: () => void, ms: number) => void;
}

export function nudgePtyRedraw(
	pty: PtyResizer,
	current: PtyGrid,
	options: NudgePtyRedrawOptions = {},
): void {
	const { cols, rows } = current;
	const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
	const isStillLive = options.isStillLive ?? (() => true);
	const restore = (): void => {
		if (!isStillLive()) return;
		if (current.cols !== cols || current.rows !== rows) return;
		pty.resize(cols, rows);
	};
	if (cols > 1) {
		pty.resize(cols - 1, rows);
		schedule(restore, NUDGE_RESTORE_DELAY_MS);
	} else if (rows > 1) {
		pty.resize(cols, rows - 1);
		schedule(restore, NUDGE_RESTORE_DELAY_MS);
	}
}
