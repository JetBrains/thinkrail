import { expect, test } from "bun:test";
import { readingAnchorLine } from "./codeReading";

const lines = (startLineNumber: number, endLineNumber: number) => ({
	startLineNumber,
	endLineNumber,
});

test("a caret on a fully visible line steps from where it is", () => {
	expect(readingAnchorLine(40, [lines(31, 60)], 1)).toBeNull();
	expect(readingAnchorLine(31, [lines(31, 60)], -1)).toBeNull();
	expect(readingAnchorLine(60, [lines(31, 60)], 1)).toBeNull();
});

test("a caret above or below the view re-anchors to the first visible line going down and the last going up", () => {
	expect(readingAnchorLine(2, [lines(31, 60)], 1)).toBe(31);
	expect(readingAnchorLine(2, [lines(31, 60)], -1)).toBe(60);
	expect(readingAnchorLine(90, [lines(31, 60)], 1)).toBe(31);
	expect(readingAnchorLine(90, [lines(31, 60)], -1)).toBe(60);
});

test("a partly visible caret line counts as outside the view", () => {
	expect(readingAnchorLine(30, [lines(31, 60)], 1)).toBe(31);
	expect(readingAnchorLine(61, [lines(31, 60)], -1)).toBe(60);
});

test("the visible pieces around a fold count as one view", () => {
	const folded = [lines(10, 20), lines(40, 55)];
	expect(readingAnchorLine(30, folded, 1)).toBe(10);
	expect(readingAnchorLine(30, folded, -1)).toBe(55);
	expect(readingAnchorLine(45, folded, 1)).toBeNull();
});

test("an editor with no visible lines keeps the caret", () => {
	expect(readingAnchorLine(5, [], 1)).toBeNull();
});
