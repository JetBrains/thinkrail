import { expect, test } from "bun:test";
import { FOCUS_CONTEXT_BLOCKS, focusSegments } from "./renderedDiffFocus";

type Block = { id: number; changed: boolean };

function blocks(count: number, changedIds: number[]): Block[] {
	return Array.from({ length: count }, (_, id) => ({ id, changed: changedIds.includes(id) }));
}

function shape(segments: ReturnType<typeof focusSegments<Block>>) {
	return segments.map((segment) => `${segment.kind}:${segment.items.map((b) => b.id).join(",")}`);
}

const changed = (block: Block) => block.changed;

test("a change in the middle keeps context blocks on both sides and hides the rest", () => {
	expect(FOCUS_CONTEXT_BLOCKS).toBe(2);
	expect(shape(focusSegments(blocks(11, [5]), changed))).toEqual([
		"hidden:0,1,2",
		"visible:3,4,5,6,7",
		"hidden:8,9,10",
	]);
});

test("changes at both edges leave one hidden run between their context windows", () => {
	expect(shape(focusSegments(blocks(9, [0, 8]), changed))).toEqual([
		"visible:0,1,2",
		"hidden:3,4,5",
		"visible:6,7,8",
	]);
});

test("a single block between two context windows is shown rather than hidden behind an expander", () => {
	expect(shape(focusSegments(blocks(7, [0, 6]), changed))).toEqual(["visible:0,1,2,3,4,5,6"]);
	expect(shape(focusSegments(blocks(8, [0, 7]), changed))).toEqual([
		"visible:0,1,2",
		"hidden:3,4",
		"visible:5,6,7",
	]);
	expect(shape(focusSegments(blocks(4, [3]), changed))).toEqual(["visible:0,1,2,3"]);
});

test("a document without rendered changes collapses into one hidden run", () => {
	expect(shape(focusSegments(blocks(4, []), changed))).toEqual(["hidden:0,1,2,3"]);
	expect(focusSegments([], changed)).toEqual([]);
});

test("a document that changed everywhere stays fully visible", () => {
	expect(shape(focusSegments(blocks(3, [0, 1, 2]), changed))).toEqual(["visible:0,1,2"]);
});

test("the context width is a parameter", () => {
	expect(shape(focusSegments(blocks(7, [3]), changed, 0))).toEqual([
		"hidden:0,1,2",
		"visible:3",
		"hidden:4,5,6",
	]);
	expect(shape(focusSegments(blocks(7, [3]), changed, 1))).toEqual([
		"hidden:0,1",
		"visible:2,3,4",
		"hidden:5,6",
	]);
});
