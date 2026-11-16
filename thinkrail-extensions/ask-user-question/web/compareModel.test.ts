import { expect, test } from "bun:test";
import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import {
	compareIndexOf,
	compareItems,
	compareJumpIndex,
	compareKeyShortcuts,
	compareStart,
	flipCompare,
	hasHtmlFile,
	pairsVisually,
	setCompareLeft,
	setCompareView,
	showCompareItem,
} from "./compareModel";
import { hasOptionPreviews } from "./state";

const question: AskUserQuestionItem = {
	question: "Which navigation?",
	header: "Navigation",
	previewFile: "mockups/current.html",
	options: [
		{ label: "Sidebar", description: "", previewFile: "mockups/sidebar.html" },
		{ label: "Top tabs (Recommended)", description: "", previewFile: "mockups/tabs.html" },
		{ label: "Keep as is", description: "" },
	],
};

const items = compareItems(question, "Current");

test("items are Current first, then every option with its own preview or none", () => {
	expect(items.map((item) => [item.label, item.option?.index ?? null, item.recommended])).toEqual([
		["Current", null, false],
		["Sidebar", 0, false],
		["Top tabs", 1, true],
		["Keep as is", 2, false],
	]);
	expect(items[3]?.source).toBeNull();
	expect(compareIndexOf(question, 1)).toBe(2);
	expect(compareIndexOf(question, null)).toBe(0);
	expect(hasOptionPreviews(question)).toBe(true);
	expect(hasOptionPreviews({ ...question, multiSelect: true })).toBe(false);
	expect(hasHtmlFile(items)).toBe(true);
});

test("the overlay opens in Single on the item, with Current waiting on the left", () => {
	expect(compareStart(items, 2)).toEqual({ view: "single", focus: 2, left: 0 });
	const { previewFile: _current, ...withoutCurrent } = question;
	const noCurrent = compareItems(withoutCurrent, "Current");
	expect(compareStart(noCurrent, 0)).toEqual({ view: "single", focus: 0, left: 1 });
	expect(compareStart(noCurrent, 1).left).toBe(0);
});

test("flipping wraps and, side by side, never shows one item on both sides", () => {
	const single = compareStart(items, 3);
	expect(flipCompare(single, items.length, 1).focus).toBe(0);
	expect(flipCompare(single, items.length, -1).focus).toBe(2);

	const pair = setCompareView(compareStart(items, 1), items, "pair");
	expect(pair).toEqual({ view: "pair", focus: 1, left: 0 });
	expect(flipCompare(pair, items.length, -1)).toEqual({ view: "pair", focus: 3, left: 0 });
	expect(flipCompare({ ...pair, focus: 3 }, items.length, 1)).toEqual({
		view: "pair",
		focus: 1,
		left: 0,
	});

	const grid = setCompareView(single, items, "grid");
	expect(flipCompare(grid, items.length, 1)).toEqual({ ...grid, focus: 0 });
});

test("choosing a side already shown swaps instead of duplicating it", () => {
	const pair = setCompareView(compareStart(items, 1), items, "pair");
	expect(showCompareItem(pair, 0)).toEqual({ view: "pair", focus: 0, left: 1 });
	expect(setCompareLeft(pair, 1)).toEqual({ view: "pair", focus: 0, left: 1 });
	expect(setCompareLeft(pair, 2)).toEqual({ view: "pair", focus: 1, left: 2 });
	expect(showCompareItem(setCompareView(pair, items, "grid"), 3)).toEqual({
		view: "single",
		focus: 3,
		left: 0,
	});
});

test("digits jump within the items and visual pairing needs two files of one kind", () => {
	expect(compareJumpIndex("1", 4)).toBe(0);
	expect(compareJumpIndex("4", 4)).toBe(3);
	expect(compareJumpIndex("5", 4)).toBeNull();
	expect(compareJumpIndex("0", 4)).toBeNull();
	const [current, sidebar, , none] = items;
	if (!current || !sidebar || !none) throw new Error("fixture");
	expect(pairsVisually(current, sidebar)).toBe(true);
	expect(pairsVisually(sidebar, none)).toBe(false);
	const image = { ...sidebar, source: { kind: "file" as const, path: "a.png" } };
	expect(pairsVisually(image, { ...image, source: { kind: "file", path: "b.jpg" } })).toBe(true);
	expect(pairsVisually(image, sidebar)).toBe(false);
	const diff = { ...sidebar, source: { kind: "file" as const, path: "a.html", before: "b.html" } };
	expect(pairsVisually(diff, sidebar)).toBe(false);
});

test("the overlay announces every key it takes: flip, each jump, choose when it can, and close", () => {
	expect(compareKeyShortcuts(4, true)).toBe("ArrowLeft ArrowRight 1 2 3 4 Enter Escape");
	expect(compareKeyShortcuts(3, false)).toBe("ArrowLeft ArrowRight 1 2 3 Escape");
	expect(
		compareKeyShortcuts(12, true)
			.split(" ")
			.filter((key) => /^\d$/.test(key)),
	).toHaveLength(9);
});
