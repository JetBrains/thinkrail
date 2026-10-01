import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import { csvRenderer } from ".";
import {
	alignCsvRows,
	changedCellIndices,
	csvSelectionDraft,
	parseCsv,
	sniffDelimiter,
	tableCellOfAnchor,
} from "./csvModel";

test("RFC-4180 parsing handles quoted, escaped, multiline, and CRLF fields", () => {
	const table = parseCsv('name,note\r\n"A","line 1\r\nline 2"\r\n"B","say ""hello"""');
	expect(table.rows.map((row) => row.cells)).toEqual([
		["name", "note"],
		["A", "line 1\nline 2"],
		["B", 'say "hello"'],
	]);
	expect(table.rows.map((row) => [row.startLine, row.endLine])).toEqual([
		[1, 1],
		[2, 3],
		[4, 4],
	]);
});

test("TSV parsing keeps delimiters inside quoted fields", () => {
	const table = parseCsv('a\tb\n1\t"two\tparts"', "\t");
	expect(table.rows[1]?.cells).toEqual(["1", "two\tparts"]);
});

test("row alignment pairs replacements and highlights only changed cells", () => {
	const original = parseCsv("id,name,role\n1,Ada,dev\n2,Lin,ops\n3,Sam,qa").rows;
	const modified = parseCsv("id,name,role\n1,Ada,lead\n2,Lin,ops\n4,Jo,qa").rows;
	const aligned = alignCsvRows(original, modified);
	expect(aligned.map((row) => row.kind)).toEqual(["unchanged", "changed", "unchanged", "changed"]);
	expect(aligned[1]?.changedCells).toEqual([2]);
	expect(aligned[3]?.changedCells).toEqual([0, 1]);
	const originalRow = original[1];
	const modifiedRow = modified[1];
	if (!originalRow || !modifiedRow) throw new Error("Expected aligned fixture rows");
	expect(changedCellIndices(originalRow, modifiedRow)).toEqual([2]);
});

test("a selected table cell round-trips and becomes unplaced after deletion", () => {
	const table = parseCsv('name,note\nAda,"line 1\nline 2"\nLin,ok');
	const draft = csvSelectionDraft(table.rows, {
		anchor: { row: 1, col: 1 },
		focus: { row: 2, col: 1 },
	});
	expect(draft).toEqual({
		selectors: [
			{ kind: "lineRange", startLine: 2, endLine: 4 },
			{ kind: "structural", scheme: "table-cell", ref: "1:1" },
		],
		label: "R1C1",
	});
	const anchor: ReviewAnchor = {
		path: "people.csv",
		side: "worktree",
		contentHash: "hash",
		selectors: [
			...(draft?.selectors ?? []),
			{ kind: "textQuote", exact: 'Ada,"line 1\nline 2"\nLin,ok', prefix: "", suffix: "" },
		],
	};
	expect(tableCellOfAnchor(anchor, table.rows)).toEqual({ row: 1, col: 1 });
	expect(tableCellOfAnchor(anchor, parseCsv("name,note").rows)).toBeNull();
	const shiftedAnchor: ReviewAnchor = {
		...anchor,
		selectors: anchor.selectors.map((selector) =>
			selector.kind === "lineRange" ? { kind: "lineRange", startLine: 4, endLine: 4 } : selector,
		),
	};
	expect(
		tableCellOfAnchor(shiftedAnchor, parseCsv("name,note\nNew,row\nAda,line\nLin,ok").rows),
	).toBeNull();
});

test("CSV renderer registration declares table-cell and line anchors", () => {
	expect(csvRenderer).toMatchObject({
		id: "thinkrail/csv",
		label: "Table",
		match: { glob: ["*.csv", "*.tsv"], text: true },
		rank: 120,
		capabilities: {
			anchors: {
				view: ["line", "structural:table-cell"],
				diff: ["line", "structural:table-cell"],
			},
			mobile: true,
		},
	});
});

test("the delimiter is sniffed from the first header line: comma by default, semicolon, pipe, tab by extension", () => {
	expect(sniffDelimiter("a.csv", "id,name\n1,Ann\n")).toBe(",");
	expect(sniffDelimiter("a.csv", "id;name;score\n1;Ann;9,5\n")).toBe(";");
	expect(sniffDelimiter("a.csv", "id|name\n1|Ann\n")).toBe("|");
	expect(sniffDelimiter("a.csv", '"last, first";score\n"Doe, Jane";8\n')).toBe(";");
	expect(sniffDelimiter("a.tsv", "id;name\n")).toBe("\t");
	expect(sniffDelimiter("a.csv", "", "id;name\n")).toBe(";");
	expect(sniffDelimiter("a.csv", "")).toBe(",");
});
