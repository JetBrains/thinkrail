import { describe, expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import { sampleEvents, T0 } from "../trace/events.test";
import { TraceModel } from "../trace/model";
import { TimeScale, type View } from "../trace/scale";
import { summary, timelineOf } from "./fixtures.test";
import {
	GUTTER,
	hitTimeline,
	layoutLanes,
	plotUnit,
	plotWidth,
	plotX,
	SUBAGENT_TRACK_PX,
	TimelineItems,
	TOOL_TRACK_PX,
	valueAt,
	windowRuns,
} from "./layout";
import { describeHit } from "./TimelineView";

const model = new TraceModel(sampleEvents());
const timeline = timelineOf([summary("u1", 1), summary("u2", 2)]);
const WIDTH = GUTTER + 1000 + 8;
const scale = new TimeScale(T0, T0 + 610_000, [], null);
const view: View = { u0: 0, u1: 610_000 };
const items = new TimelineItems(model, timeline);
const layout = layoutLanes(timeline.lanes.toolTracks, timeline.lanes.subagentTracks);
const input = { layout, items, model, timeline, analysis: null, scale, view, width: WIDTH };
const lane = (key: string) => {
	const found = layout.lanes.find((candidate) => candidate.key === key);
	if (!found) throw new Error(`no ${key} lane`);
	return found;
};
const xAt = (time: number) => plotX(view, WIDTH, scale.toUnit(time));

describe("the timeline layout", () => {
	test("stacks the lanes and grows the packed ones with their tracks", () => {
		expect(layout.lanes.map((candidate) => candidate.key)).toEqual([
			"band",
			"user",
			"model",
			"tools",
			"subagents",
			"context",
			"spend",
		]);
		expect(lane("tools").height).toBe(2 * TOOL_TRACK_PX + 6);
		expect(lane("subagents").height).toBe(SUBAGENT_TRACK_PX + 6);
		expect(layoutLanes(1, 0).lanes.find((candidate) => candidate.key === "subagents")?.height).toBe(
			22,
		);
		for (const [a, b] of layout.lanes.slice(1).map((next, at) => [layout.lanes[at], next]))
			expect((b?.y ?? 0) >= (a?.y ?? 0) + (a?.height ?? 0)).toBe(true);
	});

	test("maps plot x and axis units both ways past the gutter", () => {
		expect(plotX(view, WIDTH, 0)).toBe(GUTTER);
		expect(plotX(view, WIDTH, 610_000)).toBe(GUTTER + plotWidth(WIDTH));
		expect(plotUnit(view, WIDTH, plotX(view, WIDTH, 123_456))).toBeCloseTo(123_456, 6);
	});

	test("draws each model's context window over its own calls only", () => {
		const points = [
			{ x: 120, model: "small" },
			{ x: 200, model: "small" },
			{ x: 300, model: "large" },
			{ x: 400, model: "large" },
			{ x: 500, model: "small" },
		];
		expect(windowRuns(points, GUTTER, 900)).toEqual([
			{ model: "small", x0: GUTTER, x1: 300 },
			{ model: "large", x0: 300, x1: 500 },
			{ model: "small", x0: 500, x1: 900 },
		]);
		expect(windowRuns(points.slice(0, 2), GUTTER, 900)).toEqual([
			{ model: "small", x0: GUTTER, x1: 900 },
		]);
		expect(windowRuns([], GUTTER, 900)).toEqual([]);
	});

	test("places events on their lane and track and orders them for the keyboard", () => {
		expect(items.track("tools", 1).map((item) => model.at(item.index)?.id)).toEqual(["t2"]);
		expect(items.track("tools", 0).map((item) => model.at(item.index)?.id)).toEqual(["t1"]);
		expect(items.track("user", 0).every((item) => item.point)).toBe(true);
		expect(items.track("subagents", 0).map((item) => model.at(item.index)?.id)).toEqual(["s1"]);
		const first = items.ordered[0] ?? -1;
		expect(model.at(first)?.id).toBe("u1");
		expect(items.step(first, 1)).toBe(model.indexOf("a1"));
		expect(items.step(first, -1)).toBeNull();
		expect(items.step(-1, 1)).toBe(first);
	});
});

describe("timeline hit-testing", () => {
	test("finds calls, packed tracks, prompts, bands, counters and lane labels", () => {
		const model0 = lane("model");
		const call = hitTimeline(input, xAt(T0 + 4_000), model0.y + model0.height / 2);
		expect(call?.kind === "item" && model.at(call.item.index)?.id).toBe("a1");
		const tools = lane("tools");
		const parallel = hitTimeline(input, xAt(T0 + 20_000), tools.y + 3 + TOOL_TRACK_PX + 4);
		expect(parallel?.kind === "item" && model.at(parallel.item.index)?.id).toBe("t2");
		const firstTrack = hitTimeline(input, xAt(T0 + 20_000), tools.y + 5);
		expect(firstTrack).toBeNull();
		const user = lane("user");
		const prompt = hitTimeline(input, xAt(T0 + 1_000) + 3, user.y + 10);
		expect(prompt?.kind === "item" && model.at(prompt.item.index)?.id).toBe("u1");
		const band = hitTimeline(input, xAt(T0 + 300_000), lane("band").y + 6);
		expect(band).toMatchObject({ kind: "band", band: { actor: "user" } });
		const context = hitTimeline(input, xAt(T0 + 35_000), lane("context").y + 20);
		expect(context).toMatchObject({ kind: "context", point: { id: "a2", miss: true } });
		expect(hitTimeline(input, xAt(T0 + 35_000), lane("spend").y + 10)).toMatchObject({
			kind: "spend",
		});
		expect(hitTimeline(input, 20, lane("tools").y + 4)).toEqual({
			kind: "lane",
			lane: "tools",
			step: -1,
		});
		expect(hitTimeline(input, xAt(T0), layout.height + 50)).toBeNull();
	});

	test("a compressed pause answers where no item is", () => {
		const gaps = [{ t0: T0 + 40_000, t1: T0 + 600_000, cause: "user" as const }];
		const compressed = new TimeScale(T0, T0 + 610_000, gaps, 120_000);
		const [gap] = compressed.breaks;
		if (!gap) throw new Error("no break");
		const fit = { u0: compressed.min, u1: compressed.max };
		const x = plotX(fit, WIDTH, (gap.u0 + gap.u1) / 2);
		const hit = hitTimeline({ ...input, scale: compressed, view: fit }, x, lane("model").y + 10);
		expect(hit).toMatchObject({ kind: "pause", stretch: { cause: "user" } });
	});

	test("step functions read their last point at or before a time", () => {
		expect(valueAt(timeline.spend, T0)).toBeNull();
		expect(valueAt(timeline.spend, T0 + 39_000)?.cost).toBe(0.01);
		expect(valueAt(timeline.spend, T0 + 40_000)?.cost).toBe(0.02);
	});

	test("tooltips name what is under the pointer, labelling heuristics", () => {
		const t = currentTranslator();
		const band = describeHit(t, "en", model, timeline, {
			kind: "band",
			band: { t0: T0, t1: T0 + 60_000, actor: "user" },
		});
		expect(band[0]).toBe("You");
		expect(band.join(" ")).toContain("Inferred");
		const miss = describeHit(t, "en", model, timeline, {
			kind: "context",
			point: { id: "a2", tokens: 30, miss: true },
			index: model.indexOf("a2"),
		});
		expect(miss.join(" ")).toContain("cache miss (heuristic)");
		expect(miss.join(" ")).toContain("limit 200");
		const spend = describeHit(t, "en", model, timeline, { kind: "spend", t: T0 + 35_000 });
		expect(spend.join(" ")).toContain("with subagents: $0.11");
	});
});
