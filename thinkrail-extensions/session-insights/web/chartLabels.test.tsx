import { describe, expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import type { SessionContext, SessionCost } from "@thinkrail/pi-session-insights/core";
import { type ChartLabel, placeLabels } from "./chartLabels";
import { markerLabels } from "./context/ContextChart";
import { fullView } from "./context/chart";
import { compactionLabels } from "./cost/CostView";

const t = currentTranslator();
const measure = (text: string) => text.length * 6;

function label(key: string, x: number, ...variants: string[]): ChartLabel {
	return { key, x, variants };
}

describe("chart label placement", () => {
	test("labels with room keep their full text on the first row", () => {
		const placed = placeLabels(
			[label("a", 10, "compaction 977K → 68K (−93%)"), label("b", 400, "→ m")],
			{
				width: 600,
				rows: 3,
				measure,
			},
		);
		expect(placed.map(({ key, row, level, anchor }) => ({ key, row, level, anchor }))).toEqual([
			{ key: "a", row: 0, level: 0, anchor: "start" },
			{ key: "b", row: 0, level: 0, anchor: "start" },
		]);
		expect(placed[0]?.x).toBe(14);
	});

	test("overlapping labels stagger onto the next rows before anything is cut", () => {
		const full = "compaction 977K → 68K (−93%)";
		const placed = placeLabels(
			[label("a", 10, full, "977K→68K", "−93%"), label("b", 30, full, "977K→68K", "−93%")],
			{ width: 600, rows: 3, measure },
		);
		expect(placed.map((item) => [item.key, item.row, item.text])).toEqual([
			["a", 0, full],
			["b", 1, full],
		]);
	});

	test("when every row is taken, the label before shortens to make room: 977K→68K, then the change alone", () => {
		const full = "compaction 977K → 68K (−93%)";
		const labels = [10, 40, 100, 130, 300].map((x, at) =>
			label(`k${at}`, x, full, "977K→68K", "−93%"),
		);
		const placed = placeLabels(labels, { width: 600, rows: 2, measure });
		expect(placed.map((item) => [item.key, item.row, item.text])).toEqual([
			["k0", 0, "977K→68K"],
			["k1", 1, "977K→68K"],
			["k2", 0, full],
			["k3", 1, full],
			["k4", 0, full],
		]);
		const spans = placed.map((item) => ({
			row: item.row,
			left: item.x,
			right: item.x + measure(item.text),
		}));
		for (const a of spans)
			for (const b of spans)
				if (a !== b && a.row === b.row) expect(a.right <= b.left || b.right <= a.left).toBe(true);
		const tight = placeLabels(labels.slice(0, 2), { width: 600, rows: 1, measure });
		expect(tight.map((item) => item.text)).toEqual(["−93%", full]);
	});

	test("a label no shortening makes room for is left out", () => {
		const labels = [10, 11, 12].map((x, at) => label(`k${at}`, x, "compaction", "−93%"));
		expect(placeLabels(labels, { width: 600, rows: 2, measure }).map((item) => item.key)).toEqual([
			"k0",
			"k1",
		]);
	});

	test("near the right edge a label ends left of its rule", () => {
		const [placed] = placeLabels([label("a", 590, "compaction")], { width: 600, rows: 1, measure });
		expect(placed).toMatchObject({ anchor: "end", x: 586 });
		expect(
			placeLabels([label("a", 590, "a very long label")], { width: 60, rows: 1, measure }),
		).toEqual([]);
	});
});

describe("the charts' compaction labels", () => {
	const call = (n: number) => ({
		id: `c${n}`,
		n,
		t: n,
		model: "anthropic/claude-sonnet",
		turn: 1,
		total: 1_000 * n,
		input: 0,
		cacheRead: 0,
		cacheWrite: 0,
		parts: [],
		delta: null,
		coverage: 1,
		gapMs: null,
		cost: 0.01,
	});

	test("the context chart offers the drop, then before → after, then the change alone", () => {
		const data = {
			calls: [call(1), call(2), call(3)],
			compactions: [
				{
					id: "k",
					t: 2,
					tokensBefore: 977_000,
					before: "c1",
					after: "c2",
					beforeTokens: 977_000,
					afterTokens: 68_000,
					change: -0.93,
				},
			],
			switches: [{ at: "c3", from: "a/x", to: "anthropic/claude-opus" }],
		} as unknown as SessionContext;
		const labels = markerLabels(t, data, fullView(3), 600);
		expect(labels.map((item) => item.variants)).toEqual([
			["compaction 977K → 68K (−93%)", "977K→68K", "−93%"],
			["→ anthropic/claude-opus", "→ claude-opus"],
		]);
	});

	test("the why-expensive chart offers the word, then its short form, at the compaction's rule", () => {
		const cost = {
			calls: [call(1), call(2), call(3), call(4)],
			compactions: [{ id: "k", t: 2, after: "c3" }],
		} as unknown as SessionCost;
		expect(compactionLabels(t, cost, 400)).toEqual([
			{ key: "k", x: 200, variants: ["compaction", "cmp."] },
		]);
	});
});
