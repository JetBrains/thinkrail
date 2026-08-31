import { describe, expect, test } from "bun:test";
import { advanceVirtualRows, CHAT_VIRTUAL_INDEX_ORIGIN, initialVirtualRows } from "./virtualRows";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

function logicalIndex(state: ReturnType<typeof initialVirtualRows>, id: string): number {
	return state.firstItemIndex + state.rows.findIndex((row) => row.id === id);
}

describe("newest-first virtual row indices", () => {
	test("prefix insertion preserves every existing row's logical index", () => {
		const before = initialVirtualRows(rows("c", "b", "a"), "newest-first");
		const after = advanceVirtualRows(before, rows("e", "d", "c", "b", "a"), "newest-first", "b");
		expect(after.firstItemIndex).toBe(CHAT_VIRTUAL_INDEX_ORIGIN - 2);
		for (const id of ["c", "b", "a"]) {
			expect(logicalIndex(after, id)).toBe(logicalIndex(before, id));
		}
	});

	test("prefix insertion plus an oldest-tail trim preserves retained rows", () => {
		const before = initialVirtualRows(rows("d", "c", "b", "a"), "newest-first");
		const after = advanceVirtualRows(before, rows("f", "e", "d", "c"), "newest-first", "c");
		expect(logicalIndex(after, "d")).toBe(logicalIndex(before, "d"));
		expect(logicalIndex(after, "c")).toBe(logicalIndex(before, "c"));
	});

	test("top removal preserves the remaining logical indices", () => {
		const before = initialVirtualRows(rows("d", "c", "b", "a"), "newest-first");
		const after = advanceVirtualRows(before, rows("b", "a"), "newest-first", "b");
		expect(logicalIndex(after, "b")).toBe(logicalIndex(before, "b"));
		expect(logicalIndex(after, "a")).toBe(logicalIndex(before, "a"));
	});

	test("an arbitrary replacement keeps a surviving visible anchor's logical index", () => {
		const before = initialVirtualRows(rows("e", "d", "c", "b", "a"), "newest-first");
		const after = advanceVirtualRows(before, rows("x", "e", "c", "b"), "newest-first", "c");
		expect(logicalIndex(after, "c")).toBe(logicalIndex(before, "c"));
	});

	test("oldest-first stays zero-based and an order switch resets the origin", () => {
		const oldest = initialVirtualRows(rows("a", "b"), "oldest-first");
		expect(oldest.firstItemIndex).toBe(0);
		expect(
			advanceVirtualRows(oldest, rows("a", "b", "c"), "oldest-first", "a").firstItemIndex,
		).toBe(0);
		expect(advanceVirtualRows(oldest, rows("b", "a"), "newest-first", "a").firstItemIndex).toBe(
			CHAT_VIRTUAL_INDEX_ORIGIN,
		);
	});
});
