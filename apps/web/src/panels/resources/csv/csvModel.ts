import type { ReviewAnchor } from "@thinkrail/contracts";
import { diffArrays } from "diff";
import type { AnchorDraft, ReviewThread } from "@/resources";

export interface CsvRow {
	index: number;
	cells: string[];
	startLine: number;
	endLine: number;
	raw: string;
}

export type CsvDelimiter = "," | "\t" | ";" | "|";

export interface CsvTable {
	delimiter: CsvDelimiter;
	rows: CsvRow[];
}

export interface CsvCell {
	row: number;
	col: number;
}

export interface CsvSelection {
	anchor: CsvCell;
	focus: CsvCell;
}

export type AlignedCsvRow =
	| { kind: "unchanged"; original: CsvRow; modified: CsvRow; changedCells: readonly number[] }
	| { kind: "added"; modified: CsvRow; changedCells: readonly number[] }
	| { kind: "removed"; original: CsvRow; changedCells: readonly number[] }
	| {
			kind: "changed";
			original: CsvRow;
			modified: CsvRow;
			changedCells: readonly number[];
	  };

const SNIFFED_DELIMITERS: readonly CsvDelimiter[] = [",", ";", "\t", "|"];

function unquotedCount(line: string, delimiter: CsvDelimiter): number {
	let count = 0;
	let inQuotes = false;
	for (const char of line) {
		if (char === '"') inQuotes = !inQuotes;
		else if (char === delimiter && !inQuotes) count += 1;
	}
	return count;
}

function firstNonEmptyLine(text: string): string | undefined {
	return text
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.find((line) => line.trim() !== "");
}

export function sniffDelimiter(path: string, ...texts: readonly string[]): CsvDelimiter {
	if (path.toLowerCase().endsWith(".tsv")) return "\t";
	const header = texts.map(firstNonEmptyLine).find((line) => line !== undefined);
	if (header === undefined) return ",";
	const counts = SNIFFED_DELIMITERS.map((delimiter) => ({
		delimiter,
		count: unquotedCount(header, delimiter),
	}));
	const top = Math.max(...counts.map(({ count }) => count));
	const leaders = counts.filter(({ count }) => count === top);
	return top > 0 && leaders.length === 1 ? (leaders[0]?.delimiter ?? ",") : ",";
}

export function parseCsv(text: string, delimiter: CsvDelimiter = ","): CsvTable {
	if (text.length === 0) return { delimiter, rows: [] };
	const rows: CsvRow[] = [];
	let cells: string[] = [];
	let field = "";
	let inQuotes = false;
	let line = 1;
	let rowStartLine = 1;
	let rowStartOffset = 0;
	let index = 0;

	const finishRow = (endOffset: number) => {
		cells.push(field);
		rows.push({
			index: rows.length,
			cells,
			startLine: rowStartLine,
			endLine: line,
			raw: text.slice(rowStartOffset, endOffset),
		});
		cells = [];
		field = "";
	};

	while (index < text.length) {
		const char = text[index] ?? "";
		if (inQuotes) {
			if (char === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index += 2;
					continue;
				}
				inQuotes = false;
				index += 1;
				continue;
			}
			if (char === "\r" && text[index + 1] === "\n") {
				field += "\n";
				line += 1;
				index += 2;
				continue;
			}
			if (char === "\n" || char === "\r") {
				field += "\n";
				line += 1;
				index += 1;
				continue;
			}
			field += char;
			index += 1;
			continue;
		}

		if (char === '"' && field.length === 0) {
			inQuotes = true;
			index += 1;
			continue;
		}
		if (char === delimiter) {
			cells.push(field);
			field = "";
			index += 1;
			continue;
		}
		if (char === "\r" || char === "\n") {
			finishRow(index);
			if (char === "\r" && text[index + 1] === "\n") index += 2;
			else index += 1;
			line += 1;
			rowStartLine = line;
			rowStartOffset = index;
			continue;
		}
		field += char;
		index += 1;
	}

	if (rowStartOffset < text.length || cells.length > 0 || field.length > 0) finishRow(text.length);
	return { delimiter, rows };
}

export function changedCellIndices(original: CsvRow, modified: CsvRow): number[] {
	const length = Math.max(original.cells.length, modified.cells.length);
	const changed: number[] = [];
	for (let index = 0; index < length; index += 1) {
		if (original.cells[index] !== modified.cells[index]) changed.push(index);
	}
	return changed;
}

export function alignCsvRows(
	original: readonly CsvRow[],
	modified: readonly CsvRow[],
): AlignedCsvRow[] {
	const changes = diffArrays(
		original.map((row) => row.raw),
		modified.map((row) => row.raw),
	);
	const aligned: AlignedCsvRow[] = [];
	let originalIndex = 0;
	let modifiedIndex = 0;
	for (let index = 0; index < changes.length; index += 1) {
		const change = changes[index];
		if (!change) continue;
		const next = changes[index + 1];
		const removedThenAdded = change.removed && next?.added;
		const addedThenRemoved = change.added && next?.removed;
		if ((removedThenAdded || addedThenRemoved) && change.count === next.count) {
			const count = change.count;
			for (let offset = 0; offset < count; offset += 1) {
				const oldRow = original[originalIndex + offset];
				const newRow = modified[modifiedIndex + offset];
				if (oldRow && newRow) {
					aligned.push({
						kind: "changed",
						original: oldRow,
						modified: newRow,
						changedCells: changedCellIndices(oldRow, newRow),
					});
				}
			}
			originalIndex += count;
			modifiedIndex += count;
			index += 1;
			continue;
		}
		if (change.removed) {
			for (let offset = 0; offset < change.count; offset += 1) {
				const row = original[originalIndex + offset];
				if (row) aligned.push({ kind: "removed", original: row, changedCells: [] });
			}
			originalIndex += change.count;
			continue;
		}
		if (change.added) {
			for (let offset = 0; offset < change.count; offset += 1) {
				const row = modified[modifiedIndex + offset];
				if (row) aligned.push({ kind: "added", modified: row, changedCells: [] });
			}
			modifiedIndex += change.count;
			continue;
		}
		for (let offset = 0; offset < change.count; offset += 1) {
			const oldRow = original[originalIndex + offset];
			const newRow = modified[modifiedIndex + offset];
			if (oldRow && newRow) {
				aligned.push({ kind: "unchanged", original: oldRow, modified: newRow, changedCells: [] });
			}
		}
		originalIndex += change.count;
		modifiedIndex += change.count;
	}
	return aligned;
}

export function csvSelectionDraft(
	rows: readonly CsvRow[],
	selection: CsvSelection,
): AnchorDraft | null {
	const firstRow = Math.min(selection.anchor.row, selection.focus.row);
	const lastRow = Math.max(selection.anchor.row, selection.focus.row);
	const sourceRows = rows.slice(firstRow, lastRow + 1);
	const anchorRow = rows[selection.anchor.row];
	if (!anchorRow || selection.anchor.col < 0 || selection.anchor.col >= anchorRow.cells.length) {
		return null;
	}
	if (sourceRows.length === 0) return null;
	return {
		selectors: [
			{
				kind: "lineRange",
				startLine: Math.min(...sourceRows.map((row) => row.startLine)),
				endLine: Math.max(...sourceRows.map((row) => row.endLine)),
			},
			{
				kind: "structural",
				scheme: "table-cell",
				ref: `${selection.anchor.row}:${selection.anchor.col}`,
			},
		],
		label: `R${selection.anchor.row}C${selection.anchor.col}`,
	};
}

export function tableCellOfAnchor(anchor: ReviewAnchor, rows: readonly CsvRow[]): CsvCell | null {
	const selector = anchor.selectors.find(
		(candidate) => candidate.kind === "structural" && candidate.scheme === "table-cell",
	);
	if (selector?.kind !== "structural") return null;
	const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(selector.ref);
	if (!match) return null;
	const row = Number(match[1]);
	const col = Number(match[2]);
	const sourceRow = rows[row];
	if (!sourceRow || col >= sourceRow.cells.length) return null;
	const lines = anchor.selectors.find((candidate) => candidate.kind === "lineRange");
	if (
		lines?.kind === "lineRange" &&
		(sourceRow.endLine < lines.startLine || sourceRow.startLine > lines.endLine)
	) {
		return null;
	}
	return { row, col };
}

export function placedTableThreadIds(
	threads: readonly ReviewThread[],
	rows: readonly CsvRow[],
): ReadonlySet<string> {
	return new Set(
		threads.flatMap((thread) => (tableCellOfAnchor(thread.anchor, rows) ? [thread.id] : [])),
	);
}
