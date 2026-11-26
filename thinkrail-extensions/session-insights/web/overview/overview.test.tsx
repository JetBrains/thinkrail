import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	CostDiagnosis,
	Figure,
	SessionOverviewCards,
	SessionOverviewResult,
} from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES } from "../fixtures.test";
import { PENDING, VersionSkew } from "../session/api";
import SessionPanel from "../session/SessionPanel";
import {
	answeredRevision,
	loadSessionOverview,
	overviewPending,
	readsOtherRevision,
	SESSION_OVERVIEW,
} from "./api";
import { CardLink } from "./cards";
import { OverviewBody, OverviewCards, type OverviewLink } from "./OverviewView";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const text = (markup: string) =>
	markup
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&#x27;/g, "'")
		.replace(/\s+/g, " ");
const noop = () => {};
const counted = (value: number | null): Figure => ({ value, origin: "counted" });
const T0 = Date.parse("2026-11-19T20:10:16.000Z");

const DIAGNOSIS: CostDiagnosis = {
	kind: "spread",
	calls: 19,
	averageContext: 38_100,
	peakContext: 46_800,
	cacheReadShare: 0.96,
	medianCall: 0.01,
	focus: null,
	compaction: null,
	highContext: { calls: 0, value: 0, models: [] },
	rewrites: null,
};

function cards(overrides: Partial<SessionOverviewCards> = {}): SessionOverviewCards {
	return {
		revision: "r1",
		happened: {
			outcome: "succeeded",
			turns: counted(1),
			llmCalls: counted(19),
			toolCalls: counted(35),
			toolFailures: counted(1),
			recovered: counted(1),
			userWait: { value: 0, origin: "approximated" },
			start: counted(T0),
			end: counted(T0 + 98_000),
			span: counted(98_000),
			activity: {
				t0: T0,
				t1: T0 + 98_000,
				families: ["writing"],
				ticks: [
					[0, 1000, -1, 0],
					[2000, 500, 0, 1],
				],
				llmCalls: 19,
				toolCalls: 35,
				errors: 1,
				model: "anthropic/claude-sonnet-5-5",
			},
			plan: {
				steps: [
					{
						id: "t_1",
						n: 1,
						title: "Add pure streak logic",
						status: "done",
						errors: counted(0),
						cost: { value: 0.02, origin: "recorded" },
						tokens: { value: 1000, origin: "recorded" },
						events: ["tool:a1:0"],
					},
					{
						id: "t_2",
						n: 2,
						title: "Add the streak command",
						status: "done",
						errors: counted(1),
						cost: { value: 0.09, origin: "recorded" },
						tokens: { value: 4000, origin: "recorded" },
						events: [],
					},
				],
				more: 0,
				done: counted(2),
				total: counted(2),
			},
			skills: ["choosing-a-workflow", "brainstorming"],
		},
		cost: {
			headline: "cost",
			total: { value: 0.27, origin: "recorded" },
			diagnosis: DIAGNOSIS,
			cacheShare: counted(0.96),
			rewrites: { value: 0, origin: "approximated" },
			compactions: counted(0),
			highContext: counted(0),
			calls: counted(19),
			bars: [0.01, 0.02, 0.05],
			perBar: 1,
		},
		errors: {
			failures: counted(1),
			recovered: counted(1),
			recoveredIn: { value: 9_100, origin: "counted" },
			chains: 1,
			chain: {
				index: 0,
				kind: "tool",
				outcome: "recovered",
				attempts: [
					{ eventId: "tool:a1:0", name: "edit", label: "src/stats.py", failed: true },
					{ eventId: "tool:a3:0", name: "edit", label: "src/stats.py", failed: false },
				],
				between: [1],
				line: "Edit tool input is invalid.",
				recoveredIn: { value: 9_100, origin: "counted" },
			},
		},
		context: {
			peak: { value: 46_800, origin: "recorded" },
			window: { value: 1_000_000, origin: "host" },
			peakShare: counted(0.0468),
			average: counted(38_100),
			cacheShare: counted(0.96),
			misses: { value: 0, origin: "approximated" },
			compactions: counted(0),
		},
		files: {
			totals: { files: 9, changed: 7, readOnly: 2, rework: 0, failed: 1, added: 340, removed: 13 },
			rows: [
				{
					path: "tests/test_cli.py",
					inside: true,
					added: 118,
					removed: 5,
					failed: false,
					rework: false,
				},
				{
					path: "src/storage.py",
					inside: true,
					added: 13,
					removed: 0,
					failed: true,
					rework: false,
				},
			],
			more: 5,
		},
		subagents: { count: counted(0), overview: null },
		turns: { prompts: counted(1), asks: counted(0) },
		findings: [
			{
				id: "outliers:cost",
				rule: "costOutlier",
				group: "context",
				severity: "info",
				heuristic: false,
				subject: null,
				count: 3,
				total: null,
				ratio: 3.4,
				figures: { median: { value: 0.08, origin: "recorded" } },
				names: [],
				sessions: 3,
				link: { count: 1, events: [], value: 0.27 },
			},
		],
		digests: { ready: 12, total: 12, stale: 0 },
		...overrides,
	};
}

function result(overview: SessionOverviewCards | null = cards()): SessionOverviewResult {
	return { apiVersion: 11, found: overview !== null, pending: false, overview, sources: SOURCES };
}

function links(markup: string): OverviewLink[] {
	return [...markup.matchAll(/data-link="([^"]+)"/g)].map(([, json]) =>
		JSON.parse((json ?? "").replace(/&quot;/g, '"')),
	);
}

function host(answer: unknown, version: number | undefined = 11): PanelHost {
	return {
		query: async () => answer,
		openChat: noop,
		openPanel: noop,
		renderToolCall: () => null,
		openFile: noop,
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion: version,
	};
}

describe("the overview's cards", () => {
	test("state what happened, why it cost what it did and the other cards from the server's figures", () => {
		const markup = html(<OverviewCards result={result()} onOpen={noop} />);
		const words = text(markup);
		expect(markup).toContain('data-revision="r1"');
		expect(words).toContain(
			"Succeeded in 1 turn: 19 model calls, 35 tool calls, 1 failed and recovered. Waited for you: never.",
		);
		expect(words).toContain("Plan · 2 of 2 done");
		expect(markup.match(/data-testid="overview-plan-step"/g)).toHaveLength(2);
		expect(words).toContain("Add the streak command");
		expect(words).toContain("1 failure");
		expect(words).toContain("$0.09");
		expect(words).toContain("choosing-a-workflow");
		expect(words).toContain("Why it cost $0.27");
		expect(words).toContain("No single cause stands out: 19 calls at a median $0.01.");
		expect(words).toContain("A template over measured figures.");
		expect(words).toContain("cache read 96%");
		expect(words).toContain("0 cache rewrites");
		expect(words).toContain("0 compactions");
		expect(words).toContain("0 calls ≥ 80 % of the window");
		expect(words).toContain("$ per call · 19 calls");
		expect(words).toContain(
			"Cost 3.4× the project median ($0.27 against $0.08); outliers in the project: 3.",
		);
		expect(words).toContain("1 failure · 1 recovered in 9.1 s");
		expect(markup.match(/data-testid="overview-attempt"/g)).toHaveLength(2);
		expect(words).toContain("1 call between");
		expect(words).toContain("Edit tool input is invalid.");
		expect(words).toContain("46.8K · 4.7% of the 1M window");
		expect(words).toContain("7 files changed");
		expect(words).toContain("1 failed edit");
		expect(words).toContain("+5 more files");
		expect(words).toContain("None in this session.");
		expect(words).toContain("1 prompt, no waits for you.");
		expect(words).toContain("1 min 38 s");
		expect(markup.match(/data-state="closed"/g)?.length).toBeGreaterThan(15);
	});

	test("lead into their sections", () => {
		const found = links(html(<OverviewCards result={result()} onOpen={noop} />));
		expect(found).toEqual(
			expect.arrayContaining([
				{ to: "trace" },
				{ to: "trace", mode: "timeline" },
				{ to: "trace", events: ["tool:a1:0"] },
				{ to: "cost", view: "cost" },
				{ to: "findings" },
				{ to: "errors" },
				{ to: "errors", chain: 0 },
				{ to: "cost", view: "context" },
				{ to: "files" },
				{ to: "files", path: "tests/test_cli.py" },
				{ to: "files", path: "src/storage.py" },
				{ to: "subagents" },
				{ to: "trace", mode: "turns" },
			]),
		);
		expect(found.filter((link) => link.to === "trace" && "events" in link)).toHaveLength(1);
	});

	test("a retry that never ran reads as no result, never as a success", () => {
		const base = cards();
		const stopped = base.errors?.chain
			? cards({
					errors: {
						...base.errors,
						chain: {
							...base.errors.chain,
							outcome: "unfinished",
							attempts: [
								{ eventId: "tool:a1:0", name: "bash", label: "bun test", failed: true },
								{
									eventId: "tool:a3:0",
									name: "bash",
									label: "bun test --bail",
									failed: false,
									missing: true,
								},
							],
						},
					},
				})
			: base;
		const markup = html(<OverviewCards result={result(stopped)} onOpen={noop} />);
		expect(markup).toMatch(
			/data-testid="overview-attempt"[^>]*data-missing="true"[^>]*>#2 bash<span>no result/,
		);
		expect(markup.match(/data-missing="true"/g)).toHaveLength(1);
	});

	test("a link calls onOpen with its target", () => {
		const opened: OverviewLink[] = [];
		const link: OverviewLink = { to: "errors", chain: 3 };
		const element = CardLink({
			link,
			onOpen: (target) => opened.push(target),
			testId: "x",
			children: null,
		});
		element.props.onClick();
		expect(opened).toEqual([link]);
	});

	test("empty states: no failures, plan, files or skills; counting findings; subagents when there are", () => {
		const quiet = cards({
			errors: null,
			files: {
				totals: { files: 0, changed: 0, readOnly: 0, rework: 0, failed: 0, added: 0, removed: 0 },
				rows: [],
				more: 0,
			},
			findings: null,
			digests: { ready: 3, total: 12, stale: 0 },
			subagents: {
				count: counted(2),
				overview: {
					roles: [{ role: "scout", n: 2 }],
					maxParallel: 2,
					tokens: { value: 900, origin: "recorded" },
					cost: { value: 0.4, origin: "recorded" },
					failed: 0,
					withErrors: 0,
					unmeasured: 0,
				},
			},
			turns: { prompts: counted(3), asks: counted(2) },
		});
		quiet.happened = { ...quiet.happened, plan: null, skills: [], outcome: null };
		const words = text(html(<OverviewCards result={result(quiet)} onOpen={noop} />));
		expect(words).toContain("In 1 turn:");
		expect(words).not.toContain("Plan ·");
		expect(words).not.toContain("Skills loaded");
		expect(words).toContain("No failures in this session.");
		expect(words).toContain("No file was changed.");
		expect(words).toContain("Still counting the project's sessions: 3 of 12.");
		expect(words).toContain("2 subagents, up to 2 at once · $0.40");
		expect(words).toContain("scout ×2");
		expect(words).toContain("3 prompts, waited for you 2 times.");
		const none = text(
			html(<OverviewCards result={result(cards({ findings: [] }))} onOpen={noop} />),
		);
		expect(none).toContain("Nothing stands out against the project's other sessions.");
	});

	test("a long session's bars say how many calls each one folds", () => {
		const long = cards();
		long.cost = { ...long.cost, calls: counted(250), perBar: 3 };
		expect(text(html(<OverviewCards result={result(long)} onOpen={noop} />))).toContain(
			"each bar: the costliest of 3 calls",
		);
	});
});

describe("the overview's states", () => {
	test("loading, pending, version skew, failure with a retry, and a session the host lacks", () => {
		const body = (query: Parameters<typeof OverviewBody>[0]["query"]) =>
			html(<OverviewBody query={query} onRetry={noop} onOpen={noop} />);
		expect(body({ kind: "loading" })).toContain("session-insights-overview-loading");
		expect(body({ kind: "ready", value: PENDING })).toContain("session-insights-overview-loading");
		expect(body({ kind: "version" })).toContain("session-insights-update-host");
		const failed = body({ kind: "failed" });
		expect(failed).toContain("session-insights-overview-error");
		expect(text(failed)).toContain("Retry");
		expect(body({ kind: "ready", value: null })).toContain("session-insights-overview-missing");
		expect(body({ kind: "ready", value: result() })).toContain("session-insights-overview");
	});

	test("a host serving another payload version shows the update notice instead of the overview", () => {
		const panel = (version: number) =>
			html(<SessionPanel host={host(result(), version)} params={{ sessionId: "s1" }} />);
		expect(panel(10)).toContain("session-insights-update-host");
		expect(panel(10)).not.toContain("session-insights-overview-loading");
		expect(panel(11)).toContain("session-insights-overview-loading");
	});

	test("the load maps pending and missing sessions and rejects another payload version", async () => {
		const signal = new AbortController().signal;
		const asked: unknown[] = [];
		const answering = (answer: unknown): PanelHost => ({
			...host(answer),
			query: async (method, params) => {
				asked.push([method, params]);
				return answer;
			},
		});
		expect(await loadSessionOverview(answering(result()), "s1", signal)).toEqual(result());
		expect(asked).toEqual([[SESSION_OVERVIEW, { sessionId: "s1" }]]);
		expect(
			await loadSessionOverview(answering({ ...result(null), pending: true }), "s1", signal),
		).toBe(PENDING);
		expect(await loadSessionOverview(answering(result(null)), "s1", signal)).toBeNull();
		await expect(
			loadSessionOverview(answering({ ...result(), apiVersion: 10 }), "s1", signal),
		).rejects.toBeInstanceOf(VersionSkew);
	});

	test("a poll asks for the revision its last answer's cards read", async () => {
		expect(answeredRevision(undefined)).toBeUndefined();
		expect(answeredRevision(PENDING)).toBeUndefined();
		expect(answeredRevision(null)).toBeUndefined();
		expect(answeredRevision(result(cards({ findings: null })))).toBe("r1");
		const asked: unknown[] = [];
		const polled: PanelHost = {
			...host(null),
			query: async (method, params) => {
				asked.push([method, params]);
				return result();
			},
		};
		const signal = new AbortController().signal;
		await loadSessionOverview(polled, "s1", signal, answeredRevision(undefined));
		await loadSessionOverview(polled, "s1", signal, answeredRevision(result()));
		expect(asked).toEqual([
			[SESSION_OVERVIEW, { sessionId: "s1" }],
			[SESSION_OVERVIEW, { sessionId: "s1", revision: "r1" }],
		]);
	});

	test("the cards read another revision than the trace only once both are known and differ", () => {
		expect(readsOtherRevision({ kind: "ready", value: result() }, "r1")).toBe(false);
		expect(readsOtherRevision({ kind: "ready", value: result() }, "r2")).toBe(true);
		expect(readsOtherRevision({ kind: "ready", value: result() }, null)).toBe(false);
		expect(readsOtherRevision({ kind: "ready", value: PENDING }, "r2")).toBe(false);
		expect(readsOtherRevision({ kind: "ready", value: null }, "r2")).toBe(false);
		expect(readsOtherRevision({ kind: "loading" }, "r2")).toBe(false);
	});

	test("it is asked again while pending or while the findings are still counted", () => {
		expect(overviewPending(PENDING)).toBe(true);
		expect(overviewPending(null)).toBe(false);
		expect(overviewPending(result())).toBe(false);
		expect(overviewPending(result(cards({ findings: null })))).toBe(true);
	});
});
