import { expect, test } from "bun:test";
import { blockCursorCommand, blockIndexAt, blockRangeLines, blockText } from "./blockCursor";
import type { CursorCommand } from "./cursorKeys";

const blocks = [
	{ start: 1, end: 1 },
	{ start: 3, end: 4 },
	{ start: 6, end: 6 },
	{ start: 7, end: 7 },
	{ start: 10, end: 13 },
];

const move = (direction: "up" | "down", extend = false): CursorCommand => ({
	kind: "move",
	direction,
	extend,
});

test("the block cursor steps through stamped blocks and stops at the ends", () => {
	expect(blockCursorCommand(blocks, { line: 1, anchor: null }, move("down"))).toEqual({
		kind: "state",
		state: { line: 3, anchor: null },
	});
	expect(blockCursorCommand(blocks, { line: 1, anchor: null }, move("up"))).toEqual({
		kind: "state",
		state: { line: 1, anchor: null },
	});
	expect(
		blockCursorCommand(
			blocks,
			{ line: 3, anchor: null },
			{ kind: "edge", edge: "last", extend: false },
		),
	).toEqual({ kind: "state", state: { line: 10, anchor: null } });
	expect(
		blockCursorCommand(
			blocks,
			{ line: 3, anchor: null },
			{ kind: "move", direction: "left", extend: false },
		),
	).toBeNull();
});

test("a line inside a block belongs to the block that starts at or before it", () => {
	expect(blockIndexAt(blocks, 4)).toBe(1);
	expect(blockIndexAt(blocks, 12)).toBe(4);
	expect(blockIndexAt(blocks, 0)).toBe(0);
});

test("Shift extends over whole blocks and Enter comments on their source lines", () => {
	const extended = blockCursorCommand(blocks, { line: 3, anchor: null }, move("down", true));
	expect(extended).toEqual({ kind: "state", state: { line: 6, anchor: 3 } });
	const state = { line: 10, anchor: 3 };
	expect(blockRangeLines(blocks, state)).toEqual({ startLine: 3, endLine: 13 });
	expect(blockCursorCommand(blocks, state, { kind: "comment" })).toEqual({
		kind: "comment",
		lines: { startLine: 3, endLine: 13 },
	});
	expect(blockCursorCommand(blocks, state, { kind: "escape" })).toEqual({
		kind: "state",
		state: { line: 10, anchor: null },
	});
	expect(blockCursorCommand(blocks, { line: 10, anchor: null }, { kind: "escape" })).toBeNull();
	expect(blockCursorCommand([], { line: 1, anchor: null }, { kind: "comment" })).toBeNull();
});

test("a block reads as its text, a table row with its cells apart", () => {
	expect(blockText({ localName: "p", textContent: "  Wrapped\n  paragraph. ", children: [] })).toBe(
		"Wrapped paragraph.",
	);
	expect(
		blockText({
			localName: "tr",
			textContent: "NameValue",
			children: [{ textContent: "Name" }, { textContent: "Value" }],
		}),
	).toBe("Name Value");
});
