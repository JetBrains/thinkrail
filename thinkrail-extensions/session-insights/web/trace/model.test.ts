import { describe, expect, test } from "bun:test";
import type { TraceEvent } from "@thinkrail/pi-session-insights/core";
import { nestChildren } from "./children";
import { llm, sampleEvents, subagent, T0, tool, turn } from "./events.test";
import {
	cycle,
	FOCUS_RUN,
	repeatHidden,
	revealed,
	runRow,
	seriesOf,
	TraceModel,
	unfoldFor,
} from "./model";

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

	describe("a command run twice, passing then failing, folds into one repeat", () => {
		const events: TraceEvent[] = [
			turn("u", 1, T0, T0 + 10),
			llm("a1", "u", T0, T0 + 1),
			tool("x1", "a1", T0 + 1, T0 + 2),
			llm("a2", "u", T0 + 2, T0 + 3),
			tool("x2", "a2", T0 + 3, T0 + 4, { error: true, exit: "1" }),
			turn("w", 2, T0 + 20, T0 + 30),
		];
		const group = { ids: ["x1", "x2"], tool: "bash", label: "bun test", errors: 1 };
		const model = new TraceModel(events);
		const rowsOf = (match: Uint8Array | null, opened: ReadonlySet<string>, focus = false) => {
			const collapsed = repeatHidden(model, [group], opened, match);
			return {
				rows: ids(model, model.visible(new Map(), match, { focus, hidden: collapsed.hidden }).rows),
				open: collapsed.open,
			};
		};

		test("the errors filter unfolds it to show the failed call and its ancestors", () => {
			expect(rowsOf(null, new Set()).rows).toEqual(["u", "a1", "x1", "w"]);
			const errors = model.failureMask();
			expect(rowsOf(errors, new Set()).rows).toEqual(["u", "a2", "x2"]);
			const focused = rowsOf(errors, new Set(), true);
			expect(focused.rows).toEqual(["u", "a1", "x1", "a2", "x2", "w"]);
			expect([...focused.open]).toEqual(["x1"]);
			expect([...rowsOf(null, new Set()).open]).toEqual([]);
		});

		test("a match inside a folded member's subtree unfolds it too", () => {
			const nested = new TraceModel(
				nestChildren(
					[
						...events.slice(0, 4),
						tool("x2", "a2", T0 + 3, T0 + 4),
						subagent("s2", "x2", T0 + 3, T0 + 4),
					],
					new Map([
						[
							"s2",
							[turn("k1", 1, T0 + 3, T0 + 4), llm("k2", "k1", T0 + 3, T0 + 4, { error: true })],
						],
					]),
				),
			);
			const match = nested.failureMask();
			const { hidden } = repeatHidden(nested, [group], new Set(), match);
			expect(ids(nested, nested.visible(new Map(), match, { hidden }).rows)).toEqual([
				"u",
				"a2",
				"x2",
				"s2",
				"child:s2/k1",
				"child:s2/k2",
			]);
		});

		test("a matching head keeps the group folded behind its own expand control", () => {
			for (const match of [model.mask(group.ids), model.mask(["x1"])]) {
				const shown = rowsOf(match, new Set());
				expect(shown.rows).toEqual(["u", "a1", "x1"]);
				expect([...shown.open]).toEqual([]);
			}
			const failingHead = new TraceModel(
				events.map((event) => (event.id === "x1" ? { ...event, error: true } : event)),
			);
			const match = failingHead.failureMask();
			const { hidden, heads } = repeatHidden(failingHead, [group], new Set(), match);
			expect(ids(failingHead, failingHead.visible(new Map(), match, { hidden }).rows)).toEqual([
				"u",
				"a1",
				"x1",
			]);
			expect(heads.get(failingHead.indexOf("x1"))).toBe(group);
		});

		test("a selection inside the fold unfolds the repeat that holds it, nothing else", () => {
			const none: ReadonlySet<string> = new Set();
			for (const id of ["x2", "a2"]) {
				const opened = unfoldFor(model, [group], none, model.indexOf(id));
				expect([...opened]).toEqual(["x1"]);
				expect(rowsOf(null, opened).rows).toContain(id);
			}
			for (const id of ["u", "a1", "x1", "w"])
				expect(unfoldFor(model, [group], none, model.indexOf(id))).toBe(none);
			const opened = new Set(["x1"]);
			expect(unfoldFor(model, [group], opened, model.indexOf("x2"))).toBe(opened);
			expect(unfoldFor(model, [], none, model.indexOf("x2"))).toBe(none);
		});

		test("a selection deep in a folded member's subagent transcript unfolds its repeat", () => {
			const nested = new TraceModel(
				nestChildren(
					[
						...events.slice(0, 4),
						tool("x2", "a2", T0 + 3, T0 + 4),
						subagent("s2", "x2", T0 + 3, T0 + 4),
					],
					new Map([["s2", [turn("k1", 1, T0 + 3, T0 + 4), llm("k2", "k1", T0 + 3, T0 + 4)]]]),
				),
			);
			const deep = nested.indexOf("child:s2/k2");
			const opened = unfoldFor(nested, [group], new Set(), deep);
			expect([...opened]).toEqual(["x1"]);
			const { hidden } = repeatHidden(nested, [group], opened);
			const open = revealed(nested, new Map(), deep);
			expect(nested.visible(open, null, { hidden }).rows).toContain(deep);
		});
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
