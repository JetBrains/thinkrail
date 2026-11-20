import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	AlignRow,
	AlignStep,
	SessionAlignment,
	SessionsAlignResult,
} from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES } from "../fixtures.test";
import { PENDING, type Pending, VersionSkew } from "../session/api";
import { type LoadedAlignment, loadAlignment } from "./api";
import { formatOffset, ItemLine, TurnStrip } from "./ComparePanel";
import { alignItems } from "./items";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const noop = () => {};

function done(loaded: LoadedAlignment | Pending | null): LoadedAlignment {
	if (loaded === null || loaded === PENDING) throw new Error("the alignment did not load");
	return loaded;
}

function step(label: string, overrides: Partial<AlignStep> = {}): AlignStep {
	return {
		eventId: `tool:${label}:0`,
		tool: "read",
		activity: "read",
		klass: "file",
		label,
		failed: false,
		turn: 0,
		offset: 65_000,
		...overrides,
	};
}

const STEPS_A = new Map<number, AlignStep>([
	[0, step("src/parser.ts")],
	[1, step("parseLine", { tool: "grep", activity: "search", klass: "search" })],
	[2, step("a1.ts")],
	[3, step("a2.ts")],
	[4, step("a3.ts")],
	[5, step("date", { tool: "bash", activity: "run", klass: "date", turn: 1 })],
]);
const STEPS_B = new Map<number, AlignStep>([
	[0, step("src/parser.ts")],
	[1, step("src/lexer.ts", { failed: true })],
]);

const ROWS: AlignRow[] = [
	{ op: "same", a: 0, b: 0, pair: 0 },
	{ op: "onlyA", a: 1, b: null, pair: 0 },
	{ op: "similar", a: 2, b: 1, pair: 0 },
	{ op: "onlyA", a: 3, b: null, pair: 0 },
	{ op: "onlyA", a: 4, b: null, pair: 0 },
	{ op: "onlyA", a: 5, b: null, pair: null },
];

const ALIGNMENT: SessionAlignment = {
	a: {
		sessionId: "left",
		revision: "r1",
		calls: 6,
		turns: [
			{
				n: 1,
				eventId: "u1",
				trigger: "prompt",
				label: "fix the parser bug",
				calls: 5,
				durationMs: 60_000,
			},
			{ n: 2, eventId: "u2", trigger: "prompt", label: "lunch?", calls: 1, durationMs: 5_000 },
		],
	},
	b: {
		sessionId: "right",
		revision: "r2",
		calls: 2,
		turns: [
			{
				n: 1,
				eventId: "v1",
				trigger: "prompt",
				label: "fix the parser bug quickly",
				calls: 2,
				durationMs: 30_000,
			},
		],
	},
	pairs: [{ a: 0, b: 0, similarity: 0.8, by: "first" }],
	totals: { same: 1, similar: 1, onlyA: 4, onlyB: 0 },
	similarity: 0.5,
	rows: ROWS,
	stepsA: Object.fromEntries(STEPS_A),
	stepsB: Object.fromEntries(STEPS_B),
	cursor: 0,
	next: null,
	totalRows: ROWS.length,
	rules: { pageRows: 1500, turnSimilarity: 0.3, sameObjects: 0.25, commonObjects: 0.3 },
};

const LOADED: LoadedAlignment = {
	alignment: ALIGNMENT,
	rows: ROWS,
	stepsA: STEPS_A,
	stepsB: STEPS_B,
	complete: true,
	newer: false,
};

describe("the two-session diff", () => {
	test("items head each turn block, keep matched and short one-sided runs, and fold none here", () => {
		const items = alignItems(ALIGNMENT, ROWS, STEPS_A, STEPS_B, {
			differences: false,
			open: new Set(),
		});
		expect(items.map((item) => (item.kind === "row" ? item.row.op : item.kind))).toEqual([
			"turn",
			"same",
			"onlyA",
			"similar",
			"onlyA",
			"onlyA",
			"turn",
			"onlyA",
		]);
		const differences = alignItems(ALIGNMENT, ROWS, STEPS_A, STEPS_B, {
			differences: true,
			open: new Set(),
		});
		expect(differences.some((item) => item.kind === "row" && item.row.op === "same")).toBe(false);
	});

	test("three plain one-sided steps fold until opened", () => {
		const rows: AlignRow[] = [
			{ op: "onlyA", a: 2, b: null, pair: 0 },
			{ op: "onlyA", a: 3, b: null, pair: 0 },
			{ op: "onlyA", a: 4, b: null, pair: 0 },
		];
		const folded = alignItems(ALIGNMENT, rows, STEPS_A, STEPS_B, {
			differences: false,
			open: new Set(),
		});
		expect(folded.map((item) => item.kind)).toEqual(["turn", "fold"]);
		const fold = folded[1];
		if (!fold) throw new Error("no fold");
		const opened = alignItems(ALIGNMENT, rows, STEPS_A, STEPS_B, {
			differences: false,
			open: new Set([fold.key]),
		});
		expect(opened.map((item) => item.kind)).toEqual(["turn", "row", "row", "row"]);
		const markup = html(<ItemLine item={fold} loaded={LOADED} onOpen={noop} onUnfold={noop} />);
		expect(markup).toContain('data-testid="align-fold"');
		expect(markup).toContain("3 more steps only in A: file ×3");
	});

	test("rows draw both columns with = and ≈ connectors and tint one-sided steps", () => {
		const items = alignItems(ALIGNMENT, ROWS, STEPS_A, STEPS_B, {
			differences: false,
			open: new Set(),
		});
		const markup = items
			.map((item) => html(<ItemLine item={item} loaded={LOADED} onOpen={noop} onUnfold={noop} />))
			.join("");
		expect(markup).toMatch(/data-testid="align-connector" data-op="same"[\s\S]*?>=</);
		expect(markup).toMatch(/data-testid="align-connector" data-op="similar"[\s\S]*?>≈</);
		expect(markup.match(/data-testid="align-row" data-op="onlyA"/g)).toHaveLength(4);
		expect(markup).toContain(
			'data-testid="align-step-b" data-event-id="tool:src/lexer.ts:0" data-failed="true"',
		);
		expect(markup).toContain("#1 · fix the parser bug");
		expect(markup).toContain("+1:05");
		expect(markup.match(/data-testid="align-turn-header" data-paired="true"/g)).toHaveLength(1);
		expect(markup.match(/data-testid="align-turn-header" data-paired="false"/g)).toHaveLength(1);
	});

	test("the turn strip draws both sessions' turns and the pairs between them", () => {
		const markup = html(<TurnStrip alignment={ALIGNMENT} />);
		expect(markup.match(/data-testid="compare-turn-a"/g)).toHaveLength(2);
		expect(markup.match(/data-testid="compare-turn-b"/g)).toHaveLength(1);
		expect(markup.match(/data-testid="compare-turn-pair"/g)).toHaveLength(1);
		expect(markup).toContain("first turns");
		expect(formatOffset(3_725_000)).toBe("+1:02:05");
	});

	test("pages the alignment in and refuses another payload version", async () => {
		const pages: SessionsAlignResult[] = [
			{
				apiVersion: 10,
				found: true,
				pending: false,
				alignment: { ...ALIGNMENT, rows: ROWS.slice(0, 3), next: 3 },
				newerRevision: false,
				sources: SOURCES,
			},
			{
				apiVersion: 10,
				found: true,
				pending: false,
				alignment: { ...ALIGNMENT, rows: ROWS.slice(3), cursor: 3 },
				newerRevision: false,
				sources: SOURCES,
			},
		];
		const seen: unknown[] = [];
		const host = (answer: (params: unknown) => unknown): PanelHost => ({
			query: async (method, params) => {
				seen.push([method, params]);
				return answer(params);
			},
			openChat: noop,
			openPanel: noop,
			renderToolCall: () => null,
			renderChat: () => null,
			openView: () => {},
			openFile: noop,
			openWorkspace: () => {},
			peek: () => {},
			onEvent: () => () => {},
			scope: { workspaceId: "w1", projectId: "p1" },
			hostProtocol: 128,
			hostApiVersion: 10,
		});
		const signal = new AbortController().signal;
		const progress: number[] = [];
		const loaded = done(
			await loadAlignment(
				host((params) => pages[(params as { cursor: number }).cursor === 0 ? 0 : 1]),
				"left",
				"right",
				signal,
				(partial) => progress.push(partial.rows.length),
			),
		);
		expect(progress).toEqual([3, 6]);
		expect(loaded?.complete).toBe(true);
		expect(loaded?.newer).toBe(false);
		const revisions = { a: ALIGNMENT.a.revision, b: ALIGNMENT.b.revision };
		expect(seen).toEqual([
			["sessions.align", { a: "left", b: "right", cursor: 0 }],
			["sessions.align", { a: "left", b: "right", cursor: 3, revisions }],
		]);
		const live = done(
			await loadAlignment(
				host((params) => {
					const at = (params as { cursor: number }).cursor === 0 ? 0 : 1;
					return { ...pages[at], newerRevision: at === 1 };
				}),
				"left",
				"right",
				signal,
				noop,
			),
		);
		expect(live?.rows).toHaveLength(6);
		expect(live?.newer).toBe(true);
		expect(
			await loadAlignment(
				host(() => ({ apiVersion: 10, found: false, alignment: null, sources: SOURCES })),
				"a",
				"b",
				signal,
				noop,
			),
		).toBeNull();
		expect(
			await loadAlignment(
				host(() => ({
					apiVersion: 10,
					found: false,
					pending: true,
					alignment: null,
					sources: SOURCES,
				})),
				"a",
				"b",
				signal,
				noop,
			),
		).toBe(PENDING);
		await expect(
			loadAlignment(
				host(() => ({ apiVersion: 6 })),
				"a",
				"b",
				signal,
				noop,
			),
		).rejects.toBeInstanceOf(VersionSkew);
	});
});
