import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	CompareMetric,
	SequenceCell,
	SessionRef,
	SlicesCompareResult,
	StatsSequences,
	StatsSequencesResult,
} from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES } from "../fixtures.test";
import { VersionSkew } from "../session/api";
import { loadCompare, loadSequences } from "./api";
import { CompareView } from "./CompareView";
import { ErrorFlow, placeColumns } from "./ErrorFlow";
import { processLayout } from "./processLayout";
import { SequencesView } from "./SequencesView";
import { largestCell, TransitionMatrix } from "./TransitionMatrix";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const noop = () => {};
const actions = { onOpenSession: noop, onShowSessions: noop };
const STATE = { phase: "ready" as const, indexed: 2, total: 2 };

const SESSIONS: SessionRef[] = [
	{
		sessionId: "s1",
		title: "Fix the parser",
		firstPrompt: null,
		start: Date.UTC(2026, 10, 3, 9),
		projectId: "p1",
		workspaceId: "w1",
		workspaceState: "open",
	},
	{
		sessionId: "s2",
		title: "Ship the release",
		firstPrompt: null,
		start: Date.UTC(2026, 10, 2, 9),
		projectId: "p1",
		workspaceId: "w1",
		workspaceState: "open",
	},
];

function cell(
	overrides: Partial<SequenceCell> & Pick<SequenceCell, "source" | "target">,
): SequenceCell {
	return {
		count: 1,
		share: 1,
		afterError: 0,
		errorMark: false,
		top: [{ session: 0, count: 1, eventId: "tool:e1:0" }],
		sessions: [0],
		example: null,
		...overrides,
	};
}

const RULES: StatsSequences["rules"] = {
	errorMarkShare: 0.05,
	cellThresholds: [1, 2, 5, 10, 20, 50, 100, 200, 500],
	edgeShares: [0.01, 0.02, 0.05],
	cellSessions: 7,
	chainSteps: 3,
	chainsShown: 9,
	flowSteps: 3,
	flowRareShare: 0.025,
	failuresShown: 8,
	exampleSteps: 6,
};

function sequences(): StatsSequences {
	return {
		activities: ["read", "edit", "test"],
		nodes: [
			{ activity: "read", calls: 30, failed: 0, starts: 2, ends: 0, transitions: 30 },
			{ activity: "edit", calls: 10, failed: 1, starts: 0, ends: 0, transitions: 10 },
			{ activity: "test", calls: 8, failed: 3, starts: 0, ends: 2, transitions: 6 },
		],
		cells: [
			cell({
				source: "read",
				target: "read",
				count: 20,
				share: 20 / 30,
				top: [
					{ session: 0, count: 14, eventId: "tool:r1:0" },
					{ session: 1, count: 6, eventId: "tool:r9:0" },
				],
				sessions: [0, 1],
				example: {
					session: 0,
					steps: [
						{
							eventId: "tool:r0:0",
							tool: "read",
							activity: "read",
							label: "a.ts",
							failed: false,
							pair: false,
						},
						{
							eventId: "tool:r1:0",
							tool: "read",
							activity: "read",
							label: "b.ts",
							failed: false,
							pair: true,
						},
						{
							eventId: "tool:r2:0",
							tool: "read",
							activity: "read",
							label: "c.ts",
							failed: false,
							pair: true,
						},
					],
				},
			}),
			cell({ source: "read", target: "edit", count: 10, share: 10 / 30 }),
			cell({ source: "edit", target: "test", count: 9, share: 0.9 }),
			cell({ source: "edit", target: "read", count: 1, share: 0.1 }),
			cell({
				source: "test",
				target: "edit",
				count: 5,
				share: 5 / 6,
				afterError: 3,
				errorMark: true,
			}),
			cell({ source: "test", target: "read", count: 1, share: 1 / 6 }),
		],
		calls: 48,
		failed: 4,
		transitions: 46,
		sessionsWithCalls: 2,
		thresholds: [
			{ share: 0.01, min: 1, hiddenEdges: 0, hiddenTransitions: 0, hiddenNodes: [] },
			{ share: 0.02, min: 1, hiddenEdges: 0, hiddenTransitions: 0, hiddenNodes: [] },
			{ share: 0.05, min: 3, hiddenEdges: 2, hiddenTransitions: 2, hiddenNodes: [] },
		],
		chains: [{ activities: ["read", "edit", "test"], count: 4, share: 0.5 }],
		chainTotal: 8,
		flow: {
			failures: 4,
			sessions: 2,
			columns: [
				[
					{ key: "edit", count: 1 },
					{ key: "test", count: 3 },
				],
				[
					{ key: "look", count: 1 },
					{ key: "edit", count: 3 },
				],
				[
					{ key: "recovered", count: 3 },
					{ key: "end", count: 1 },
				],
				[
					{ key: "recovered", count: 3 },
					{ key: "end", count: 1 },
				],
				[
					{ key: "recovered", count: 3 },
					{ key: "ended", count: 1 },
				],
			],
			links: [
				{ column: 0, source: "edit", target: "look", count: 1 },
				{ column: 0, source: "test", target: "edit", count: 3 },
				{ column: 1, source: "look", target: "end", count: 1 },
				{ column: 1, source: "edit", target: "recovered", count: 3 },
				{ column: 2, source: "recovered", target: "recovered", count: 3 },
				{ column: 2, source: "end", target: "end", count: 1 },
				{ column: 3, source: "recovered", target: "recovered", count: 3 },
				{ column: 3, source: "end", target: "ended", count: 1 },
			],
			failing: [
				{
					key: "bun test",
					tool: "bash",
					activity: "test",
					failures: 3,
					outcomes: { recovered: 3, later: 0, never: 0, ended: 0 },
					sessions: [0, 1],
				},
			],
			example: {
				session: 0,
				steps: [
					{
						eventId: "tool:t1:0",
						tool: "bash",
						activity: "test",
						label: "bun test",
						failed: true,
						state: null,
					},
					{
						eventId: "tool:e1:0",
						tool: "edit",
						activity: "edit",
						label: "a.ts",
						failed: false,
						state: "edit",
					},
					{
						eventId: "tool:t2:0",
						tool: "bash",
						activity: "test",
						label: "bun test",
						failed: false,
						state: "recovered",
					},
				],
			},
		},
		rules: RULES,
	};
}

function sequencesResult(): StatsSequencesResult {
	return {
		apiVersion: 10,
		state: STATE,
		digests: { ready: 2, total: 2, stale: 0 },
		sessions: SESSIONS,
		sequences: sequences(),
		sources: SOURCES,
	};
}

describe("action sequences", () => {
	test("the matrix outlines loops, marks after-error cells and greys none at the lowest threshold", () => {
		const markup = html(<TransitionMatrix result={sequencesResult()} actions={actions} />);
		expect(markup.match(/data-testid="sequence-cell"/g)).toHaveLength(6);
		expect(markup).toMatch(/data-source="read" data-target="read" data-loop="true"/);
		expect(markup).toMatch(
			/data-source="test" data-target="edit" data-loop="false" data-dim="false" data-error-mark="true"/,
		);
		expect(markup).not.toContain('data-dim="true"');
		expect(markup).toContain("67%");
	});

	test("a picked cell lists the sessions where it occurs most and a real example", () => {
		expect(largestCell(sequences())?.source).toBe("read");
		const markup = html(
			<TransitionMatrix
				result={sequencesResult()}
				actions={actions}
				initial={{ source: "read", target: "read" }}
			/>,
		);
		expect(markup).toMatch(/data-testid="sequence-detail" data-source="read" data-target="read"/);
		expect(markup.match(/data-testid="sequence-session"/g)).toHaveLength(2);
		expect(markup).toContain("Fix the parser");
		expect(markup).toContain("×14");
		expect(markup).toContain('data-testid="sequence-example"');
		expect(markup.match(/data-pair="true"/g)).toHaveLength(2);
		const other = html(
			<TransitionMatrix
				result={sequencesResult()}
				actions={actions}
				initial={{ source: "test", target: "edit" }}
			/>,
		);
		expect(other).toMatch(/data-testid="sequence-detail" data-source="test" data-target="edit"/);
		expect(other).toMatch(/data-testid="sequence-kpi-afterError"[\s\S]*?3 · 60\.0%/);
	});

	test("the switch shows one view at a time; the map waits for its lazy chunk", () => {
		const matrix = html(<SequencesView result={sequencesResult()} actions={actions} />);
		expect(matrix).toContain('data-view="matrix"');
		expect(matrix).toContain('data-testid="sequence-matrix"');
		expect(matrix).toContain("2 sessions with calls · 48 calls · 46 transitions");
		const map = html(
			<SequencesView result={sequencesResult()} actions={actions} initialView="map" />,
		);
		expect(map).toContain('data-testid="sequence-map-loading"');
		expect(map).toContain("0 edges under 1 transitions hidden");
		expect(map).toContain('data-testid="sequence-chain"');
		const errors = html(
			<SequencesView result={sequencesResult()} actions={actions} initialView="errors" />,
		);
		expect(errors).toContain('data-testid="sequence-errors"');
		expect(errors).not.toContain('data-testid="sequence-matrix"');
	});

	test("the process map keeps edges at the threshold, pairs reverse edges and lays out every node", () => {
		const all = processLayout(sequences(), 0.02);
		expect(all.nodes.map((placed) => placed.node.activity)).toEqual(["read", "edit", "test"]);
		expect(all.edges).toHaveLength(6);
		expect(
			all.edges.find((edge) => edge.cell.source === "edit" && edge.cell.target === "test")?.paired,
		).toBe(true);
		expect(
			all.edges.find((edge) => edge.cell.source === "read" && edge.cell.target === "read")?.paired,
		).toBe(false);
		const strict = processLayout(sequences(), 0.05);
		expect(strict.edges.map((edge) => `${edge.cell.source}>${edge.cell.target}`)).toEqual([
			"read>read",
			"read>edit",
			"edit>test",
			"test>edit",
		]);
		expect(processLayout(sequences(), 0.05)).toEqual(strict);
		const widest = Math.max(...strict.edges.map((edge) => edge.width));
		expect(strict.edges.find((edge) => edge.cell.count === 20)?.width).toBe(widest);
	});

	test("what follows an error draws its columns, outcomes, failing table and example", () => {
		const placed = placeColumns(sequences().flow.columns, 4);
		expect(placed).toHaveLength(5);
		expect(placed[0]?.[1]?.h).toBeGreaterThan(placed[0]?.[0]?.h ?? 0);
		const markup = html(<ErrorFlow result={sequencesResult()} actions={actions} />);
		expect(markup.match(/data-testid="sequence-flow-node"/g)).toHaveLength(10);
		expect(markup).toMatch(/data-testid="sequence-flow-outcome" data-key="recovered"/);
		expect(markup).toContain("recovered within 3 steps");
		expect(markup).toContain("4 failed calls in 2 sessions · 8.3% of 48 calls");
		expect(markup).toMatch(/data-testid="sequence-failing-row" data-key="bun test"/);
		expect(markup).toContain('data-testid="sequence-flow-example"');
		expect(markup).toContain('data-state="recovered"');
	});
});

function metric(overrides: Partial<CompareMetric> & Pick<CompareMetric, "id">): CompareMetric {
	return {
		stat: "median",
		direction: "lower",
		a: { value: 10, origin: "counted" },
		b: { value: 10, origin: "counted" },
		delta: 0,
		relative: 0,
		low: -2,
		high: 2,
		verdict: "same",
		sampleA: { sessions: [0], values: [10] },
		sampleB: { sessions: [1], values: [10] },
		...overrides,
	};
}

function compareResult(): SlicesCompareResult {
	return {
		apiVersion: 10,
		state: STATE,
		digests: { ready: 2, total: 2, stale: 0 },
		sessions: SESSIONS,
		compare: {
			by: "model",
			a: {
				key: "anthropic/claude-a",
				name: null,
				sessions: [0],
				first: SESSIONS[1]?.start ?? 0,
				last: SESSIONS[1]?.start ?? 0,
			},
			b: {
				key: "anthropic/claude-b",
				name: null,
				sessions: [1],
				first: SESSIONS[0]?.start ?? 0,
				last: SESSIONS[0]?.start ?? 0,
			},
			metrics: [
				metric({
					id: "sessions",
					stat: "count",
					direction: "neutral",
					verdict: "none",
					low: null,
					high: null,
				}),
				metric({
					id: "failedShare",
					stat: "ratio",
					a: { value: 0.3, origin: "counted" },
					b: { value: 0, origin: "counted" },
					delta: -0.3,
					low: -0.35,
					high: -0.25,
					verdict: "better",
					sampleA: { sessions: [0], values: [0.3] },
					sampleB: { sessions: [1], values: [0] },
				}),
				metric({ id: "toolCalls", direction: "neutral" }),
				metric({
					id: "cost",
					verdict: "noData",
					b: { value: null, origin: "recorded" },
					delta: null,
					low: null,
					high: null,
				}),
				metric({ id: "turns", direction: "neutral", verdict: "tooFew", low: null, high: null }),
			],
			confounds: [
				{
					kind: "time",
					a: { first: Date.UTC(2026, 10, 1), last: Date.UTC(2026, 10, 4) },
					b: { first: Date.UTC(2026, 10, 11), last: Date.UTC(2026, 10, 14) },
				},
			],
			distinguishable: 1,
			options: {
				models: [
					{ key: "anthropic/claude-a", name: null, sessions: 1 },
					{ key: "anthropic/claude-b", name: null, sessions: 1 },
				],
				projects: [{ key: "p1", name: "Alpha", sessions: 2 }],
				labels: [{ key: "good", name: null, sessions: 1 }],
				days: { first: "2026-11-02", last: "2026-11-03" },
			},
			rules: { resamples: 2000, level: 0.95, minSessions: 3, timeOverlap: 0.25, mixDistance: 0.3 },
		},
		sources: SOURCES,
	};
}

describe("slice comparison", () => {
	test("verdicts: a grey indistinguishable row, a better one with its interval, no data and too few", () => {
		const markup = html(
			<CompareView
				result={compareResult()}
				choice={{ by: "model", a: null, b: null }}
				onChoice={noop}
				actions={actions}
			/>,
		);
		expect(markup).toMatch(/data-metric="toolCalls" data-verdict="same"/);
		expect(markup).toContain("not distinguishable");
		expect(markup).toMatch(/data-metric="failedShare" data-verdict="better"/);
		expect(markup).toContain("B better");
		expect(markup).toContain("−30 pp");
		expect(markup).toContain("95%: −35 pp … −25 pp");
		expect(markup).toMatch(/data-metric="cost" data-verdict="noData"/);
		expect(markup).toMatch(/data-metric="turns" data-verdict="tooFew"/);
		expect(markup.match(/data-testid="compare-interval"/g)).toHaveLength(2);
		expect(markup).toMatch(/data-testid="compare-confound" data-kind="time"/);
		expect(markup).toContain("The slices also differ in time");
		expect(markup).toMatch(/data-testid="compare-sessions" data-metric="failedShare"/);
		expect(markup.match(/data-testid="compare-dot-a"/g)).toHaveLength(1);
		expect(markup).toContain("A · anthropic/claude-a");
	});

	test("by label: label pickers with the rest for B, the text filter kept as a fallback", () => {
		const base = compareResult();
		const labelled: SlicesCompareResult = {
			...base,
			compare: {
				...base.compare,
				by: "label",
				a: { ...base.compare.a, key: "good" },
				b: { ...base.compare.b, key: "" },
			},
		};
		const markup = html(
			<CompareView
				result={labelled}
				choice={{ by: "label", a: null, b: null }}
				onChoice={noop}
				actions={actions}
			/>,
		);
		expect(markup).toMatch(/data-testid="compare-by-label" data-active="true"/);
		expect(markup).toContain('data-testid="compare-by-filter"');
		expect(markup).toContain('data-testid="compare-pick-a"');
		expect(markup).toContain('data-testid="compare-pick-b"');
		expect(markup).toContain("A · good");
		expect(markup).toContain("B · the rest");
		expect(markup).not.toContain('data-testid="compare-no-labels"');
		const unlabelled: SlicesCompareResult = {
			...labelled,
			compare: { ...labelled.compare, options: { ...labelled.compare.options, labels: [] } },
		};
		const empty = html(
			<CompareView
				result={unlabelled}
				choice={{ by: "label", a: null, b: null }}
				onChoice={noop}
				actions={actions}
			/>,
		);
		expect(empty).toContain('data-testid="compare-no-labels"');
		expect(empty).not.toContain('data-testid="compare-pick-a"');
	});

	test("queries send the slices and refuse another payload version", async () => {
		const seen: unknown[] = [];
		const host = (answer: unknown): PanelHost => ({
			query: async (method, params) => {
				seen.push([method, params]);
				return answer;
			},
			openChat: noop,
			openPanel: noop,
			renderToolCall: () => null,
			openFile: noop,
			scope: { workspaceId: "w1", projectId: "p1" },
			hostProtocol: 130,
			hostApiVersion: 10,
		});
		const signal = new AbortController().signal;
		await loadSequences(host(sequencesResult()), { kind: "all" }, signal);
		await loadCompare(
			host(compareResult()),
			{ kind: "all" },
			{ by: "period", a: "2026-11-05", b: null },
			signal,
		);
		expect(seen).toEqual([
			["stats.sequences", { scope: { kind: "all" } }],
			["slices.compare", { scope: { kind: "all" }, by: "period", a: "2026-11-05" }],
		]);
		await expect(
			loadSequences(host({ ...sequencesResult(), apiVersion: 6 }), { kind: "all" }, signal),
		).rejects.toBeInstanceOf(VersionSkew);
	});
});
