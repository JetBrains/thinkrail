import type { AnnotationSide, FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { CursorCommand } from "../../support/cursorKeys";
import { COLLAPSED_CONTEXT_THRESHOLD } from "./pierreReview";

export interface DiffRow {
	deletions?: number;
	additions?: number;
	changed: boolean;
}

export type DiffCursorLayout = "split" | "unified";

export interface DiffCursor {
	line: number;
	side: AnnotationSide;
}

export interface DiffCursorState {
	cursor: DiffCursor;
	anchor: DiffCursor | null;
}

export type DiffCursorOutcome =
	| { kind: "state"; state: DiffCursorState }
	| { kind: "comment"; range: SelectedLineRange }
	| { kind: "leave" };

function contextRows(rows: DiffRow[], deletion: number, addition: number, count: number): void {
	for (let index = 0; index < count; index++) {
		rows.push({ deletions: deletion + index, additions: addition + index, changed: false });
	}
}

function sideStart(start: number, count: number): number {
	return start - (count === 0 ? 0 : 1) + 1;
}

export function diffCursorRows(
	fileDiff: FileDiffMetadata,
	layout: DiffCursorLayout,
	collapsedContextThreshold = COLLAPSED_CONTEXT_THRESHOLD,
): DiffRow[] {
	const rows: DiffRow[] = [];
	let deletion = 1;
	let addition = 1;
	for (const hunk of fileDiff.hunks) {
		deletion = sideStart(hunk.deletionStart, hunk.deletionCount);
		addition = sideStart(hunk.additionStart, hunk.additionCount);
		const before = Math.max(0, hunk.collapsedBefore);
		if (!fileDiff.isPartial && before > 0 && before <= collapsedContextThreshold) {
			contextRows(rows, deletion - before, addition - before, before);
		}
		for (const content of hunk.hunkContent) {
			if (content.type === "context") {
				contextRows(rows, deletion, addition, content.lines);
				deletion += content.lines;
				addition += content.lines;
				continue;
			}
			if (layout === "split") {
				for (let index = 0; index < Math.max(content.deletions, content.additions); index++) {
					rows.push({
						...(index < content.deletions ? { deletions: deletion + index } : {}),
						...(index < content.additions ? { additions: addition + index } : {}),
						changed: true,
					});
				}
			} else {
				for (let index = 0; index < content.deletions; index++) {
					rows.push({ deletions: deletion + index, changed: true });
				}
				for (let index = 0; index < content.additions; index++) {
					rows.push({ additions: addition + index, changed: true });
				}
			}
			deletion += content.deletions;
			addition += content.additions;
		}
	}
	const remaining = fileDiff.additionLines.length - addition + 1;
	if (
		fileDiff.hunks.length > 0 &&
		!fileDiff.isPartial &&
		fileDiff.additionLines.length > 0 &&
		fileDiff.deletionLines.length > 0 &&
		remaining > 0 &&
		remaining === fileDiff.deletionLines.length - deletion + 1 &&
		remaining <= collapsedContextThreshold
	) {
		contextRows(rows, deletion, addition, remaining);
	}
	return rows;
}

function rowCursor(
	row: DiffRow,
	layout: DiffCursorLayout,
	side: AnnotationSide,
): DiffCursor | null {
	const own: AnnotationSide =
		layout === "unified" ? (row.additions === undefined ? "deletions" : "additions") : side;
	const line = row[own];
	return line === undefined ? null : { line, side: own };
}

function sameSide(next: DiffCursor, side: AnnotationSide, layout: DiffCursorLayout): boolean {
	return layout === "unified" || next.side === side;
}

export function diffCursorRow(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
	cursor: DiffCursor,
): number {
	return rows.findIndex((row) => {
		const at = rowCursor(row, layout, cursor.side);
		return at?.side === cursor.side && at.line === cursor.line;
	});
}

export function diffCursorStop(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
	cursor: DiffCursor,
): { position: number; size: number } {
	let position = 0;
	let size = 0;
	for (const row of rows) {
		const at = rowCursor(row, layout, cursor.side);
		if (!at || !sameSide(at, cursor.side, layout)) continue;
		size += 1;
		if (at.side === cursor.side && at.line === cursor.line) position = size;
	}
	return { position, size };
}

export function diffLineText(fileDiff: FileDiffMetadata, cursor: DiffCursor): string {
	if (fileDiff.isPartial) return "";
	const lines = cursor.side === "deletions" ? fileDiff.deletionLines : fileDiff.additionLines;
	return lines[cursor.line - 1]?.trim() ?? "";
}

export function initialDiffCursor(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
): DiffCursor | null {
	const row = rows.find((candidate) => candidate.changed) ?? rows[0];
	if (!row) return null;
	return rowCursor(row, layout, row.additions === undefined ? "deletions" : "additions");
}

export function snapDiffCursor(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
	cursor: DiffCursor | null,
): DiffCursor | null {
	if (!cursor) return initialDiffCursor(rows, layout);
	if (diffCursorRow(rows, layout, cursor) >= 0) return cursor;
	const sameRow = rows.find((row) => row[cursor.side] === cursor.line);
	const mapped = sameRow ? rowCursor(sameRow, layout, cursor.side) : null;
	if (mapped) return mapped;
	let best: DiffCursor | null = null;
	for (const row of rows) {
		const at = rowCursor(row, layout, cursor.side);
		if (!at || at.side !== cursor.side) continue;
		if (!best || Math.abs(at.line - cursor.line) < Math.abs(best.line - cursor.line)) best = at;
	}
	return best ?? initialDiffCursor(rows, layout);
}

function step(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
	cursor: DiffCursor,
	delta: 1 | -1,
): DiffCursor {
	for (
		let index = diffCursorRow(rows, layout, cursor) + delta;
		index >= 0 && index < rows.length;
		index += delta
	) {
		const row = rows[index];
		const next = row ? rowCursor(row, layout, cursor.side) : null;
		if (next && sameSide(next, cursor.side, layout)) return next;
	}
	return cursor;
}

function edge(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
	cursor: DiffCursor,
	which: "first" | "last",
): DiffCursor {
	const ordered = which === "first" ? rows : [...rows].reverse();
	for (const row of ordered) {
		const next = rowCursor(row, layout, cursor.side);
		if (next && sameSide(next, cursor.side, layout)) return next;
	}
	return cursor;
}

function sideSwitch(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
	cursor: DiffCursor,
	side: AnnotationSide,
): DiffCursor {
	if (layout === "unified") return cursor;
	const line = rows[diffCursorRow(rows, layout, cursor)]?.[side];
	return line === undefined ? cursor : { line, side };
}

export function diffCursorRange(state: DiffCursorState): SelectedLineRange {
	const start = state.anchor ?? state.cursor;
	return {
		start: start.line,
		side: start.side,
		end: state.cursor.line,
		endSide: state.cursor.side,
	};
}

function moved(state: DiffCursorState, next: DiffCursor, extend: boolean): DiffCursorOutcome {
	return {
		kind: "state",
		state: { cursor: next, anchor: extend ? (state.anchor ?? state.cursor) : null },
	};
}

export function diffCursorCommand(
	rows: readonly DiffRow[],
	layout: DiffCursorLayout,
	state: DiffCursorState,
	command: CursorCommand,
): DiffCursorOutcome {
	if (command.kind === "comment") return { kind: "comment", range: diffCursorRange(state) };
	if (command.kind === "escape") {
		return state.anchor ? { kind: "state", state: { ...state, anchor: null } } : { kind: "leave" };
	}
	if (command.kind === "edge") {
		return moved(state, edge(rows, layout, state.cursor, command.edge), command.extend);
	}
	if (command.direction === "up" || command.direction === "down") {
		const next = step(rows, layout, state.cursor, command.direction === "down" ? 1 : -1);
		return moved(state, next, command.extend);
	}
	if (command.extend) return { kind: "state", state };
	const side = command.direction === "left" ? "deletions" : "additions";
	return {
		kind: "state",
		state: { cursor: sideSwitch(rows, layout, state.cursor, side), anchor: null },
	};
}
