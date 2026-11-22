import { describe, expect, test } from "bun:test";
import type { PanelChatAnchor, PanelHost } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { currentTranslator } from "@thinkrail/locales/react";
import type { SessionOverview } from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailsContext, type DetailsHost } from "../details/context";
import { DetailsPanel } from "../details/DetailsPanel";
import { figure, SOURCES, START, sessionRow, tokenTotals } from "../fixtures.test";
import { requestSessionFocus, settleSessionFocus } from "../focus";
import { pendingListView, settleListView } from "../listIntent";
import type { OverviewLink } from "../overview/OverviewView";
import { sampleEvents } from "../trace/events.test";
import { TraceModel } from "../trace/model";
import { TraceExplorer } from "../trace/TraceExplorer";
import { compareWith, pickerRows, pickerStep } from "./ComparePicker";
import { Header, headerFigures, headerLayout, paneActions } from "./Header";
import { initialNavigation, moved, openFindings, routeOverviewLink } from "./navigation";
import SessionPanel, { CostContextSection, ModeSwitch, showEventInChat } from "./SessionPanel";
import {
	INITIAL_VIEW,
	MAX_FOLDS,
	parseViewState,
	type SessionViewState,
	ViewMemory,
} from "./viewState";

const t = currentTranslator();
const noop = () => {};
const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

function host(overrides: Partial<PanelHost> = {}, seen: unknown[] = []): PanelHost {
	return {
		query: async (method, params) => {
			seen.push([method, params]);
			return new Promise(() => {});
		},
		openChat: noop,
		openPanel: noop,
		renderToolCall: () => null,
		openFile: noop,
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion: 11,
		...overrides,
	};
}

const LONG_TITLE =
	"I think we're ready for a first proper release, 0.2.0. Please follow our release-checklist skill and bump the version";

function overview(overrides: Partial<SessionOverview> = {}): SessionOverview {
	return {
		...sessionRow("s1", { title: LONG_TITLE, live: true }),
		projectName: "habit-tracker",
		wallMs: figure(60_000, "counted"),
		models: ["anthropic/claude-sonnet-5-5", "openai/gpt-6"],
		subagentsOutside: figure({ cost: 0.12, tokens: 9_000 }, "partiallyRecorded"),
		...overrides,
	};
}

const LABELS = {
	entry: {
		sessionId: "s1",
		labels: ["baseline", "release", "good", "slow"],
		note: "Ran twice",
		noted: true,
	},
	vocabulary: [{ label: "baseline", sessions: 3 }],
};

const TARGET = { turns: [], defaultTurn: null, selectedEvent: null };

function header(placement?: "tab" | "chatPane") {
	return html(
		<Header
			host={host(placement ? { placement } : {})}
			session={overview()}
			sources={SOURCES}
			labels={LABELS}
			exportTarget={TARGET}
			beforeLeave={noop}
		/>,
	);
}

describe("the one-line header", () => {
	test("is one row: the title, labels, note, crumb, figure chips and the actions", () => {
		const markup = header();
		expect(markup).toMatch(
			/data-testid="session-insights-header" data-layout="wide" class="[^"]*\bh-40\b/,
		);
		expect(markup).toContain(`title="${LONG_TITLE.replace(/'/g, "&#x27;")}"`);
		expect(markup).toMatch(/data-testid="session-insights-session-title" class="[^"]*\btruncate\b/);
		expect(markup.match(/data-testid="session-insights-session-label"/g)).toHaveLength(3);
		expect(markup).toContain(">+1<");
		expect(markup).toContain('data-testid="session-insights-session-note"');
		expect(markup).toContain("habit-tracker › main");
		expect(markup).toContain('data-testid="session-insights-live"');
		for (const chip of [
			"start",
			"wall",
			"active",
			"tokens",
			"cost",
			"outcome",
			"models",
			"outside",
		])
			expect(markup).toContain(`data-testid="session-insights-session-${chip}"`);
		expect(markup).toContain("8.2M tok");
		expect(markup).toContain("claude-sonnet-5-5");
		expect(markup).toContain(">+1</span>");
		for (const action of ["compare-with", "session-labels", "export", "session-open-chat"])
			expect(markup).toContain(`data-testid="session-insights-${action}"`);
		expect(markup).not.toContain('data-testid="session-insights-header-more"');
		expect(markup).not.toContain('data-testid="session-insights-open-as-tab"');
	});

	test("every figure chip keeps its provenance for the tooltip", () => {
		const figures = headerFigures(t, overview(), START);
		expect(figures.map((item) => item.id)).toEqual(["start", "wall", "active", "tokens", "cost"]);
		const byId = new Map(figures.map((item) => [item.id, item]));
		expect(byId.get("wall")?.figures).toEqual([
			{ metric: "wallTime", origin: "counted", exact: "1 min 0 s" },
		]);
		expect(byId.get("active")?.figures[0]).toMatchObject({
			metric: "activeTime",
			origin: "approximated",
		});
		expect(byId.get("tokens")?.figures[0]).toMatchObject({ metric: "tokens", exact: "8,200,000" });
		expect(byId.get("tokens")?.figures[0]?.detail).toContain("Input 4,100,000");
		expect(byId.get("cost")?.text).toBe("$2.04");
		expect(byId.get("cost")?.figures.map((item) => item.metric)).toEqual([
			"cost",
			"subagentsOutside",
		]);
		const unrecorded = headerFigures(
			t,
			overview({ cost: figure(0, "notRecorded"), tokens: figure(tokenTotals(5_000), "recorded") }),
			START,
		);
		expect(unrecorded.find((item) => item.id === "cost")?.text).toBe("$0 · 5K tokens");
	});

	test("narrows by priority: date and model first, then tokens, durations and outcome, then the actions", () => {
		const wide = headerLayout(1400);
		expect([...wide.hidden]).toEqual([]);
		expect(wide).toMatchObject({ crumb: true, actions: true, labels: 3 });
		expect([...headerLayout(1000).hidden].sort()).toEqual(["model", "start"]);
		expect([...headerLayout(900).hidden].sort()).toEqual([
			"active",
			"model",
			"outcome",
			"start",
			"tokens",
			"wall",
		]);
		expect(headerLayout(900)).toMatchObject({ crumb: true, actions: true });
		const pane = headerLayout(500);
		expect(pane).toMatchObject({ crumb: false, actions: false, labels: 1 });
		expect(pane.hidden.has("cost")).toBe(false);
	});

	test("in a chat pane: title, one label, note and cost stay; the rest is behind ⋯; ⤢ and × end the row", () => {
		const markup = header("chatPane");
		expect(markup).toContain('data-layout="narrow"');
		expect(markup.match(/data-testid="session-insights-session-label"/g)).toHaveLength(1);
		expect(markup).toContain(">+3<");
		expect(markup).toContain('data-testid="session-insights-session-note"');
		expect(markup).toContain('data-testid="session-insights-session-cost"');
		for (const chip of ["start", "wall", "active", "tokens", "outcome", "models"])
			expect(markup).not.toContain(`data-testid="session-insights-session-${chip}"`);
		expect(markup).not.toContain("habit-tracker › main");
		expect(markup).toContain('data-testid="session-insights-header-more"');
		expect(markup).not.toContain('data-testid="session-insights-compare-with"');
		expect(markup).not.toContain('data-testid="session-insights-session-open-chat"');
		expect(markup).toMatch(
			/data-testid="session-insights-open-as-tab".*data-testid="session-insights-close-pane"/,
		);
		expect(markup).toContain('aria-label="Open as tab"');
		expect(markup).toContain('aria-label="Close the analysis"');
	});

	test("the pane's controls save the view first, then move it to a tab or close it", () => {
		const calls: string[] = [];
		const pane = paneActions(
			host({
				placement: "chatPane",
				openAsTab: () => calls.push("openAsTab"),
				closePane: () => calls.push("closePane"),
			}),
			() => calls.push("save"),
		);
		pane?.openAsTab();
		pane?.close();
		expect(calls).toEqual(["save", "openAsTab", "save", "closePane"]);
		expect(paneActions(host(), noop)).toBeNull();
		expect(paneActions(host({ placement: "tab" }), noop)).toBeNull();
	});
});

describe("compare with…", () => {
	const rows = [
		sessionRow("s1", { title: "Current" }),
		sessionRow("old", { title: "Old work", start: figure(START - 86_400_000, "counted") }),
		sessionRow("new", {
			title: null,
			firstPrompt: "Fix the login form",
			start: figure(START + 60_000, "counted"),
		}),
		sessionRow("undated", { title: "Undated", start: figure<number>(null, "counted") }),
		sessionRow("tagged", { title: "Tagged", start: figure(START, "counted") }),
	];
	const labels = new Map([["tagged", ["baseline"]]]);

	test("offers the scope's other sessions, most recent first", () => {
		expect(pickerRows(rows, "s1", "", labels).map((row) => row.sessionId)).toEqual([
			"new",
			"tagged",
			"old",
			"undated",
		]);
	});

	test("filters by title, first prompt or label as typed", () => {
		const ids = (query: string) =>
			pickerRows(rows, "s1", query, labels).map((row) => row.sessionId);
		expect(ids("old")).toEqual(["old"]);
		expect(ids("  LOGIN ")).toEqual(["new"]);
		expect(ids("basel")).toEqual(["tagged"]);
		expect(ids("current")).toEqual([]);
	});

	test("↑/↓ move between the options, clamped, Home and End reach the ends", () => {
		expect(pickerStep("ArrowDown", 0, 3)).toBe(1);
		expect(pickerStep("ArrowDown", 2, 3)).toBe(2);
		expect(pickerStep("ArrowUp", 0, 3)).toBe(0);
		expect(pickerStep("End", 0, 3)).toBe(2);
		expect(pickerStep("Home", 2, 3)).toBe(0);
		expect(pickerStep("Enter", 0, 3)).toBeNull();
		expect(pickerStep("ArrowDown", 0, 0)).toBeNull();
	});

	test("picking B opens the comparison the list opens, titled A ↔ B", () => {
		const opened: unknown[] = [];
		compareWith(
			host({ openPanel: (...args) => opened.push(args) }),
			t,
			{ sessionId: "s1", name: "Current" },
			rows[2] ?? sessionRow("x"),
		);
		expect(opened).toEqual([["compare", { a: "s1", b: "new" }, "Current ↔ “Fix the login form”"]]);
	});
});

describe("the sections", () => {
	test("six, the overview first and shown on a fresh tab", () => {
		const markup = html(<SessionPanel host={host()} params={{ sessionId: "s1" }} />);
		const tabs = [...markup.matchAll(/data-testid="session-insights-section-([a-z]+)"/g)].map(
			(match) => match[1],
		);
		expect(tabs).toEqual(["overview", "trace", "subagents", "errors", "cost", "files"]);
		expect(markup).toMatch(
			/aria-selected="true"[^>]*data-testid="session-insights-section-overview"/,
		);
		expect(markup).toContain('data-testid="session-insights-overview"');
		expect(markup).toContain(">Cost &amp; context<");
	});

	test("a tab brought back shows the section it was left on; a pending focus wins over it", () => {
		const restored = html(
			<SessionPanel
				host={host({ viewState: { section: "files" } })}
				params={{ sessionId: "s2" }}
			/>,
		);
		expect(restored).toMatch(
			/aria-selected="true"[^>]*data-testid="session-insights-section-files"/,
		);
		requestSessionFocus("s3", "x1");
		const focused = html(
			<SessionPanel
				host={host({ viewState: { section: "files" } })}
				params={{ sessionId: "s3" }}
			/>,
		);
		settleSessionFocus("s3", "x1");
		expect(focused).toMatch(
			/aria-selected="true"[^>]*data-testid="session-insights-section-trace"/,
		);
	});

	test("the trace's modes: Tree, Turns and Timeline, the current one pressed", () => {
		const markup = html(<ModeSwitch mode="turns" onMode={noop} />);
		expect([...markup.matchAll(/session-insights-trace-mode-([a-z]+)/g)].map((m) => m[1])).toEqual([
			"tree",
			"turns",
			"timeline",
		]);
		expect(markup).toMatch(/aria-pressed="true"[^>]*session-insights-trace-mode-turns/);
		expect(markup).toContain('aria-label="Trace view"');
	});

	test("cost & context is one scroll: why expensive first, then the context; the diff gets a box", () => {
		const markup = html(
			<CostContextSection cost={<p>cost</p>} context={<p>context</p>} diff={false} />,
		);
		expect(markup).toMatch(
			/cost-context".*overflow-y-auto.*cost-context-cost.*cost<.*cost-context-context.*context</,
		);
		expect(html(<CostContextSection cost={null} context={null} diff />)).toMatch(
			/cost-context-context" class="[^"]*\bh-640\b/,
		);
	});

	test("an overview link opens its section, and the findings the list's Insights", () => {
		const calls: unknown[] = [];
		const route = {
			trace: (mode: string, events: readonly string[]) => calls.push(["trace", mode, events]),
			section: (section: string) => calls.push(["section", section]),
			chain: (index: number) => calls.push(["chain", index]),
			file: (path: string) => calls.push(["file", path]),
			findings: () => calls.push(["findings"]),
		};
		const links: OverviewLink[] = [
			{ to: "trace" },
			{ to: "trace", mode: "timeline", events: ["a", "b"] },
			{ to: "errors", chain: 2 },
			{ to: "cost" },
			{ to: "files", path: "src/a.ts" },
			{ to: "subagents" },
			{ to: "findings" },
		];
		for (const link of links) routeOverviewLink(link, route);
		expect(calls).toEqual([
			["trace", "tree", []],
			["trace", "timeline", ["a", "b"]],
			["section", "errors"],
			["chain", 2],
			["section", "cost"],
			["section", "files"],
			["file", "src/a.ts"],
			["section", "subagents"],
			["findings"],
		]);
		const opened: unknown[] = [];
		openFindings(host({ openPanel: (...args) => opened.push(args) }));
		const intent = pendingListView();
		expect(intent).toEqual({ tab: "insights", section: "findings" });
		if (intent) settleListView(intent);
		expect(opened).toEqual([["sessions"]]);
	});

	test("a section's data is asked for the first time it shows and kept after", () => {
		const start = initialNavigation(INITIAL_VIEW, null);
		expect([...start.seen]).toEqual([]);
		const turns = moved(start, { section: "trace", mode: "turns" });
		const files = moved(turns, { section: "files" });
		expect([...moved(files, { section: "overview" }).seen].sort()).toEqual(["files", "timeline"]);
		expect([...initialNavigation({ ...INITIAL_VIEW, section: "cost" }, null).seen]).toEqual([
			"cost",
		]);
		expect(
			initialNavigation({ ...INITIAL_VIEW, section: "cost", mode: "timeline" }, "e1"),
		).toMatchObject({
			section: "trace",
			mode: "tree",
			selectedId: "e1",
			reveal: true,
		});
		expect(moved({ ...start, reveal: true }, { section: "errors" }).reveal).toBe(false);
	});
});

describe("view state", () => {
	test("reads back what was saved, each field checked, anything else at its default", () => {
		expect(parseViewState(undefined)).toEqual(INITIAL_VIEW);
		expect(parseViewState("trace")).toEqual(INITIAL_VIEW);
		const expected: SessionViewState = {
			section: "trace",
			mode: "timeline",
			selectedId: "t1",
			open: [
				["u1", true],
				["u2", false],
			],
			top: "a2",
			context: "diff",
			detailTab: "result",
			chain: 2,
			file: "src/a.ts",
		};
		expect(parseViewState({ ...expected, open: [...expected.open, ["bad"], [3, true]] })).toEqual(
			expected,
		);
		expect(
			parseViewState({
				section: "turns",
				mode: "grid",
				context: "x",
				detailTab: "nope",
				chain: -1,
				top: "",
			}),
		).toEqual(INITIAL_VIEW);
		const many = Array.from({ length: MAX_FOLDS + 5 }, (_, at) => [`e${at}`, true]);
		const folds = parseViewState({ open: many }).open;
		expect(folds).toHaveLength(MAX_FOLDS);
		expect(folds[0]).toEqual(["e5", true]);
	});

	test("changes are saved a moment after the last one and at once when the panel goes", async () => {
		const saves: unknown[] = [];
		const memory = new ViewMemory(INITIAL_VIEW, (state) => saves.push(state));
		memory.remember({ section: "errors" });
		memory.remember({ chain: 1 });
		expect(saves).toEqual([]);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(saves).toEqual([{ ...INITIAL_VIEW, section: "errors", chain: 1 }]);
		memory.remember({ file: "a.ts" });
		memory.flush();
		expect(saves).toHaveLength(2);
		expect(saves[1]).toMatchObject({ section: "errors", chain: 1, file: "a.ts" });
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(saves).toHaveLength(2);
		const quiet = new ViewMemory(INITIAL_VIEW, undefined);
		quiet.remember({ section: "files" });
		quiet.flush();
		expect(quiet.state.section).toBe("files");
	});

	test("a host without view state reads as a fresh tab", () => {
		expect(ViewMemory.of(host()).state).toEqual(INITIAL_VIEW);
		expect(ViewMemory.of(host({ viewState: { section: "errors" } })).state.section).toBe("errors");
	});
});

describe("beside the chat", () => {
	const events = sampleEvents();
	const model = new TraceModel(events);
	const trace = {
		meta: {
			revision: "r",
			total: events.length,
			start: events[0]?.t0 ?? 0,
			end: events.at(-1)?.t1 ?? 0,
			errors: 0,
			gaps: [],
			offBranch: 0,
		},
		events,
		complete: true,
		newer: false,
	};

	function explorer(placement: "tab" | "chatPane", onSelect: (index: number) => void) {
		return html(
			<TraceExplorer
				host={host({ placement })}
				sessionId="s1"
				overview={null}
				trace={trace}
				model={model}
				selected={0}
				onSelect={onSelect}
				analysis={null}
				subtraces={{ available: new Set(), loaded: new Set(), loading: new Set(), load: noop }}
				intent={null}
			/>,
		);
	}

	test("the call details stack under the tree and its Gantt in a pane, beside them in a tab", () => {
		expect(explorer("chatPane", noop)).toContain(
			'data-testid="trace-details-pane" data-stacked="true"',
		);
		expect(explorer("tab", noop)).not.toContain('data-stacked="true"');
	});

	test("the trace's fallback selection on mount is not a pick", () => {
		const picks: number[] = [];
		explorer("chatPane", (index) => picks.push(index));
		expect(picks).toEqual([]);
	});

	test("a pick asks for the event's anchor and has the chat show it; a later pick wins", async () => {
		const anchor: PanelChatAnchor = { messageIndex: 4, anchorText: "edit", toolCallId: "call-1" };
		const shown: PanelChatAnchor[] = [];
		const seen: unknown[] = [];
		const paneHost = host({
			placement: "chatPane",
			query: async (method, params) => {
				seen.push([method, params]);
				return { apiVersion: 11, found: true, anchor };
			},
			showInChat: (at) => shown.push(at),
		});
		const live = new AbortController();
		expect(await showEventInChat(paneHost, "s1", "t1", live.signal)).toBe("shown");
		expect(seen).toEqual([["event.anchor", { sessionId: "s1", eventId: "t1" }]]);
		expect(shown).toEqual([anchor]);
		const stale = new AbortController();
		const asked = showEventInChat(paneHost, "s1", "t2", stale.signal);
		stale.abort();
		expect(await asked).toBe("stale");
		expect(shown).toHaveLength(1);
		expect(await showEventInChat(paneHost, "s1", "child:k/x", live.signal)).toBe("notInChat");
	});

	test("the details read Show in chat in a pane, and say when the chat shows the call", () => {
		const details = (shared: DetailsHost | null) =>
			html(
				<DetailsContext value={shared}>
					<DetailsPanel
						host={host()}
						sessionId="s1"
						model={model}
						index={model.indexOf("t1")}
						overview={overview()}
						query=""
						onSelect={noop}
						onZoom={noop}
						tabsRef={{ current: null }}
					/>
				</DetailsContext>,
			);
		const inPane: DetailsHost = {
			tab: null,
			onTab: noop,
			showInChat: async () => "shown",
			shown: null,
		};
		expect(details(null)).toContain(">Open in chat<");
		expect(details(inPane)).toContain(">Show in chat<");
		expect(details(inPane)).not.toContain('data-testid="details-shown"');
		expect(details({ ...inPane, shown: "t1" })).toContain("shown at left");
	});
});

describe("plural copy in the session sections", () => {
	test("each count reads singular for one and plural for more", () => {
		const forms = (key: MessageKey, values: Record<string, unknown> = {}) =>
			[1, 3].map((count) => t(key, { count, n: count, ...values }));
		expect(forms("sessionInsights.files.receipt", { added: 1, removed: 0, runs: 1 })[0]).toBe(
			"turn receipts: +1 −0 in 1 run",
		);
		expect(forms("sessionInsights.files.reads")).toEqual(["1 read", "3 reads"]);
		expect(forms("sessionInsights.files.failedEdits")).toEqual(["1 failed edit", "3 failed edits"]);
		expect(forms("sessionInsights.subagents.runs")).toEqual(["1 run", "3 runs"]);
		expect(forms("sessionInsights.subagents.waves")).toEqual(["1 wave", "3 waves"]);
		expect(forms("sessionInsights.subagents.llmCalls")).toEqual(["1 model call", "3 model calls"]);
		expect(forms("sessionInsights.details.lines")).toEqual(["1 line", "3 lines"]);
		expect(forms("sessionInsights.details.chars")).toEqual(["1 char", "3 chars"]);
		expect(forms("sessionInsights.details.characters")).toEqual(["1 character", "3 characters"]);
		expect(forms("sessionInsights.request.chars")).toEqual(["1 char", "3 chars"]);
		expect(forms("sessionInsights.errors.toolChain", { tool: "bash" })).toEqual([
			"bash · 1 attempt",
			"bash · 3 attempts",
		]);
		expect(forms("sessionInsights.timeline.tracks")).toEqual(["1 track", "3 tracks"]);
		expect(forms("sessionInsights.trace.paging", { loaded: 1, total: 1 })[0]).toBe(
			"Loading 1 of 1 event",
		);
		expect(forms("sessionInsights.context.countMisses")).toEqual([
			"1 cache miss",
			"3 cache misses",
		]);
		expect(
			forms("sessionInsights.files.summaryTurns", {
				files: 1,
				changed: 1,
				rework: 0,
				added: 1,
				removed: 0,
			})[0],
		).toMatch(/^1 file × turns/);
		expect(forms("sessionInsights.comparePicker.calls")).toEqual(["1 call", "3 calls"]);
		expect(forms("sessionInsights.session.overviewFocus")).toEqual([
			"1 call from the overview",
			"3 calls from the overview",
		]);
	});
});
