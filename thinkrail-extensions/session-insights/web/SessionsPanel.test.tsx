import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import type { Origin, SessionListRow } from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FigureDetails } from "./FigureCell";
import { figure, listResult, PROJECTS, SOURCES, START, sessionRow } from "./fixtures.test";
import { type ListTab, requestListView, settleListView } from "./listIntent";
import { API_VERSION } from "./load";
import SessionsPanel, { type ListSelection, type ListView, SessionsView } from "./SessionsPanel";
import { rowKeyAction } from "./SessionsTable";
import {
	comparedPair,
	openPicked,
	pickOf,
	type SessionPick,
	swapPicks,
	togglePick,
} from "./selection";

const noop = () => {};

function panelHost(overrides: Partial<PanelHost> = {}): PanelHost {
	return {
		query: () => new Promise(() => {}),
		openChat: noop,
		openPanel: noop,
		renderToolCall: () => null,
		openFile: () => {},
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion: API_VERSION,
		...overrides,
	};
}

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

function view(
	listView: ListView,
	options: { scopeKind?: "project" | "all"; busy?: boolean } = {},
): string {
	return html(
		<SessionsView
			view={listView}
			scopeKind={options.scopeKind ?? "project"}
			busy={options.busy ?? false}
			onScope={noop}
			onRefresh={noop}
			onOpen={noop}
			onAnalyse={noop}
		/>,
	);
}

function ready(rows: readonly SessionListRow[], options: Parameters<typeof listResult>[1] = {}) {
	return { kind: "ready", result: listResult(rows, options), receivedAt: START } as const;
}

function rowsOf(markup: string): string[] {
	return markup.split('data-testid="session-insights-row"').slice(1);
}

function cell(row: string, name: string): string {
	const at = row.indexOf(`data-testid="session-insights-${name}"`);
	if (at < 0) throw new Error(`no ${name} cell`);
	return row.slice(row.lastIndexOf("<", at), row.indexOf("</td>", at));
}

function badges(markup: string): string[] {
	return [
		...markup.matchAll(/data-testid="session-insights-badge" data-origin="([a-zA-Z]+)"/g),
	].map((match) => match[1] ?? "");
}

const ENTITIES: Readonly<Record<string, string>> = {
	"&#x27;": "'",
	"&quot;": '"',
	"&lt;": "<",
	"&gt;": ">",
	"&amp;": "&",
};

const text = (markup: string) =>
	markup
		.replace(/<[^>]+>/g, "")
		.replace(/&(?:#x27|quot|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);

describe("SessionsView states", () => {
	test("loading shows a busy region and the scope switch on this project", () => {
		const markup = view({ kind: "loading" });
		expect(markup).toContain('data-testid="session-insights-loading"');
		expect(markup).toContain('aria-busy="true"');
		expect(markup).toMatch(/data-testid="session-insights-scope-project" data-active="true"/);
		expect(markup).toMatch(/data-testid="session-insights-scope-all" data-active="false"/);
		expect(markup).not.toContain('data-testid="session-insights-table"');
	});

	test("a server half of another version asks for an update instead of rendering", () => {
		const markup = view({ kind: "version" });
		expect(markup).toContain('data-testid="session-insights-update-host"');
		expect(text(markup)).toContain("Update ThinkRail to use this panel.");
	});

	test("each refusal has its own words, and only a plain failure offers Retry", () => {
		const failed = view({ kind: "error", failure: "failed" });
		expect(failed).toContain('role="alert"');
		expect(text(failed)).toContain("Couldn't load the session list.");
		expect(text(failed)).toContain("Retry");
		const disabled = view({ kind: "error", failure: "disabled" });
		expect(text(disabled)).toContain("Session insights is turned off.");
		expect(text(disabled)).not.toContain("Retry");
		expect(text(view({ kind: "error", failure: "updateHost" }))).toContain("Update ThinkRail");
	});

	test("an empty project offers all projects; an empty machine says so", () => {
		const project = view(ready([]));
		expect(project).toContain('data-testid="session-insights-empty"');
		expect(text(project)).toContain("No sessions in this project yet.");
		expect(text(project)).toContain("Show all projects");
		const all = view(ready([]), { scopeKind: "all" });
		expect(text(all)).toContain("No pi sessions on this machine yet.");
		expect(text(all)).not.toContain("Show all projects");
	});

	test("an index still reading shows its progress, and rows already read", () => {
		const cold = view(ready([], { state: { phase: "cold", indexed: 0, total: null } }));
		expect(cold).toContain('data-phase="cold"');
		expect(text(cold)).toContain("Looking for sessions…");
		expect(cold).toContain('data-testid="session-insights-loading"');
		const refreshing = view(
			ready([sessionRow("s1")], { state: { phase: "refreshing", indexed: 120, total: 450 } }),
		);
		expect(refreshing).toContain('data-phase="refreshing"');
		expect(text(refreshing)).toContain("Updating… 120 of 450");
		expect(refreshing).toMatch(/<progress[^>]*max="450"[^>]*value="120"/);
		expect(rowsOf(refreshing)).toHaveLength(1);
		const done = view(ready([sessionRow("s1")]));
		expect(done).toContain('data-phase="ready"');
		expect(done).not.toContain("<progress");
	});
});

function tabbed(tab: ListTab, extra: Partial<Parameters<typeof SessionsView>[0]> = {}): string {
	return html(
		<SessionsView
			view={ready([sessionRow("s1")])}
			scopeKind="project"
			busy={false}
			onScope={noop}
			onRefresh={noop}
			onOpen={noop}
			onAnalyse={noop}
			tab={tab}
			onTab={noop}
			day={<div data-testid="day-slot" />}
			stats={<div data-testid="stats-slot" />}
			insightsBadge={<span data-testid="badge-slot" />}
			{...extra}
		/>,
	);
}

function tabOf(markup: string, id: ListTab): string {
	const match = markup.match(
		new RegExp(
			`<button[^>]*role="tab"[^>]*data-testid="session-insights-tab-${id}"[^>]*>[\\s\\S]*?</button>`,
		),
	);
	if (!match) throw new Error(`no ${id} tab`);
	return match[0];
}

describe("the list's tabs", () => {
	test("Sessions, Days and Insights are a labelled tab list with one tab stop over one tab panel", () => {
		const markup = tabbed("sessions");
		expect(markup).toContain('role="tablist" aria-label="Views"');
		expect(text(tabOf(markup, "sessions"))).toBe("Sessions");
		expect(text(tabOf(markup, "days"))).toBe("Days");
		expect(tabOf(markup, "sessions")).toContain('aria-selected="true"');
		expect(tabOf(markup, "sessions")).toContain('tabindex="0"');
		expect(tabOf(markup, "days")).toContain('aria-selected="false"');
		expect(tabOf(markup, "days")).toContain('tabindex="-1"');
		expect(tabOf(markup, "insights")).toContain('data-testid="badge-slot"');
		expect(markup.match(/role="tabpanel"/g)).toHaveLength(1);
		const tabId = tabOf(markup, "sessions").match(/id="([^"]+)"/)?.[1];
		expect(markup).toContain(
			`role="tabpanel" id="${tabId?.replace(/-tab-sessions$/, "-panel")}" aria-labelledby="${tabId}"`,
		);
		expect(markup).toContain('data-testid="session-insights-table"');
	});

	test("each tab swaps the body; the scope switch and the search field stay for every tab", () => {
		const days = tabbed("days", { searchBox: <div data-testid="search-box-slot" /> });
		expect(days).toContain('data-testid="day-slot"');
		expect(days).not.toContain('data-testid="session-insights-table"');
		expect(days).toContain('data-testid="session-insights-scope-all"');
		expect(days).toContain('data-testid="search-box-slot"');
		const insights = tabbed("insights", { searchBox: <div data-testid="search-box-slot" /> });
		expect(insights).toContain('data-testid="stats-slot"');
		expect(tabOf(insights, "insights")).toContain('aria-selected="true"');
		expect(insights).toContain('data-testid="session-insights-scope-project"');
		expect(insights).toContain('data-testid="search-box-slot"');
	});

	test("the panel opens on Sessions", () => {
		const markup = html(<SessionsPanel host={panelHost()} params={{}} />);
		expect(tabOf(markup, "sessions")).toContain('aria-selected="true"');
		expect(tabOf(markup, "insights")).toContain('aria-selected="false"');
	});
});

describe("the list's search", () => {
	test("the toolbar holds the search field; typing a query swaps the body for the results", () => {
		const props = {
			view: ready([sessionRow("s1")]),
			scopeKind: "project" as const,
			busy: false,
			onScope: noop,
			onRefresh: noop,
			onOpen: noop,
			onAnalyse: noop,
			onTab: noop,
			searchBox: <div data-testid="search-box-slot" />,
			search: <div data-testid="search-slot" />,
			onSearchKey: noop,
		};
		const table = html(<SessionsView {...props} tab="sessions" />);
		expect(table).toMatch(/role="toolbar"[\s\S]*data-testid="search-box-slot"/);
		expect(table).toContain('data-testid="session-insights-table"');
		expect(table).not.toContain('data-testid="search-slot"');
		const results = html(<SessionsView {...props} tab="insights" showSearch />);
		expect(results).toContain('data-testid="search-slot"');
		expect(results).toContain('data-testid="search-box-slot"');
		expect(results).not.toContain('data-testid="session-insights-table"');
		expect(tabOf(results, "insights")).toContain('aria-selected="true"');
	});
});

describe("the session table", () => {
	test("one project reads as a flat list; all projects group by project, outsiders last", () => {
		const rows = [
			sessionRow("a1"),
			sessionRow("b1", { projectId: "p2", workspaceId: "w2" }),
			sessionRow("o1", {
				projectId: null,
				workspaceId: null,
				workspaceName: null,
				workspaceState: "none",
			}),
		];
		const flat = view(ready([sessionRow("a1")]));
		expect(flat).not.toContain('data-testid="session-insights-group"');
		expect(rowsOf(flat)).toHaveLength(1);
		const grouped = view(ready(rows), { scopeKind: "all" });
		const groups = [
			...grouped.matchAll(/data-testid="session-insights-group" data-group="([^"]+)"/g),
		];
		expect(groups.map((match) => match[1])).toEqual(["project:p1", "project:p2", "outside"]);
		expect(text(grouped)).toContain(PROJECTS[0]?.name ?? "");
		expect(text(grouped)).toContain("Outside ThinkRail projects");
		expect(text(grouped)).toContain("1 session");
		expect(text(grouped)).toContain("3 sessions");
	});

	test("columns read name, workspace and first prompt, start, active, tokens, cost, calls, errors, subagents, outcome", () => {
		const markup = view(
			ready([
				sessionRow("s1", {
					title: "Review PR 1359",
					firstPrompt: "please review PR 1359",
					toolCalls: figure(70, "counted"),
					toolErrors: figure(2, "counted"),
					subagents: figure(22, "counted"),
				}),
			]),
		);
		for (const header of [
			"Session",
			"Start",
			"Active",
			"Tokens",
			"Cost",
			"Calls",
			"Errors",
			"Subagents",
			"Outcome",
		])
			expect(text(markup)).toContain(header);
		expect(markup).toMatch(
			/aria-sort="descending"[^>]*>\s*<button[^>]*session-insights-sort-start/,
		);
		const [row = ""] = rowsOf(markup);
		expect(text(cell(row, "name"))).toContain("Review PR 1359");
		expect(text(cell(row, "name"))).toContain("main · “please review PR 1359”");
		expect(text(cell(row, "active"))).toContain("12 min");
		expect(text(cell(row, "tokens"))).toContain("8.2M");
		expect(text(cell(row, "cost"))).toContain("$2.04");
		expect(text(cell(row, "calls"))).toContain("70");
		expect(text(cell(row, "errors"))).toContain("2 · 3%");
		expect(text(cell(row, "subagents"))).toContain("22");
		expect(text(cell(row, "outcome"))).toContain("succeeded");
		expect(row).toContain('data-testid="session-insights-open-chat"');
	});

	test("an untitled session is named by its quoted first prompt", () => {
		const [row = ""] = rowsOf(
			view(ready([sessionRow("s1", { title: null, firstPrompt: "can you verify issue 353" })])),
		);
		expect(text(cell(row, "name"))).toContain("“can you verify issue 353”");
		const [bare = ""] = rowsOf(view(ready([sessionRow("s2", { title: null, firstPrompt: null })])));
		expect(text(cell(bare, "name"))).toContain("Untitled session");
	});

	test("badges mark only estimates and missing data; exact numbers stay clean", () => {
		const clean = sessionRow("clean", { activeMs: figure(60_000, "counted") });
		expect(badges(view(ready([clean])))).toEqual([]);
		const marked = sessionRow("marked", {
			activeMs: figure(60_000, "approximated"),
			cost: figure(0.5, "partiallyRecorded"),
			subagents: figure(2, "notMeasured"),
			subagentsOutside: figure({ cost: 0.1, tokens: 10 }, "notMeasured"),
		});
		expect(badges(view(ready([marked])))).toEqual([
			"approximated",
			"partiallyRecorded",
			"notMeasured",
			"notMeasured",
		]);
		const origins: Origin[] = ["recorded", "counted", "host"];
		for (const origin of origins)
			expect(
				badges(
					view(
						ready([sessionRow("x", { cost: figure(1, origin), activeMs: figure(1, "counted") })]),
					),
				),
			).toEqual([]);
	});

	test("a model that records $0 reads “$0 · not recorded” with its tokens", () => {
		const [row = ""] = rowsOf(
			view(ready([sessionRow("bridge", { cost: figure(0, "notRecorded") })])),
		);
		const cost = cell(row, "cost");
		expect(text(cost)).toContain("$0");
		expect(text(cost)).toContain("not recorded");
		expect(text(cost)).toContain("8.2M tokens");
		expect(badges(cost)).toEqual(["notRecorded"]);
	});

	test("subagent spend outside pi's total is its own labelled line, never added to the headline", () => {
		const [row = ""] = rowsOf(
			view(
				ready([
					sessionRow("s1", {
						cost: figure(41.53, "recorded"),
						subagentsOutside: figure({ cost: 12.5, tokens: 900 }, "recorded"),
					}),
				]),
			),
		);
		const cost = cell(row, "cost");
		expect(text(cost)).toContain("$41.53");
		expect(text(cost)).toContain("+$12.50 subagents outside pi's total");
		const [tokensOnly = ""] = rowsOf(
			view(
				ready([
					sessionRow("s2", { subagentsOutside: figure({ cost: 0, tokens: 2_500 }, "recorded") }),
				]),
			),
		);
		expect(text(cell(tokensOnly, "cost"))).toContain("+2.5K subagent tokens outside pi's total");
		const [none = ""] = rowsOf(view(ready([sessionRow("s3")])));
		expect(none).not.toContain("session-insights-outside");
	});

	test("live and removed-workspace sessions are badged, and a removed one has no Open chat", () => {
		const markup = view(
			ready([
				sessionRow("live", { live: true }),
				sessionRow("gone", {
					workspaceId: null,
					workspaceName: "old-feature",
					workspaceState: "removed",
					outcome: null,
				}),
			]),
		);
		const [live = "", gone = ""] = rowsOf(markup);
		expect(live).toContain('data-testid="session-insights-live"');
		expect(live).toContain('data-testid="session-insights-open-chat"');
		expect(gone).toContain('data-testid="session-insights-removed"');
		expect(text(gone)).toContain("workspace removed");
		expect(text(cell(gone, "name"))).toContain("old-feature");
		expect(gone).not.toContain('data-testid="session-insights-open-chat"');
		expect(text(cell(gone, "outcome"))).toBe("—");
	});

	test("one roving tab stop enters the table; the checkbox, the name, the analysis and every figure are cells the arrows reach", () => {
		const markup = view(ready([sessionRow("s1"), sessionRow("s2")]));
		const body = markup.slice(markup.indexOf("<tbody>"));
		expect(body.match(/tabindex="0"/g)).toHaveLength(1);
		expect(body).toMatch(
			/<input type="checkbox" data-grid-key="session:s1" data-grid-row="0" data-grid-col="0" tabindex="0"/,
		);
		expect(body).toMatch(
			/<button type="button" data-grid-key="session:s1" data-grid-row="0" data-grid-col="1" tabindex="-1"/,
		);
		const [first = "", second = ""] = rowsOf(markup);
		expect(first.match(/<button type="button" data-grid-key="session:s1"/g)).toHaveLength(8);
		expect(first).toContain('data-testid="session-insights-pick"');
		expect(first).toContain('aria-label="Select “Session s1” to compare"');
		expect(first).toContain('data-testid="session-insights-open-analysis"');
		expect(first).not.toContain('data-testid="session-insights-compare"');
		expect([...first.matchAll(/data-grid-col="(\d)"/g)].map((match) => match[1])).toEqual([
			"0",
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7",
			"8",
			"9",
		]);
		expect(second).toContain('data-grid-row="1" data-grid-col="0" tabindex="-1"');
	});

	test("long lists page per group with a Show more line", () => {
		const rows = Array.from({ length: 30 }, (_, index) => sessionRow(`s${index}`));
		const markup = view(ready(rows));
		expect(rowsOf(markup)).toHaveLength(25);
		expect(markup).toContain('data-testid="session-insights-more"');
		expect(text(markup)).toContain("Show 5 more");
	});

	test("the footer counts sessions and keys the two glyph badges", () => {
		const markup = view(ready([sessionRow("s1"), sessionRow("s2")]));
		expect(markup).toContain('data-testid="session-insights-count"');
		expect(text(markup)).toContain("2 sessions");
		expect(markup.match(/session-insights-legend-badge/g)).toHaveLength(2);
		expect(text(markup)).toContain("Hover or focus a number to see where it comes from.");
	});
});

describe("figure tooltips", () => {
	test("say where a number comes from, how it is computed and from which pi fields", () => {
		const markup = renderToStaticMarkup(
			<FigureDetails
				figures={[
					{ metric: "cost", origin: "notRecorded", exact: "$0.00" },
					{ metric: "subagentsOutside", origin: "recorded", exact: "$12.50", detail: "900 tokens" },
				]}
				sources={SOURCES}
			/>,
		);
		const plain = text(markup);
		expect(plain).toContain("Not recorded");
		expect(plain).toContain("$0.00");
		expect(plain).toContain("pi's recorded cost total");
		expect(plain).toContain("left it out or reported $0");
		expect(plain).toContain("message[assistant].usage.cost.total");
		expect(plain).toContain("Recorded by pi");
		expect(plain).toContain("never added to it");
		expect(plain).toContain("child transcript usage");
		expect(plain).toContain("900 tokens");
		expect(markup.match(/data-testid="session-insights-figure"/g)).toHaveLength(2);
	});

	test("exact figures explain themselves without an estimate note", () => {
		const plain = text(
			renderToStaticMarkup(
				<FigureDetails
					figures={[{ metric: "toolCalls", origin: "counted", exact: "70" }]}
					sources={SOURCES}
				/>,
			),
		);
		expect(plain).toContain("Counted from the session file");
		expect(plain).toContain("Tool calls in the session's assistant messages");
		expect(plain).not.toContain("estimate");
	});
});

describe("SessionsPanel", () => {
	const host = (hostApiVersion: number | undefined): PanelHost => ({
		query: () => new Promise(() => {}),
		openChat: noop,
		openPanel: noop,
		renderToolCall: () => null,
		openFile: () => {},
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion,
	});

	test("starts loading against its own server half's version", () => {
		const markup = html(<SessionsPanel host={host(API_VERSION)} params={{}} />);
		expect(markup).toContain('data-testid="session-insights-loading"');
	});

	test("a server half without this version shows the update notice and never queries", () => {
		for (const version of [undefined, 4]) {
			const markup = html(<SessionsPanel host={host(version)} params={{}} />);
			expect(markup).toContain('data-testid="session-insights-update-host"');
		}
	});
});

function picks(...ids: string[]): SessionPick[] {
	return ids.map((id) => pickOf(sessionRow(id, { toolCalls: figure(9, "counted") }), []));
}

function selected(items: readonly SessionPick[], rows = [sessionRow("s1"), sessionRow("s2")]) {
	const selection: ListSelection = {
		picks: items,
		labelsOf: (pick) => pick.labels,
		now: START,
		onToggle: noop,
		onSwap: noop,
		onClear: noop,
		onCompare: noop,
	};
	return html(
		<SessionsView
			view={ready(rows)}
			scopeKind="project"
			busy={false}
			onScope={noop}
			onRefresh={noop}
			onOpen={noop}
			onAnalyse={noop}
			selection={selection}
		/>,
	);
}

function bar(markup: string): string {
	const at = markup.indexOf('data-testid="session-insights-selection-bar"');
	if (at < 0) return "";
	return markup.slice(markup.lastIndexOf("<", at), markup.indexOf("</section>", at));
}

describe("select and compare", () => {
	test("ticks keep their order; unticking keeps the others; swap trades A and B; only two make a pair", () => {
		const [a, b, c] = picks("a", "b", "c");
		if (!a || !b || !c) throw new Error("no picks");
		const two = togglePick(togglePick([], b), a);
		expect(two.map((pick) => pick.sessionId)).toEqual(["b", "a"]);
		expect(comparedPair(two)?.map((pick) => pick.sessionId)).toEqual(["b", "a"]);
		expect(swapPicks(two).map((pick) => pick.sessionId)).toEqual(["a", "b"]);
		const three = togglePick(two, c);
		expect(comparedPair(three)).toBeNull();
		expect(swapPicks(three)).toBe(three);
		expect(togglePick(three, b).map((pick) => pick.sessionId)).toEqual(["a", "c"]);
		expect(comparedPair([a])).toBeNull();
	});

	test("a pick keeps what the bar names: title, first prompt, start, calls and labels", () => {
		const pick = pickOf(
			sessionRow("s9", { title: null, firstPrompt: "fix it", toolCalls: figure(4, "counted") }),
			["good"],
		);
		expect(pick).toEqual({
			sessionId: "s9",
			title: null,
			firstPrompt: "fix it",
			start: START,
			calls: 4,
			labels: ["good"],
		});
	});

	test("Space ticks a row from any of its cells, Enter on the checkbox compares two, Enter on a figure opens", () => {
		expect(rowKeyAction(" ", 1, false, false)).toBe("toggle");
		expect(rowKeyAction(" ", 5, true, true)).toBe("toggle");
		expect(rowKeyAction(" ", 0, false, false)).toBeNull();
		expect(rowKeyAction("Enter", 0, false, true)).toBe("compare");
		expect(rowKeyAction("Enter", 0, false, false)).toBeNull();
		expect(rowKeyAction("Enter", 3, false, false)).toBe("open");
		expect(rowKeyAction("Enter", 3, true, false)).toBeNull();
		expect(rowKeyAction("Enter", 4, true, false)).toBe("open");
		expect(rowKeyAction("Enter", 1, false, true)).toBeNull();
		expect(rowKeyAction("a", 1, false, true)).toBeNull();
	});

	test("ticked rows are checked; nothing ticked shows no bar", () => {
		const none = selected([]);
		expect(bar(none)).toBe("");
		expect(none).not.toContain('checked=""');
		const markup = selected(picks("s2"));
		const [first = "", second = ""] = rowsOf(markup);
		expect(first).toContain('data-picked="false"');
		expect(second).toContain('data-picked="true"');
		expect(second).toMatch(/data-testid="session-insights-pick"[^>]*checked=""/);
		expect(first).not.toMatch(/data-testid="session-insights-pick"[^>]*checked=""/);
	});

	test("one tick shows the bar with that pick and asks for one more; Compare waits", () => {
		const one = bar(selected(picks("s1")));
		expect(one).toContain('data-count="1"');
		expect(text(one)).toContain("1 session selected");
		expect(one.match(/data-testid="session-insights-selection-chip" data-side="a"/g)).toHaveLength(
			1,
		);
		expect(text(one)).toContain("Tick one more session to compare");
		expect(one).toMatch(/data-testid="session-insights-selection-compare" disabled=""/);
		expect(one).not.toContain('data-testid="session-insights-selection-swap"');
	});

	test("two ticks name A and B in tick order with a swap; Compare is on", () => {
		const two = bar(selected(picks("s2", "s1")));
		expect(text(two)).toContain("2 sessions selected");
		const chips = [
			...two.matchAll(
				/data-testid="session-insights-selection-chip" data-side="([ab])" data-session-id="([^"]+)"/g,
			),
		].map((match) => `${match[1]}:${match[2]}`);
		expect(chips).toEqual(["a:s2", "b:s1"]);
		expect(text(two)).toContain("Session s2");
		expect(text(two)).toContain("9 calls");
		expect(two).toContain('data-testid="session-insights-selection-swap"');
		expect(two).not.toContain('data-testid="session-insights-selection-hint"');
		expect(two).not.toContain('data-testid="session-insights-selection-compare" disabled=""');
		expect(text(two)).toContain("Clear");
		expect(text(two)).toContain("Esc");
	});

	test("three or more disable Compare and ask for exactly two", () => {
		const three = bar(selected(picks("s1", "s2", "s3")));
		expect(text(three)).toContain("3 sessions selected");
		expect(text(three)).toContain("Pick exactly two");
		expect(three).not.toContain('data-testid="session-insights-selection-chip"');
		expect(three).toMatch(/data-testid="session-insights-selection-compare" disabled=""/);
	});

	test("the bar names picks the current filter, search or scope hides", () => {
		const markup = selected(picks("gone", "s1"), [sessionRow("s1")]);
		expect(rowsOf(markup)).toHaveLength(1);
		expect(text(bar(markup))).toContain("Session gone");
	});

	test("Compare opens the A ↔ B tab of exactly two picks, A first, named after both", () => {
		const opened: unknown[] = [];
		const host = panelHost({
			openPanel: (panel, params, title) => opened.push([panel, params, title]),
		});
		const t = currentTranslator();
		expect(openPicked(host, t, picks("s2", "s1"))).toBe(true);
		expect(openPicked(host, t, picks("s1"))).toBe(false);
		expect(openPicked(host, t, picks("s1", "s2", "s3"))).toBe(false);
		expect(opened).toEqual([["compare", { a: "s2", b: "s1" }, "Session s2 ↔ Session s1"]]);
	});
});

describe("the list's view state", () => {
	test("a tab brought back reopens on its saved tab, Insights section and scope", () => {
		const markup = html(
			<SessionsPanel
				host={panelHost({
					viewState: { tab: "insights", scope: "all", stats: { section: "usage" } },
				})}
				params={{}}
			/>,
		);
		expect(tabOf(markup, "insights")).toContain('aria-selected="true"');
		expect(markup).toMatch(
			/role="tab"[^>]*aria-selected="true"[^>]*data-testid="stats-section-usage"/,
		);
		expect(markup).toMatch(/data-testid="session-insights-scope-all" data-active="true"/);
	});

	test("ticks come back with the tab", () => {
		const markup = html(
			<SessionsPanel host={panelHost({ viewState: { picks: picks("s1", "s2") } })} params={{}} />,
		);
		expect(text(bar(markup))).toContain("2 sessions selected");
	});

	test("another panel's request picks the tab and section over the saved view", () => {
		const intent = { tab: "insights", section: "findings" } as const;
		requestListView(intent);
		try {
			const markup = html(
				<SessionsPanel
					host={panelHost({ viewState: { tab: "days", stats: { section: "hotspots" } } })}
					params={{}}
				/>,
			);
			expect(tabOf(markup, "insights")).toContain('aria-selected="true"');
			expect(markup).toMatch(
				/role="tab"[^>]*aria-selected="true"[^>]*data-testid="stats-section-findings"/,
			);
		} finally {
			settleListView(intent);
		}
	});
});
