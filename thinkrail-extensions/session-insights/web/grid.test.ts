import { expect, test } from "bun:test";
import { gridMove } from "./grid";

const widths = [1, 10, 9, 1, 10];

test("arrows move within a row and keep the column across rows, clamped to shorter rows", () => {
	expect(gridMove("ArrowRight", false, { row: 1, col: 3 }, widths)).toEqual({ row: 1, col: 4 });
	expect(gridMove("ArrowRight", false, { row: 1, col: 9 }, widths)).toBeNull();
	expect(gridMove("ArrowLeft", false, { row: 1, col: 0 }, widths)).toBeNull();
	expect(gridMove("ArrowDown", false, { row: 1, col: 9 }, widths)).toEqual({ row: 2, col: 8 });
	expect(gridMove("ArrowDown", false, { row: 2, col: 4 }, widths)).toEqual({ row: 3, col: 0 });
	expect(gridMove("ArrowUp", false, { row: 1, col: 4 }, widths)).toEqual({ row: 0, col: 0 });
	expect(gridMove("ArrowUp", false, { row: 0, col: 0 }, widths)).toBeNull();
	expect(gridMove("ArrowDown", false, { row: 4, col: 0 }, widths)).toBeNull();
});

test("Home and End reach the row's edges, or the grid's with a modifier; pages jump ten rows", () => {
	expect(gridMove("Home", false, { row: 2, col: 5 }, widths)).toEqual({ row: 2, col: 0 });
	expect(gridMove("End", false, { row: 2, col: 1 }, widths)).toEqual({ row: 2, col: 8 });
	expect(gridMove("Home", true, { row: 2, col: 5 }, widths)).toEqual({ row: 0, col: 0 });
	expect(gridMove("End", true, { row: 2, col: 1 }, widths)).toEqual({ row: 4, col: 9 });
	expect(gridMove("PageDown", false, { row: 0, col: 0 }, widths)).toEqual({ row: 4, col: 0 });
	expect(gridMove("PageUp", false, { row: 4, col: 7 }, widths)).toEqual({ row: 0, col: 0 });
	expect(gridMove("Tab", false, { row: 1, col: 1 }, widths)).toBeNull();
});
