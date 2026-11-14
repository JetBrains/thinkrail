import { describe, expect, it } from "bun:test";
import { resolveTreeMove, type TreeMoveRow } from "./treeMove";

const row = (level: number, expanded?: boolean): TreeMoveRow => ({ level, expanded });

const rows = [row(1, true), row(2), row(2, false), row(1, true), row(1)];

describe("resolveTreeMove", () => {
	it("steps through the visible rows and stops at either end", () => {
		expect(resolveTreeMove("ArrowDown", rows, 0)).toEqual({ kind: "focus", index: 1 });
		expect(resolveTreeMove("ArrowUp", rows, 1)).toEqual({ kind: "focus", index: 0 });
		expect(resolveTreeMove("ArrowUp", rows, 0)).toEqual({ kind: "stay" });
		expect(resolveTreeMove("ArrowDown", rows, 4)).toEqual({ kind: "stay" });
		expect(resolveTreeMove("Home", rows, 3)).toEqual({ kind: "focus", index: 0 });
		expect(resolveTreeMove("End", rows, 0)).toEqual({ kind: "focus", index: 4 });
	});

	it("expands a collapsed row, then enters its first child", () => {
		expect(resolveTreeMove("ArrowRight", rows, 2)).toEqual({ kind: "toggle" });
		expect(resolveTreeMove("ArrowRight", rows, 0)).toEqual({ kind: "focus", index: 1 });
		expect(resolveTreeMove("ArrowRight", rows, 3)).toEqual({ kind: "stay" });
		expect(resolveTreeMove("ArrowRight", rows, 1)).toEqual({ kind: "stay" });
	});

	it("collapses an expanded row, else returns to its parent", () => {
		expect(resolveTreeMove("ArrowLeft", rows, 0)).toEqual({ kind: "toggle" });
		expect(resolveTreeMove("ArrowLeft", rows, 2)).toEqual({ kind: "focus", index: 0 });
		expect(resolveTreeMove("ArrowLeft", rows, 4)).toEqual({ kind: "stay" });
	});

	it("leaves every other key alone", () => {
		expect(resolveTreeMove("Enter", rows, 0)).toBeNull();
		expect(resolveTreeMove("a", rows, 0)).toBeNull();
	});
});
