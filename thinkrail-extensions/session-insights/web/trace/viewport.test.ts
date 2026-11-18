import { describe, expect, test } from "bun:test";
import type {
	PlanStep,
	SessionAnalysis,
	SessionTimeline,
	TraceEvent,
} from "@thinkrail/pi-session-insights/core";
import { TimelineEngine, type TimelineText } from "../timeline/engine";
import { layoutLanes, TimelineItems } from "../timeline/layout";
import {
	type CanvasRecord,
	fakeCanvas,
	PALETTE,
	recordingContext,
	withBrowser,
} from "./canvas.test";
import { llm, mark, T0, tool, turn } from "./events.test";
import { GanttEngine, type GanttText, headerBands } from "./gantt";
import { TraceModel } from "./model";
import { clampView, TimeScale } from "./scale";

const HOUR = 3_600_000;
const END = T0 + 8 * HOUR;
const counted = (value: number) => ({ value, origin: "counted" as const });

/** One eight-hour turn whose calls, plan step, skill, context and spend all reach past any zoomed view. */
function longSession(): TraceEvent[] {
	return [
		turn("u1", 1, T0, END),
		llm("a1", "u1", T0 + 1_000, END - 1_000, { timing: "approximated" }),
		tool("t1", "a1", T0 + 2_000, END - 2_000, { timing: "approximated" }),
		mark("m1", "u1", T0 + 3_000),
		llm("a2", "u1", END - 500, END, { model: "openai/gpt-test" }),
	];
}

function longStep(): PlanStep {
	return {
		id: "s1",
		title: "Ship it",
		group: null,
		origin: "agent",
		first: T0,
		changes: [{ t: T0, status: "pending", eventId: "a1", tool: "todo_write" }],
		active: [{ t0: END - 10, t1: END }],
		status: "inProgress",
		toolCalls: counted(1),
		errors: counted(0),
		tokens: {
			value: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
			origin: "recorded",
		},
		cost: { value: 0.01, origin: "recorded" },
	};
}

const ANALYSIS: SessionAnalysis = {
	revision: "r1",
	plan: { steps: [longStep()], groups: [], summaries: [], calls: 1, rewrites: 0 },
	skills: [
		{
			name: "todos",
			t: T0,
			eventId: "t1",
			via: "read",
			workflow: true,
			scopeEnd: END,
			scopeBy: "turnEnd",
		},
	],
	turns: [],
	repeats: [],
	chains: [],
	clusters: [],
	toolRecovery: [],
	toolFailures: 0,
	modelRecovery: { failures: 0, chains: 0, sameModel: 0, afterSwitch: 0, never: 0 },
	transcripts: [],
};

const scale = new TimeScale(T0, END, [], null);
const view = clampView(scale, { u0: 4 * HOUR, u1: 4 * HOUR + 1 });

/** The length of everything a draw stroked dashed: what a canvas lays dashes over. */
function dashedLength(record: CanvasRecord): number {
	let total = 0;
	for (const line of record.lines)
		if (line.dashed) total += Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
	for (const rect of record.rects)
		if (rect.dashed) total += 2 * (Math.abs(rect.width) + Math.abs(rect.height));
	return total;
}

function timed(draw: () => void): number {
	let elapsed = Number.POSITIVE_INFINITY;
	for (let run = 0; run < 3; run += 1) {
		const started = performance.now();
		draw();
		elapsed = Math.min(elapsed, performance.now() - started);
	}
	return elapsed;
}

describe("a draw at the minimum zoom is the viewport's work, not the session's", () => {
	const budget = process.env.SESSION_INSIGHTS_PERF === "1" ? 8 : 80;

	test("the trace's body, overlay and header over an eight-hour session", () => {
		const width = 1000;
		const height = 400;
		const { context, record } = recordingContext();
		withBrowser(context, (flush) => {
			const engine = new GanttEngine(fakeCanvas(context), fakeCanvas(context), fakeCanvas(context));
			const model = new TraceModel(longSession());
			const open = new Map<string, boolean>();
			const text: GanttText = {
				font: "12px sans-serif",
				time: () => "10:00",
				date: () => "Nov 1",
				breakLabel: () => "",
				hover: () => "call",
				band: () => "skill",
				hidden: () => "",
			};
			engine.setPalette(PALETTE, text);
			engine.setSize(width, height, 1);
			engine.setState({
				model,
				rows: model.visible(open, null).rows,
				runs: new Map(),
				open: (index) => model.isOpen(index, open),
				scale,
				view,
				selected: 1,
				hits: new Set(),
				bands: headerBands(true, true),
				analysis: ANALYSIS,
				pick: { kind: "skill", index: 0 },
				keep: null,
				flows: [],
			});
			const elapsed = timed(() => {
				engine.setHover({ row: 1, x: 500 });
				engine.setSize(width, height, 1);
				flush();
			});
			expect(record.calls).toBeLessThan(3 * 3_000);
			expect(dashedLength(record)).toBeLessThan(3 * 4 * (width + height));
			expect(elapsed).toBeLessThan(budget);
		});
	});

	test("the timeline's lanes, plan and skill rows over an eight-hour session", () => {
		const width = 112 + 1000 + 8;
		const height = 500;
		const { context, record } = recordingContext();
		withBrowser(context, (flush) => {
			const engine = new TimelineEngine(
				fakeCanvas(context),
				fakeCanvas(context),
				fakeCanvas(context),
			);
			const model = new TraceModel(longSession());
			const timeline: SessionTimeline = {
				revision: "r1",
				start: T0,
				end: END,
				headline: "cost",
				turns: [],
				bands: [{ t0: T0, t1: END, actor: "model" }],
				waits: { user: 0, model: END - T0, tool: 0, subagent: 0, background: 0, idle: 0 },
				waitsTotal: { value: END - T0, origin: "approximated" },
				lanes: { toolTracks: 1, subagentTracks: 0, tracks: [] },
				context: [
					{ id: "a1", tokens: 10 },
					{ id: "a2", tokens: 30 },
				],
				peak: { value: 30, origin: "recorded" },
				llmCalls: { value: 2, origin: "counted" },
				limits: [
					{ model: "anthropic/claude-test", value: 40, origin: "host", host: 40, observed: 30 },
				],
				spend: [
					{ t: T0 + 1_000, tokens: 10, cost: 0.01 },
					{ t: END, tokens: 20, cost: 0.02 },
				],
				withSubagents: [
					{ t: T0 + 1_000, tokens: 10, cost: 0.01 },
					{ t: END, tokens: 120, cost: 0.12 },
				],
				cacheTtlMs: 300_000,
			};
			const text: TimelineText = {
				font: "12px sans-serif",
				time: () => "10:00",
				date: () => "Nov 1",
				step: (n) => `#${n}`,
				lane: () => ["lane", null],
				turn: (n) => `#${n}`,
				tooltip: () => [],
				limit: () => "200k",
				peak: () => "30",
				spend: () => "$0.02",
				noSubagents: "",
				breakLabel: () => "",
				stepSpend: () => "$0.01",
			};
			engine.setPalette(PALETTE, text);
			engine.setSize(width, height, 1);
			engine.setState({
				model,
				timeline,
				items: new TimelineItems(model, timeline),
				layout: layoutLanes(1, 0, { steps: 1, skills: true }),
				scale,
				mode: "time",
				view,
				selected: 1,
				analysis: ANALYSIS,
				pick: null,
				highlight: null,
				failures: [],
			});
			const elapsed = timed(() => {
				engine.setHover({ x: 600, y: 40, hit: null });
				engine.setSize(width, height, 1);
				flush();
			});
			expect(record.calls).toBeLessThan(3 * 3_000);
			expect(dashedLength(record)).toBeLessThan(3 * 8 * (width + height));
			expect(elapsed).toBeLessThan(budget);
		});
	});
});
