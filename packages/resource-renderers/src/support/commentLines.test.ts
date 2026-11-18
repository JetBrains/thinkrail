import { expect, test } from "bun:test";
import { commentLines } from "./commentLines";

const selection = (start: number, end: number, position: { line: number; column: number }) => ({
	startLineNumber: start,
	endLineNumber: end,
	positionLineNumber: position.line,
	positionColumn: position.column,
	isEmpty: () => start === end && position.column === 1 && start === position.line,
});

test("an empty selection comments on the caret's line", () => {
	expect(commentLines(selection(7, 7, { line: 7, column: 1 }))).toEqual({
		startLine: 7,
		endLine: 7,
	});
});

test("a selection ending at the start of a line leaves that line out", () => {
	expect(commentLines(selection(3, 6, { line: 6, column: 1 }))).toEqual({
		startLine: 3,
		endLine: 5,
	});
	expect(commentLines(selection(3, 6, { line: 6, column: 4 }))).toEqual({
		startLine: 3,
		endLine: 6,
	});
});
