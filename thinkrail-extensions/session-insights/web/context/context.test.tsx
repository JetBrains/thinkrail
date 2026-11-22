import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	ContextCall,
	SessionContext,
	SessionCost,
	SessionFiles,
} from "@thinkrail/pi-session-insights/core";
import { LocalKeymapProvider } from "@thinkrail/ui/local-keys";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CostView } from "../cost/CostView";
import { FilesView } from "../files/FilesView";
import { SOURCES } from "../fixtures.test";
import { PANEL_KEYS, PANEL_SCOPE } from "../keys";
import { sampleEvents, T0 } from "../trace/events.test";
import { TraceModel } from "../trace/model";
import { ContextView } from "./ContextView";
import { callAt, clampView, fullView, niceStep, viewShowing, zoomAt } from "./chart";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

const host = {
	query: async () => ({}),
	openChat: () => {},
	openPanel: () => {},
	renderToolCall: () => null,
	openFile: () => {},
	scope: { workspaceId: "w1", projectId: "p1" },
	hostProtocol: 130,
	hostApiVersion: 11,
} satisfies PanelHost;

function call(n: number, overrides: Partial<ContextCall> = {}): ContextCall {
	return {
		id: `c${n}`,
		n,
		t: T0 + n * 1_000,
		model: "anthropic/claude",
		turn: 1,
		total: 10_000 * n,
		input: 100,
		cacheRead: 9_000 * n,
		cacheWrite: 1_000 * n - 100,
		parts: [500, 1_000, 500, 0, 1_000 * n, 2_000 * n - 3_000, 6_000 * n, 1_000],
		delta: n > 1 ? [0, 0, 0, 0, 1_000, 2_000, 6_000, 0] : null,
		coverage: 0.9,
		gapMs: n > 1 ? 1_000 : null,
		cost: 0.01 * n,
		...overrides,
	};
}

const CONTEXT: SessionContext = {
	revision: "r",
	calls: [
		call(1),
		call(2, {
			changes: ["systemPrompt", "pause"],
			miss: { causes: ["systemPrompt", "pause"] },
			gapMs: 400_000,
		}),
		call(3, { miss: { causes: [] } }),
	],
	compactions: [
		{
			id: "k",
			t: T0 + 2_500,
			tokensBefore: 20_000,
			before: "c2",
			after: "c3",
			beforeTokens: 20_000,
			afterTokens: 30_000,
			change: 0.5,
		},
	],
	switches: [],
	limits: [
		{ model: "anthropic/claude", value: 200_000, origin: "host", host: 200_000, observed: 30_000 },
	],
	peak: { value: 30_000, origin: "recorded" },
	average: { value: 20_000, origin: "counted" },
	cacheShare: { value: 0.9, origin: "counted" },
	misses: { value: 2, origin: "approximated" },
	rewritten: { value: 4_800, origin: "approximated" },
	cacheTtlMs: 300_000,
};

describe("context and cache", () => {
	test("lists the misses with their causes, unexplained ones labelled, and the selected call's waffle", () => {
		const markup = html(
			<ContextView
				host={host}
				sessionId="s"
				data={CONTEXT}
				sources={SOURCES}
				model={new TraceModel(sampleEvents())}
				selectedId="c2"
				onSelectId={() => {}}
				onShowInTrace={() => {}}
			/>,
		);
		expect(markup).toContain('data-testid="context-chart"');
		expect(markup).toContain('data-calls="3"');
		expect(markup.match(/data-testid="context-miss"/g)).toHaveLength(2);
		expect(markup).toContain('data-cause="systemPrompt"');
		expect(markup).toContain("pause 6 min &gt; cache TTL (5 min)");
		expect(markup).toContain('data-cause="unexplained"');
		expect(markup).toContain("not explainable from the data");
		expect(markup).toContain('data-call-id="c2"');
		expect(markup.match(/class="size-12 rounded-sm bg-/g)).toHaveLength(100);
		expect(markup).toContain("1 cell = 1% of the window");
		expect(markup).toContain('data-testid="context-grew"');
		expect(markup).toContain("+≈6K");
		expect(markup).toContain('data-testid="session-insights-badge"');
	});

	test("the chart's keys are the panel's local keys, described with the user's bindings", () => {
		const view = (
			<ContextView
				host={host}
				sessionId="s"
				data={CONTEXT}
				sources={SOURCES}
				model={new TraceModel(sampleEvents())}
				selectedId="c2"
				onSelectId={() => {}}
				onShowInTrace={() => {}}
			/>
		);
		const defaults = html(view);
		expect(defaults).toContain(`data-key-scope="${PANEL_SCOPE}"`);
		expect(defaults).toContain("Home/End first and last, +/− zoom, 0 shows every call.");
		const rebound = html(
			<LocalKeymapProvider
				value={{
					platform: "Linux x86_64",
					scopes: new Map([
						[
							PANEL_SCOPE,
							[
								{ id: PANEL_KEYS.zoomIn, chord: { code: "KeyI", key: "I" } },
								{ id: PANEL_KEYS.zoomOut, chord: { code: "KeyO", key: "O", shift: true } },
								{ id: PANEL_KEYS.zoomFit, chord: { code: "KeyA", key: "A" } },
							],
						],
					]),
					isTextEntry: () => false,
				}}
			>
				{view}
			</LocalKeymapProvider>,
		);
		expect(rebound).toContain("Home/End first and last, I/Shift+O zoom, A shows every call.");
		expect(rebound).toContain('aria-keyshortcuts="I Shift+O A"');
	});

	test("the chart's window clamps, zooms around a point and keeps a selection in view", () => {
		expect(fullView(10)).toEqual({ v0: -0.5, v1: 9.5 });
		expect(clampView({ v0: -5, v1: 2 }, 10)).toEqual({ v0: -0.5, v1: 6.5 });
		const zoomed = zoomAt(fullView(100), 100, 50, 4);
		expect(zoomed.v1 - zoomed.v0).toBeCloseTo(25, 6);
		expect(viewShowing({ v0: 0, v1: 10 }, 100, 80)).toEqual({ v0: 75, v1: 85 });
		expect(niceStep(1_000_000, 4)).toBe(500_000);
		const calls = [call(1), call(2), call(3)];
		expect(callAt(fullView(3), 352, 52 + 150, calls)).toBe(1);
		expect(callAt(fullView(3), 352, 10, calls)).toBeNull();
	});
});

const COST: SessionCost = {
	revision: "r",
	headline: "cost",
	total: { value: 2.75, origin: "recorded" },
	tokens: { value: 500_000, origin: "recorded" },
	calls: [
		{ id: "c1", n: 1, t: T0, cost: 0.1, tokens: 1000, context: 60_000 },
		{ id: "c2", n: 2, t: T0 + 1_000, cost: 1, tokens: 1000, context: 90_000 },
	],
	moments: [
		{
			rank: 1,
			turnId: "u1",
			turnN: 1,
			stepId: "t_b",
			stepN: 2,
			stepTitle: "Write the docs",
			phase: "beforeCompaction",
			t0: T0,
			t1: T0 + 1_000,
			llmCalls: 2,
			toolCalls: 1,
			errors: 1,
			cost: { value: 2, origin: "recorded" },
			tokens: { value: 2_000, origin: "recorded" },
			share: 0.73,
			perCall: 1,
			contextMin: 90_000,
			contextMax: 95_000,
			tools: [{ name: "bun run docs", n: 1 }],
			topCall: { id: "c2", n: 2, cost: 1, tokens: 1000 },
		},
	],
	rest: { moments: 2, value: 0.7 },
	summaries: { value: 0.05, origin: "recorded" },
	spikes: [
		{
			id: "c2",
			n: 2,
			t: T0 + 1_000,
			cost: 1,
			tokens: 40_000,
			context: 40_000,
			cacheRead: 300,
			cacheWrite: 39_000,
			gapMs: 1_000,
			turnN: 1,
			firstOfTurn: false,
			causes: [],
		},
	],
	compactions: [{ id: "k", t: T0 + 500, after: "c2" }],
	diagnosis: {
		kind: "longContext",
		calls: 9,
		averageContext: 63_556,
		peakContext: 95_000,
		cacheReadShare: 0.9,
		medianCall: 0.1,
		focus: {
			kind: "steps",
			items: [
				{ n: 2, title: "Write the docs", value: 2.5 },
				{ n: 1, title: "Build the parser", value: 0.2 },
			],
			share: 0.98,
			peakContext: 95_000,
		},
		compaction: null,
		highContext: {
			calls: 2,
			value: 2,
			models: [{ model: "anthropic/claude-test", threshold: 80_000, calls: 2 }],
		},
		rewrites: null,
	},
};

describe("why expensive", () => {
	test("shows the diagnosis, the moments linked to their call and prompt, and an unexplained spike", () => {
		const markup = html(<CostView cost={COST} sources={SOURCES} onShowInTrace={() => {}} />);
		expect(markup).toContain('data-kind="longContext"');
		expect(markup).toContain(
			"Expensive because of a long context: 9 calls re-read 63.6K tokens on average; 98% of the spend went to plan steps 2 «Write the docs» and 1 «Build the parser» at a context up to 95K.",
		);
		expect(markup).toContain('data-testid="cost-moment"');
		expect(markup).toContain("call #2 · $1.00");
		expect(markup).toContain("prompt #1");
		expect(markup).toContain("before compaction");
		expect(markup).toContain('data-unexplained="true"');
		expect(markup).toContain("cause not derivable from the data");
		expect(markup).toContain("2 calls at a context ≥ 80K = $2.00");
	});

	test("high-context calls of several models name each model's own threshold", () => {
		const cost: SessionCost = {
			...COST,
			diagnosis: {
				...COST.diagnosis,
				highContext: {
					calls: 3,
					value: 1.8,
					models: [
						{ model: "anthropic/large-1m", threshold: 800_000, calls: 1 },
						{ model: "anthropic/small-200k", threshold: 160_000, calls: 2 },
					],
				},
			},
		};
		const markup = html(<CostView cost={cost} sources={SOURCES} onShowInTrace={() => {}} />);
		expect(markup).toContain(
			"3 calls near their model&#x27;s context window (≥ 800K on anthropic/large-1m, ≥ 160K on anthropic/small-200k) = $1.80",
		);
	});
});

const FILES: SessionFiles = {
	revision: "r",
	columns: "turns",
	cols: [
		{ turnId: "u1", turnN: 1, stepId: null, stepN: null, title: "fix it", t0: T0 },
		{ turnId: "u2", turnN: 2, stepId: null, stepN: null, title: "again", t0: T0 + 1_000 },
	],
	rows: [
		{
			path: "src/a.ts",
			inside: true,
			reads: 1,
			edits: 5,
			writes: 1,
			failed: 1,
			added: 9,
			removed: 2,
			rework: true,
			cells: [
				[0, 1, 2, 0, 1],
				[1, 0, 3, 1, 0],
			],
			receipt: null,
		},
		{
			path: "~/notes.md",
			inside: false,
			reads: 2,
			edits: 0,
			writes: 0,
			failed: 0,
			added: 0,
			removed: 0,
			rework: false,
			cells: [[1, 2, 0, 0, 0]],
			receipt: null,
		},
	],
	hidden: 0,
	totals: { files: 2, changed: 1, readOnly: 1, rework: 1, failed: 1, added: 9, removed: 2 },
	receipts: false,
	start: T0,
	end: T0 + 2_000,
};

describe("files", () => {
	test("the matrix shows rings for reads, filled counts for changes, failed edits and a rework row", () => {
		const markup = html(
			<FilesView
				host={host}
				sessionId="s"
				overview={null}
				files={FILES}
				sources={SOURCES}
				onShowInTrace={() => {}}
			/>,
		);
		expect(markup.match(/data-testid="files-row"/g)).toHaveLength(2);
		expect(markup).toContain('data-rework="true"');
		expect(markup).toContain('data-testid="files-rework"');
		expect(markup).toContain("6×");
		expect(markup).toContain('data-kind="read"');
		expect(markup).toContain('data-kind="edit"');
		expect(markup).toContain('data-testid="files-failed"');
		expect(markup).toContain("2 files × turns");
	});
});
