import { expect, test } from "bun:test";
import { readingAnchor } from "./codeReading";

const at = (lineNumber: number, column = 1) => ({ lineNumber, column });

const lines = (startLineNumber: number, endLineNumber: number, endColumn = 30) => ({
	startLineNumber,
	startColumn: 1,
	endLineNumber,
	endColumn,
});

const shortLines = () => 30;

test("a caret on a fully visible line steps from where it is", () => {
	expect(readingAnchor(at(40, 7), [lines(31, 60)], 1, shortLines)).toBeNull();
	expect(readingAnchor(at(31), [lines(31, 60)], -1, shortLines)).toBeNull();
	expect(readingAnchor(at(60, 30), [lines(31, 60)], 1, shortLines)).toBeNull();
});

test("a caret above or below the view re-anchors to the first visible position going down and the last going up", () => {
	expect(readingAnchor(at(2), [lines(31, 60)], 1, shortLines)).toEqual(at(31));
	expect(readingAnchor(at(2), [lines(31, 60)], -1, shortLines)).toEqual(at(60, 30));
	expect(readingAnchor(at(90), [lines(31, 60)], 1, shortLines)).toEqual(at(31));
	expect(readingAnchor(at(90), [lines(31, 60)], -1, shortLines)).toEqual(at(60, 30));
});

test("a partly visible caret line counts as outside the view", () => {
	expect(readingAnchor(at(30), [lines(31, 60)], 1, shortLines)).toEqual(at(31));
	expect(readingAnchor(at(61), [lines(31, 60)], -1, shortLines)).toEqual(at(60, 30));
});

test("the visible pieces around a fold count as one view", () => {
	const folded = [lines(10, 20), lines(40, 55)];
	expect(readingAnchor(at(30), folded, 1, shortLines)).toEqual(at(10));
	expect(readingAnchor(at(30), folded, -1, shortLines)).toEqual(at(55, 30));
	expect(readingAnchor(at(45), folded, 1, shortLines)).toBeNull();
});

test("an editor with no visible lines keeps the caret", () => {
	expect(readingAnchor(at(5), [], 1, shortLines)).toBeNull();
});

const wrapped = { startLineNumber: 1, startColumn: 3_001, endLineNumber: 1, endColumn: 6_001 };
const oneLongLine = () => 9_001;

test("a caret on the scrolled-away rows of a wrapped line counts as outside the view", () => {
	expect(readingAnchor(at(1), [wrapped], 1, oneLongLine)).toEqual(at(1, 3_001));
	expect(readingAnchor(at(1), [wrapped], -1, oneLongLine)).toEqual(at(1, 6_000));
	expect(readingAnchor(at(1, 8_000), [wrapped], 1, oneLongLine)).toEqual(at(1, 3_001));
	expect(readingAnchor(at(1, 3_000), [wrapped], -1, oneLongLine)).toEqual(at(1, 6_000));
});

test("a caret on the visible rows of a wrapped line steps from where it is", () => {
	expect(readingAnchor(at(1, 3_001), [wrapped], 1, oneLongLine)).toBeNull();
	expect(readingAnchor(at(1, 4_500), [wrapped], 1, oneLongLine)).toBeNull();
	expect(readingAnchor(at(1, 6_000), [wrapped], -1, oneLongLine)).toBeNull();
});

test("the wrap column ending the view starts the next, hidden row", () => {
	expect(readingAnchor(at(1, 6_001), [wrapped], 1, oneLongLine)).toEqual(at(1, 3_001));
	const toLineEnd = { ...wrapped, endColumn: 9_001 };
	expect(readingAnchor(at(1, 9_001), [toLineEnd], 1, oneLongLine)).toBeNull();
});

test("a view that starts inside one wrapped line and ends inside another bounds both", () => {
	const view = { startLineNumber: 4, startColumn: 201, endLineNumber: 6, endColumn: 101 };
	const longLines = () => 501;
	expect(readingAnchor(at(4, 150), [view], 1, longLines)).toEqual(at(4, 201));
	expect(readingAnchor(at(5, 400), [view], 1, longLines)).toBeNull();
	expect(readingAnchor(at(6, 300), [view], -1, longLines)).toEqual(at(6, 100));
});
