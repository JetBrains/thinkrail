import { describe, expect, test } from "bun:test";
import type { TraceEvent } from "@thinkrail/pi-session-insights/core";
import { nestChildren } from "./children";
import { llm, sampleEvents, T0, tool, turn } from "./events.test";
import { cycle, FOCUS_RUN, repeatHidden, revealed, runRow, seriesOf, TraceModel } from "./model";

const ids = (model: TraceModel, rows: readonly number[]) => rows.map((at) => model.at(at)?.id);

describe("TraceModel", () => {
	test("indexes parents and contiguous subtrees from pre-order events", () => {
		const model = new TraceModel(sampleEvents());
		expect([...model.parent]).toEqual([-1, -1, 1, 2, 2, 4, 1, -1, 7]);
		expect([...model.end]).toEqual([1, 7, 6, 4, 6, 6, 7, 9, 9]);
		expect(model.hasChildren(1)).toBe(true);
		expect(model.hasChildren(3)).toBe(false);
		expect(model.indexOf("s1")).toBe(5);
		expect(model.indexOf("nope")).toBe(-1);
		expect(model.ancestors(5)).toEqual([4, 2, 1]);
	});

	test("shows turns, calls and tools open, so a subagent run shows as a row; a toggle overrides", () => {
		const model = new TraceModel(sampleEvents());
		const all = model.visible(new Map(), null).rows;
		expect(ids(model, all)).toEqual(["m0", "u1", "a1", "t1", "t2", "s1", "a2", "u2", "a3"]);
		expect(model.isOpenByDefault(5)).toBe(false);
		const folded = model.visible(new Map([["u1", false]]), null).rows;
		expect(ids(model, folded)).toEqual(["m0", "u1", "u2", "a3"]);
		const closed = model.visible(new Map([["t2", false]]), null).rows;
		expect(ids(model, closed)).not.toContain("s1");
	});

	test("a large trace starts as an outline of turns", () => {
		const events: TraceEvent[] = [turn("u1", 1, T0, T0 + 1)];
		for (let at = 0; at < 2600; at += 1) events.push(llm(`a${at}`, "u1", T0 + at, T0 + at + 1));
		const model = new TraceModel(events);
		expect(model.visible(new Map(), null).rows).toEqual([0]);
	});

	test("the outline follows the whole trace's size, not the pages or subagents loaded so far", () => {
		const events: TraceEvent[] = [turn("u1", 1, T0, T0 + 1)];
		for (let at = 0; at < 100; at += 1) events.push(llm(`a${at}`, "u1", T0 + at, T0 + at + 1));
		expect(new TraceModel(events, 4000).visible(new Map(), null).rows).toEqual([0]);
		for (let at = 100; at < 2600; at += 1) events.push(llm(`a${at}`, "u1", T0 + at, T0 + at + 1));
		expect(new TraceModel(events, 120).visible(new Map(), null).rows).toHaveLength(2601);
	});

	test("the errors filter keeps failures and their ancestors, opened", () => {
		const model = new TraceModel(sampleEvents());
		const { rows } = model.visible(
			new Map([
				["u1", false],
				["u2", false],
			]),
			model.failureMask(),
		);
		expect(ids(model, rows)).toEqual(["u1", "a1", "t1", "u2", "a3"]);
		expect(model.failures()).toEqual([3, 8]);
	});

	test("focus mode keeps the tree, opens matches' ancestors and folds long runs of the rest", () => {
		const model = new TraceModel(sampleEvents());
		const match = model.mask(["a3"]);
		const focused = model.visible(new Map([["u2", false]]), match, { focus: true });
		expect(FOCUS_RUN).toBe(3);
		expect(focused.rows).toEqual([runRow(0), 7, 8]);
		expect(focused.runs.get(0)).toBe(7);
		expect(focused.keep?.[7]).toBe(1);
		const opened = model.visible(new Map(), match, { focus: true, expanded: new Set([0]) });
		expect(ids(model, opened.rows)).toEqual(["m0", "u1", "a1", "t1", "t2", "s1", "a2", "u2", "a3"]);
		expect([...model.during([{ t0: T0 + 1000, t1: T0 + 2500 }])].some(Boolean)).toBe(true);
	});

	test("a collapsed repeat hides every member after the first and calls left without a visible tool", () => {
		const events: TraceEvent[] = [
			turn("u", 1, T0, T0 + 10),
			llm("a1", "u", T0, T0 + 1),
			tool("x1", "a1", T0 + 1, T0 + 2),
			llm("a2", "u", T0 + 2, T0 + 3),
			tool("x2", "a2", T0 + 3, T0 + 4),
		];
		const model = new TraceModel(events);
		const group = { ids: ["x1", "x2"], tool: "bash", label: "ls", errors: 0 };
		const { hidden, heads } = repeatHidden(model, [group], new Set());
		expect(ids(model, model.visible(new Map(), null, { hidden }).rows)).toEqual(["u", "a1", "x1"]);
		expect(heads.get(2)).toBe(group);
		const open = repeatHidden(model, [group], new Set(["x1"]));
		expect(model.visible(new Map(), null, { hidden: open.hidden }).rows).toHaveLength(5);
	});

	test("a loaded subagent transcript nests under its row with prefixed ids", () => {
		const nested = nestChildren(
			sampleEvents(),
			new Map([["s1", [turn("k1", 1, T0 + 5, T0 + 6), llm("k2", "k1", T0 + 5, T0 + 6)]]]),
		);
		const model = new TraceModel(nested);
		const at = model.indexOf("child:s1/k2");
		expect(at).toBeGreaterThan(model.indexOf("s1"));
		expect(model.at(at)?.parent).toBe("child:s1/k1");
		expect(model.at(model.indexOf("child:s1/k1"))?.parent).toBe("s1");
	});

	test("revealing a row opens only its closed ancestors", () => {
		const model = new TraceModel(sampleEvents());
		const open = new Map([
			["u1", false],
			["t2", false],
		]);
		const next = revealed(model, open, 5);
		expect([...next.entries()].sort()).toEqual([
			["t2", true],
			["u1", true],
		]);
		expect(revealed(model, next, 5)).toBe(next);
	});

	test("cycling wraps both ways and what happened next skips a row's own subtree", () => {
		expect(cycle([3, 8], 3, 1)).toBe(8);
		expect(cycle([3, 8], 8, 1)).toBe(3);
		expect(cycle([3, 8], 3, -1)).toBe(8);
		expect(cycle([3, 8], 5, -1)).toBe(3);
		expect(cycle([], 0, 1)).toBeNull();
		const model = new TraceModel(sampleEvents());
		expect(model.following(4, 3)).toEqual([6, 8]);
		expect(model.following(3, 1)).toEqual([4]);
	});

	test("bars take their family's series; model calls one of their own", () => {
		expect(seriesOf(llm("a", null, 0, 1))).toBe("series-3");
		expect(seriesOf(tool("x", "a1", 0, 1))).toBe("series-4");
		expect(seriesOf(tool("x", "a1", 0, 1, { family: "reading" }))).toBe("series-5");
		expect(seriesOf(tool("x", "a1", 0, 1, { family: "ask" }))).toBe("primary");
		expect(seriesOf(turn("u", 1, 0))).toBeNull();
	});
});
