import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeHost } from "./fixtures.test";
import { InsightsCharts } from "./Insights";
import {
	bandPath,
	chartData,
	flowBands,
	flowMax,
	type Insights,
	isInsights,
	linePath,
	loadInsights,
	niceMax,
	scale,
	spread,
	ticks,
	timeSplit,
} from "./insightsApi";
import { peekWorkspaceFile, publishSnapshot } from "./roadmapApi";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const DAY = 86_400_000;
const FROM = Date.UTC(2026, 10, 2);

const flow = (completed: number, started: number, backlog: number) => ({
	completed,
	review: 0,
	started,
	unstarted: 0,
	backlog,
});

function insightsOf(overrides: Partial<Insights> = {}): Insights {
	return {
		from: FROM,
		to: FROM + 2 * DAY + DAY / 2,
		weeks: 1,
		days: [
			{ day: FROM, wip: 0, flow: flow(0, 0, 2) },
			{ day: FROM + DAY, wip: 1, flow: flow(0, 1, 1) },
			{ day: FROM + 2 * DAY, wip: 1, flow: flow(1, 1, 0) },
		],
		throughput: [{ start: FROM, cards: 1, partial: true }],
		cycleTimes: [
			{ cardId: "TR-1", completedAt: FROM + DAY, days: 2 },
			{ cardId: "TR-2", completedAt: FROM + 2 * DAY, days: 4 },
			{ cardId: "TR-3", completedAt: FROM + 2 * DAY, days: 6 },
		],
		cycle: { p50: 4, p85: 6 },
		aging: [
			{ cardId: "TR-4", category: "started", days: 8 },
			{ cardId: "TR-5", category: "review", days: 1 },
		],
		sle: 6,
		time: { agent: 3 * 3_600_000, waiting: 3_600_000, review: 0 },
		empty: false,
		...overrides,
	};
}

describe("the insights' chart math", () => {
	test("scales, nice axis maxima and ticks", () => {
		const x = scale([0, 10], [20, 120]);
		expect(x(0)).toBe(20);
		expect(x(5)).toBe(70);
		expect(scale([3, 3], [5, 9])(3)).toBe(5);
		expect([0, 0.4, 1, 3, 7, 12, 51].map(niceMax)).toEqual([1, 0.5, 1, 5, 10, 20, 100]);
		expect(ticks(10)).toEqual([0, 5, 10]);
		expect(ticks(5)).toEqual([0, 5]);
		expect(ticks(0.5)).toEqual([0, 0.25, 0.5]);
		expect(
			linePath([
				{ x: 0, y: 1.234 },
				{ x: 10.06, y: 2 },
			]),
		).toBe("M0,1.2 L10.1,2");
	});

	test("the cumulative flow stacks done at the bottom, backlog on top", () => {
		const days = insightsOf().days;
		const bands = flowBands(days);
		expect(bands.map((band) => band.category)).toEqual([
			"completed",
			"review",
			"started",
			"unstarted",
			"backlog",
		]);
		expect(bands[0]).toEqual({ category: "completed", lower: [0, 0, 0], upper: [0, 0, 1] });
		expect(bands[2]).toEqual({ category: "started", lower: [0, 0, 1], upper: [0, 1, 2] });
		expect(bands[4]?.upper).toEqual([2, 2, 2]);
		expect(flowMax(days)).toBe(2);
		expect(bandPath([0, 10], [1, 2], [0, 0])).toBe("M0,1 L10,2 L10,0 L0,0 Z");
	});

	test("where time goes splits into hours and shares; dots spread deterministically", () => {
		expect(timeSplit(insightsOf().time)).toEqual([
			{ key: "agent", hours: 3, percent: 75, start: 0 },
			{ key: "waiting", hours: 1, percent: 25, start: 75 },
			{ key: "review", hours: 0, percent: 0, start: 100 },
		]);
		expect(timeSplit({ agent: 0, waiting: 0, review: 0 }).map((entry) => entry.percent)).toEqual([
			0, 0, 0,
		]);
		expect(spread(0, 1, 40)).toBe(0);
		expect(spread(0, 3, 40)).toBe(-20);
		expect(spread(4, 5, 40)).toBe(20);
	});

	test("every chart says whether it has data", () => {
		expect(Object.values(chartData(insightsOf())).every(Boolean)).toBe(true);
		const empty = insightsOf({
			empty: true,
			days: [{ day: FROM, wip: 0, flow: flow(0, 0, 0) }],
			throughput: [{ start: FROM, cards: 0, partial: true }],
			cycleTimes: [],
			cycle: { p50: null, p85: null },
			aging: [],
			sle: null,
			time: { agent: 0, waiting: 0, review: 0 },
		});
		expect(Object.values(chartData(empty)).some(Boolean)).toBe(false);
	});

	test("loads insights.get with its weeks and checks the reply's shape", async () => {
		const { host, queries } = fakeHost(() => insightsOf());
		expect((await loadInsights(host, "p1", 12)).weeks).toBe(1);
		expect(queries).toEqual([{ method: "insights.get", params: { projectId: "p1", weeks: 12 } }]);
		expect(isInsights({ from: 1 })).toBe(false);
		await expect(loadInsights(fakeHost(() => ({})).host, "p1", 4)).rejects.toThrow("unknown shape");
	});
});

describe("the insights' charts", () => {
	test("draw WIP, throughput, cycle time with its percentiles, age against the SLE, flow and time", () => {
		const markup = html(
			<InsightsCharts insights={insightsOf()} layout="columns" initialWidth={400} />,
		);
		expect(markup.match(/data-testid="board-insights-chart"/g)).toHaveLength(6);
		expect(markup).not.toContain("data-empty");
		expect(markup.match(/<title id=/g)).toHaveLength(6);
		expect(markup.match(/<desc id=/g)).toHaveLength(6);
		expect(markup).toContain('data-testid="board-insights-wip-line"');
		expect(markup).toContain('data-partial="true"');
		expect(markup.match(/data-testid="board-insights-cycle-dot"/g)).toHaveLength(3);
		expect(markup).toContain('data-testid="board-insights-p50"');
		expect(markup).toContain('data-testid="board-insights-p85"');
		expect(markup).toContain('data-testid="board-insights-sle"');
		expect(markup).toContain('data-over="true"');
		expect(markup.match(/data-testid="board-insights-flow-band"/g)).toHaveLength(5);
		expect(markup).toContain("fill-ramp-2");
		expect(markup.match(/data-testid="board-insights-time-segment"/g)).toHaveLength(2);
		expect(markup).toContain("Agent working: 3 h · 75 %");
		expect(markup).toContain("grid-cols-2");
	});

	test("say there is not enough data instead of drawing an empty chart", () => {
		const markup = html(
			<InsightsCharts
				insights={insightsOf({
					empty: true,
					days: [],
					throughput: [],
					cycleTimes: [],
					cycle: { p50: null, p85: null },
					aging: [],
					sle: null,
					time: { agent: 0, waiting: 0, review: 0 },
				})}
				layout="stacked"
				initialWidth={400}
			/>,
		);
		expect(markup.match(/data-empty="true"/g)).toHaveLength(6);
		expect(markup.match(/Not enough data yet/g)).toHaveLength(6);
		expect(markup).not.toContain("<svg");
		expect(markup).toContain("grid-cols-1");
	});
});

describe("publishing the roadmap snapshot", () => {
	test("asks roadmap.publish with the path, checks the reply and peeks the file where it was written", async () => {
		const written = { projectId: "p1", workspaceId: "w-default", path: "ROADMAP.md", bytes: 9 };
		const { host, queries, peeks, workspaces } = fakeHost(() => written);
		expect(await publishSnapshot(host, "p1", "ROADMAP.md")).toEqual(written);
		await publishSnapshot(host, "p1");
		expect(queries).toEqual([
			{ method: "roadmap.publish", params: { projectId: "p1", path: "ROADMAP.md" } },
			{ method: "roadmap.publish", params: { projectId: "p1" } },
		]);
		await expect(publishSnapshot(fakeHost(() => ({})).host, "p1")).rejects.toThrow("unknown shape");
		peekWorkspaceFile(host, written);
		expect(workspaces).toEqual([
			{
				workspaceId: "w-default",
				projectId: "p1",
				peek: { kind: "file", path: "ROADMAP.md" },
			},
		]);
		peekWorkspaceFile(host, { ...written, workspaceId: "w0" });
		expect(peeks).toEqual([{ kind: "file", path: "ROADMAP.md" }]);
	});
});
