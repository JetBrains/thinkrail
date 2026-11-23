import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type { Origin, SessionListRow } from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FigureDetails } from "./FigureCell";
import { figure, listResult, PROJECTS, SOURCES, START, sessionRow } from "./fixtures.test";
import { API_VERSION } from "./load";
import SessionsPanel, { type ListView, SessionsView } from "./SessionsPanel";

const noop = () => {};

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

describe("the list's day view", () => {
	test("a view switch beside the scope swaps the table for the day strip", () => {
		const table = html(
			<SessionsView
				view={ready([sessionRow("s1")])}
				scopeKind="project"
				busy={false}
				onScope={noop}
				onRefresh={noop}
				onOpen={noop}
				onAnalyse={noop}
				mode="table"
				onMode={noop}
				day={<div data-testid="day-slot" />}
			/>,
		);
		expect(table).toMatch(/data-testid="session-insights-mode-table" aria-pressed="true"/);
		expect(table).toContain('data-testid="session-insights-table"');
		expect(table).not.toContain('data-testid="day-slot"');
		const day = html(
			<SessionsView
				view={ready([sessionRow("s1")])}
				scopeKind="project"
				busy={false}
				onScope={noop}
				onRefresh={noop}
				onOpen={noop}
				onAnalyse={noop}
				mode="day"
				onMode={noop}
				day={<div data-testid="day-slot" />}
			/>,
		);
		expect(day).toContain('data-testid="day-slot"');
		expect(day).not.toContain('data-testid="session-insights-table"');
		expect(day).toContain('data-testid="session-insights-scope-all"');
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
			onMode: noop,
			searchBox: <div data-testid="search-box-slot" />,
			search: <div data-testid="search-slot" />,
			onSearchKey: noop,
		};
		const table = html(<SessionsView {...props} mode="table" />);
		expect(table).toMatch(/role="toolbar"[\s\S]*data-testid="search-box-slot"/);
		expect(table).toContain('data-testid="session-insights-table"');
		expect(table).not.toContain('data-testid="search-slot"');
		const results = html(<SessionsView {...props} mode="search" />);
		expect(results).toContain('data-testid="search-slot"');
		expect(results).toContain('data-testid="search-box-slot"');
		expect(results).not.toContain('data-testid="session-insights-table"');
		expect(results).toMatch(/data-testid="session-insights-mode-table" aria-pressed="false"/);
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

	test("one roving tab stop enters the table; the name, the analysis, the comparison and every figure are buttons the arrows reach", () => {
		const markup = view(ready([sessionRow("s1"), sessionRow("s2")]));
		const body = markup.slice(markup.indexOf("<tbody>"));
		expect(body.match(/tabindex="0"/g)).toHaveLength(1);
		expect(body).toMatch(
			/<button type="button" data-grid-key="session:s1" data-grid-row="0" data-grid-col="0" tabindex="0"/,
		);
		const [first = "", second = ""] = rowsOf(markup);
		expect(first.match(/<button type="button" data-grid-key="session:s1"/g)).toHaveLength(8);
		expect(first).toContain('data-testid="session-insights-open-analysis"');
		expect(first).toContain('data-testid="session-insights-compare"');
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
