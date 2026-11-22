import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	Finding,
	FindingsListResult,
	HotspotFile,
	SessionRef,
	StatsHotspotsResult,
	StatsUsageResult,
	UsageSeries,
	UsageToolRow,
} from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listResult, SOURCES, sessionRow } from "../fixtures.test";
import {
	onSessionFocus,
	pendingSessionFocus,
	requestSessionFocus,
	settleSessionFocus,
} from "../focus";
import { SessionsView } from "../SessionsPanel";
import { VersionSkew } from "../session/api";
import { DEFAULT_STATS_VIEW } from "../viewState";
import { hideFinding, loadFindings, loadHotspots, loadUsage, stillReading } from "./api";
import { FindingsBadge } from "./FindingsBadge";
import { FindingsView } from "./FindingsView";
import { HeatTree, heatTree } from "./HeatTree";
import { HotspotDetail, HotspotsView } from "./HotspotsView";
import { StatsView } from "./StatsView";
import { UsageView } from "./UsageView";
import { type FindingsControls, tallyFindings } from "./useFindings";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const noop = () => {};
const counted = (value: number) => ({ value, origin: "counted" as const });
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
		title: null,
		firstPrompt: "ship the release",
		start: Date.UTC(2026, 10, 2, 9),
		projectId: "p1",
		workspaceId: "w1",
		workspaceState: "open",
	},
];

function finding(overrides: Partial<Finding>): Finding {
	return {
		id: "x",
		rule: "commandFailing",
		group: "commands",
		severity: "error",
		heuristic: false,
		hidden: false,
		subject: null,
		count: 0,
		total: null,
		rate: null,
		figures: {},
		ratio: null,
		names: [],
		shares: [],
		quote: null,
		worked: null,
		links: [],
		sessions: [],
		last: null,
		...overrides,
	};
}

const RULES: FindingsListResult["rules"] = {
	failingFailures: 3,
	failingShare: 0.08,
	failingSessions: 2,
	failingShown: 4,
	failingStrong: 0.3,
	toolCards: 3,
	falseErrors: 2,
	loopCalls: 3,
	loops: 2,
	recoveryChains: 5,
	recoverySessions: 2,
	recoveryShare: 0.5,
	oversizedChars: 50_000,
	oversizedCalls: 3,
	cacheMisses: 5,
	outlierFactor: 3,
	outlierSessions: 5,
	outsideCost: 0.005,
	reworkFiles: 3,
	reworkChanges: 5,
	repeatWords: 6,
	repeatSimilarity: 0.6,
	repeatSessions: 3,
	repeatFindings: 3,
	unverifiedClaims: 2,
};

function findingsResult(findings: Finding[]): FindingsListResult {
	return {
		apiVersion: 11,
		state: STATE,
		digests: { ready: 2, total: 2, stale: 0 },
		sessions: SESSIONS,
		findings,
		rules: RULES,
		exits: [{ head: "gh pr checks", exit: "8", meaning: "checksPending" }],
		sources: SOURCES,
	};
}

describe("findings", () => {
	const failing = finding({
		id: "command:gh pr checks",
		subject: "gh pr checks",
		count: 4,
		total: 20,
		rate: { k: 4, n: 20, low: 0.08, high: 0.42 },
		shares: [
			{ key: "8", count: 3 },
			{ key: "1", count: 1 },
		],
		quote: { text: "checks pending", count: 3 },
		worked: {
			session: 0,
			failedEvent: "tool:a:0",
			workedEvent: "tool:b:0",
			segments: [
				{ op: "same", text: "gh pr checks 12" },
				{ op: "added", text: " --watch" },
			],
		},
		links: [{ session: 0, count: 3, events: ["tool:a:0"] }],
		sessions: [0, 1],
	});
	const never = finding({
		id: "skills:never",
		rule: "skillNeverLoaded",
		group: "skills",
		severity: "warning",
		count: 2,
		total: 2,
		names: ["deploy", "review"],
		figures: { perRequest: { value: 120, origin: "approximated" } },
		sessions: [0, 1],
	});
	const hidden = finding({
		id: "claims:unverified",
		rule: "unverifiedClaim",
		group: "files",
		severity: "info",
		heuristic: true,
		hidden: true,
		count: 2,
		sessions: [1],
	});

	test("cards show the fact, the Wilson interval, the quoted line, what worked and the known exit", () => {
		const markup = html(
			<FindingsView
				result={findingsResult([never, failing, hidden])}
				onShowSessions={noop}
				onOpenSession={noop}
				onHide={noop}
			/>,
		);
		expect(markup).toContain("2 skills were never loaded");
		expect(markup).toContain('data-testid="finding-name"');
		expect(markup).toContain("about 120 tokens with every request");
		expect(markup).toContain("“gh pr checks” fails systematically");
		expect(markup).toContain(
			"Failed in 4 of 20 runs (20%, 95% Wilson interval 8%–42%) in 2 sessions",
		);
		expect(markup).toContain("Exit codes: exit 8 ×3, exit 1 ×1.");
		expect(markup).toContain("Exit 8 of gh pr checks means checks are still pending (3 of 4)");
		expect(markup).toContain('data-testid="finding-rate"');
		expect(markup).toContain("rule threshold 8%");
		expect(markup).toContain("checks pending");
		expect(markup).toContain("in 3 of 4 failures");
		expect(markup).toContain('data-op="added"');
		expect(markup).toContain("Fix the parser ×3");
		expect(markup).toContain("Nothing is applied automatically.");
		expect(markup).not.toContain("Done without verification");
		expect(markup).toContain("Hidden: 1");
		expect(markup.indexOf('data-group="skills"')).toBeLessThan(
			markup.indexOf('data-group="commands"'),
		);
	});

	test("the Insights badge counts the findings not hidden, in the most severe colour, with a summary", () => {
		const result = findingsResult([never, failing, hidden, finding({ id: "i", severity: "info" })]);
		const tally = tallyFindings(result);
		expect(tally).toEqual({ error: 1, warning: 1, info: 1, total: 3 });
		const badge = html(<FindingsBadge tally={tally} testId="badge" tooltip />);
		expect(badge).toContain('data-testid="badge" data-severity="error"');
		expect(badge).toContain('<span aria-hidden="true">3</span>');
		expect(badge).toContain("3 findings · 1 error, 1 warning, 1 info");
		const warnings = tallyFindings(findingsResult([never, { ...failing, severity: "info" }]));
		expect(html(<FindingsBadge tally={warnings} testId="badge" />)).toContain(
			'data-severity="warning"',
		);
		expect(
			html(<FindingsBadge tally={tallyFindings(findingsResult([never]))} testId="badge" />),
		).toContain("1 finding · 1 warning");
		expect(
			html(<FindingsBadge tally={tallyFindings(findingsResult([hidden]))} testId="badge" />),
		).toBe("");
	});

	test("Insights opens on What to do; its sections are tabs and What to do reads the panel's findings", () => {
		const findings: FindingsControls = {
			polled: { view: { kind: "ready", value: findingsResult([never, failing]) }, busy: false },
			onHide: noop,
			retry: noop,
		};
		const host: PanelHost = {
			query: () => new Promise(() => {}),
			openChat: noop,
			openPanel: noop,
			renderToolCall: () => null,
			openFile: noop,
			scope: { workspaceId: "w1", projectId: "p1" },
			hostProtocol: 130,
			hostApiVersion: 11,
		};
		const markup = html(
			<StatsView
				host={host}
				scopeKind="project"
				attempt={0}
				actions={{ onShowSessions: noop, onOpenSession: noop, onOpenFile: noop }}
				findings={findings}
				view={DEFAULT_STATS_VIEW}
				onView={noop}
			/>,
		);
		expect(markup).toContain('role="tablist" aria-label="Insights sections"');
		const tabs = [
			...markup.matchAll(
				/role="tab"[^>]*aria-selected="(true|false)"[^>]*data-testid="stats-section-([a-z]+)"/g,
			),
		].map((match) => `${match[2]}:${match[1]}`);
		expect(tabs).toEqual([
			"findings:true",
			"usage:false",
			"hotspots:false",
			"sequences:false",
			"ab:false",
		]);
		expect(markup).toContain(">A/B<");
		expect(markup).toContain('data-testid="stats-findings-badge" data-severity="error"');
		expect(markup).toContain('data-testid="findings-view"');
		expect(markup).toContain("2 skills were never loaded");
		expect(markup.match(/role="tabpanel"/g)).toHaveLength(1);
	});

	test("an empty scope says no rule fired", () => {
		const markup = html(
			<FindingsView
				result={findingsResult([])}
				onShowSessions={noop}
				onOpenSession={noop}
				onHide={noop}
			/>,
		);
		expect(markup).toContain('data-testid="findings-empty"');
	});
});

function series(overrides: Partial<UsageSeries>): UsageSeries {
	return {
		key: "m",
		kind: "model",
		name: null,
		tokens: [10, 0, 30],
		cost: [1, 0, 3],
		totalTokens: 40,
		totalCost: 4,
		costOrigin: "recorded",
		...overrides,
	};
}

function toolRow(name: string): UsageToolRow {
	return {
		name,
		family: "execution",
		calls: counted(10),
		errors: counted(2),
		notRun: 0,
		errorRate: { k: 2, n: 10, low: 0.05, high: 0.5 },
		sessions: [0, 1],
		durationAvg: { value: 1500, origin: "recorded" },
		durationP50: { value: 1200, origin: "recorded" },
		measured: 8,
		last: Date.UTC(2026, 10, 3),
		perDay: [1, 0, 9],
	};
}

function usageResult(): StatsUsageResult {
	const bridge = series({
		key: "claude-bridge/opus",
		tokens: [0, 0, 500],
		cost: [0, 0, 0],
		totalTokens: 500,
		totalCost: 0,
		costOrigin: "notRecorded",
	});
	const claude = series({ key: "anthropic/claude" });
	return {
		apiVersion: 11,
		state: STATE,
		digests: { ready: 2, total: 2, stale: 0 },
		sessions: SESSIONS,
		sources: SOURCES,
		usage: {
			days: ["2026-11-01", "2026-11-02", "2026-11-03"],
			sparkDays: 1,
			headline: "cost",
			byModel: [bridge, claude],
			byProject: [series({ key: "p1", kind: "project", name: "Alpha" })],
			outside: series({ key: "outside", kind: "outside", tokens: [0, 0, 5], cost: [0, 0, 0.5] }),
			markers: [{ day: "2026-11-03", kind: "unpricedModel", model: "claude-bridge/opus" }],
			totals: {
				tokens: {
					value: { input: 500, output: 20, cacheRead: 20, cacheWrite: 0, total: 540 },
					origin: "recorded",
				},
				cost: { value: 4, origin: "partiallyRecorded" },
				outside: { value: { cost: 0.5, tokens: 5 }, origin: "recorded" },
			},
			models: [
				{
					model: "anthropic/claude",
					calls: counted(4),
					errors: counted(1),
					errorRate: { k: 1, n: 4, low: 0.05, high: 0.7 },
					tokens: {
						value: { input: 20, output: 10, cacheRead: 10, cacheWrite: 0, total: 40 },
						origin: "recorded",
					},
					cost: { value: 4, origin: "recorded" },
					cacheShare: { value: 1 / 3, origin: "counted" },
					latencyP50: { value: 2000, origin: "recorded" },
					measured: 4,
					contextWindow: { value: 200_000, origin: "host" },
					sessions: [0, 1],
					perDay: [10, 0, 30],
				},
			],
			projects: [],
			tools: [toolRow("bash")],
			commands: [toolRow("bun test")],
			skills: [],
			roles: [],
			listingSessions: 1,
		},
	};
}

describe("usage", () => {
	test("the per-day chart stacks the series with the markers, and the models table lists the rows", () => {
		const markup = html(<UsageView result={usageResult()} onShowSessions={noop} />);
		expect(markup).toContain('data-testid="usage-chart" data-days="3"');
		expect(markup.match(/data-testid="usage-series"/g)).toHaveLength(2);
		expect(markup).toContain('data-testid="usage-outside"');
		expect(markup).toContain("from Nov 3 claude-bridge/opus records $0");
		expect(markup).toContain("$0 · not recorded · 500 tokens");
		expect(markup).toContain("+$0.50 subagents outside pi&#x27;s total");
		expect(markup).toContain('data-testid="usage-table-models"');
		expect(markup).toContain('data-name="anthropic/claude"');
		expect(markup).toContain("200K");
	});

	test("with nothing spent the chart says so", () => {
		const result = usageResult();
		const markup = html(
			<UsageView
				result={{ ...result, usage: { ...result.usage, days: [], byModel: [] } }}
				onShowSessions={noop}
			/>,
		);
		expect(markup).toContain('data-testid="usage-empty"');
	});
});

function hotspot(path: string, overrides: Partial<HotspotFile> = {}): HotspotFile {
	return {
		projectId: "p1",
		path,
		touches: counted(12),
		reads: 2,
		edits: 10,
		writes: 0,
		failed: 1,
		added: 30,
		removed: 4,
		sessions: [0],
		changedSessions: 1,
		rework: 10,
		reworkSession: 0,
		reworkSessions: 1,
		action: "split",
		workspaceId: "w1",
		...overrides,
	};
}

function hotspotsResult(): StatsHotspotsResult {
	const files = [
		hotspot("src/parser/index.ts"),
		hotspot("README.md", {
			touches: counted(8),
			reads: 8,
			edits: 0,
			rework: 0,
			reworkSession: null,
			reworkSessions: 0,
			action: "upfront",
			workspaceId: null,
			added: 0,
			removed: 0,
			sessions: [0, 1],
		}),
	];
	return {
		apiVersion: 11,
		state: STATE,
		digests: { ready: 2, total: 2, stale: 0 },
		sessions: SESSIONS,
		sources: SOURCES,
		hotspots: {
			sort: "touches",
			projects: [{ id: "p1", name: "Alpha", kind: "repository" }],
			files,
			dirs: [
				{
					projectId: "p1",
					path: "",
					touches: 20,
					reads: 10,
					edits: 10,
					writes: 0,
					failed: 1,
					added: 30,
					removed: 4,
					files: 2,
					rework: 1,
				},
				{
					projectId: "p1",
					path: "src",
					touches: 12,
					reads: 2,
					edits: 10,
					writes: 0,
					failed: 1,
					added: 30,
					removed: 4,
					files: 1,
					rework: 1,
				},
				{
					projectId: "p1",
					path: "src/parser",
					touches: 12,
					reads: 2,
					edits: 10,
					writes: 0,
					failed: 1,
					added: 30,
					removed: 4,
					files: 1,
					rework: 1,
				},
			],
			totalFiles: 2,
			touches: 20,
			outside: 3,
			nodeModules: 1,
			actions: {
				spec: 0,
				test: 0,
				plan: 0,
				template: 0,
				split: 1,
				hub: 0,
				upfront: 1,
				review: 0,
				none: 0,
			},
			rules: {
				specSessions: 3,
				templateSessions: 3,
				splitChanges: 10,
				hubSessions: 3,
				readShare: 0.7,
				readSessions: 4,
			},
			reworkChanges: 5,
		},
	};
}

describe("hotspots", () => {
	test("the ranked list gives each file one action and the rules are written below", () => {
		const markup = html(
			<HotspotsView
				result={hotspotsResult()}
				sort="touches"
				onSort={noop}
				view="list"
				onView={noop}
				onShowSessions={noop}
				onOpenSession={noop}
				onOpenFile={noop}
			/>,
		);
		expect(markup).toContain(
			'data-path="src/parser/index.ts" data-action="split" data-rework="true"',
		);
		expect(markup).toContain("Split the task");
		expect(markup).toContain("10 changes in one session");
		expect(markup).toContain("8 of 8 touches are reads, in 2 sessions");
		expect(markup).toContain(
			"3 touches outside the workspace and 1 under node_modules are not shown",
		);
	});

	test("the why names the rework session and the rule; a file without an open workspace cannot open", () => {
		const result = hotspotsResult();
		const [split, readme] = result.hotspots.files;
		if (!split || !readme) throw new Error("no files");
		const markup = html(
			<HotspotDetail
				file={split}
				result={result}
				onShowSessions={noop}
				onOpenSession={noop}
				onOpenFile={noop}
			/>,
		);
		expect(markup).toContain("10 edits, 0 writes and 2 reads in 1 session.");
		expect(markup).toContain("10 changes in one session, “Fix the parser”");
		expect(markup).toContain("More changes than reads");
		expect(markup).toContain("Rule: 10 or more changes in one session → split the task.");
		const closed = html(
			<HotspotDetail
				file={readme}
				result={result}
				onShowSessions={noop}
				onOpenSession={noop}
				onOpenFile={noop}
			/>,
		);
		expect(closed).toMatch(/data-testid="hotspot-open-file"[^>]*disabled=""/);
	});

	test("the heat tree nests files under folders, compacts single-folder runs and badges rework", () => {
		const result = hotspotsResult();
		const [root] = heatTree(result);
		expect(root?.children.map((node) => [node.kind, node.path])).toEqual([
			["dir", "src"],
			["file", "README.md"],
		]);
		const markup = html(
			<HeatTree
				result={result}
				projectNames={new Map([["p1", "Alpha"]])}
				selected={null}
				onSelect={noop}
				detail={() => null}
			/>,
		);
		expect(markup).toContain('data-path="src/parser"');
		expect(markup).toContain(">src/parser<");
		expect(markup).toContain('data-testid="heat-rework"');
		expect(markup).toContain("⟳10");
		expect(markup).toContain("+30");
	});
});

describe("the list with a filter", () => {
	test("Show sessions narrows the table to the picked sessions and names the filter", () => {
		const result = listResult([sessionRow("s1"), sessionRow("s2"), sessionRow("s3")]);
		const markup = html(
			<SessionsView
				view={{ kind: "ready", result, receivedAt: Date.UTC(2026, 10, 16) }}
				scopeKind="project"
				busy={false}
				onScope={noop}
				onRefresh={noop}
				onOpen={noop}
				onAnalyse={noop}
				filter={{ label: "bun test", ids: new Set(["s1", "s3"]) }}
				onClearFilter={noop}
			/>,
		);
		expect(markup).toContain("bun test · 2 sessions");
		expect(markup.match(/data-testid="session-insights-row"/g)).toHaveLength(2);
		expect(markup).toContain('data-testid="session-insights-count">2 sessions');
	});
});

describe("statistics queries", () => {
	const host = (answer: unknown, seen: unknown[] = []): PanelHost => ({
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
		hostApiVersion: 11,
	});
	const signal = new AbortController().signal;

	test("send the scope and options and refuse another payload version", async () => {
		const seen: unknown[] = [];
		const usage = usageResult();
		expect(await loadUsage(host(usage, seen), { kind: "all" }, signal)).toBe(usage);
		await loadHotspots(host(hotspotsResult(), seen), { kind: "all" }, "changes", signal);
		expect(seen).toEqual([
			["stats.usage", { scope: { kind: "all" } }],
			["stats.hotspots", { scope: { kind: "all" }, sort: "changes" }],
		]);
		await expect(
			loadFindings(host({ ...findingsResult([]), apiVersion: 5 }), { kind: "all" }, signal),
		).rejects.toBeInstanceOf(VersionSkew);
		expect(await hideFinding(host({ apiVersion: 11, hidden: ["a"] }), "a", true, signal)).toEqual([
			"a",
		]);
		expect(stillReading({ state: STATE, digests: { ready: 1, total: 2, stale: 0 } })).toBe(true);
		expect(stillReading({ state: STATE, digests: { ready: 2, total: 2, stale: 0 } })).toBe(false);
		expect(stillReading({ state: STATE, digests: { ready: 2, total: 2, stale: 1 } })).toBe(false);
	});

	test("a jump to a call reaches the session's open analysis once", () => {
		const heard: string[] = [];
		const stop = onSessionFocus((sessionId) => heard.push(sessionId));
		requestSessionFocus("s1", "tool:a:0");
		expect(heard).toEqual(["s1"]);
		expect(pendingSessionFocus("s1")).toBe("tool:a:0");
		settleSessionFocus("s1", "tool:a:0");
		expect(pendingSessionFocus("s1")).toBeNull();
		stop();
		requestSessionFocus("s2", "x");
		expect(heard).toEqual(["s1"]);
		settleSessionFocus("s2", "x");
	});
});
