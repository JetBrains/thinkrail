import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import type { LabelsGetResult, TraceEvent } from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runExport } from "../export/api";
import { cutOptions, ExportMenu, ExportOptions, ExportOutcome } from "../export/ExportMenu";
import { listResult, START, sessionRow } from "../fixtures.test";
import { SessionsView, sessionsLabelled } from "../SessionsPanel";
import { SessionsTable } from "../SessionsTable";
import { VersionSkew } from "../session/api";
import { exportContext } from "../session/SessionPanel";
import { llm, T0, tool, turn } from "../trace/events.test";
import { loadLabels, saveLabels } from "./api";
import { LabelChips, LabelsButton } from "./LabelsEditor";

const noop = () => {};
const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const t = currentTranslator();

function host(
	answer: (method: string, params: unknown) => unknown,
	seen: unknown[] = [],
): PanelHost {
	return {
		query: async (method, params) => {
			seen.push([method, params]);
			return answer(method, params);
		},
		openChat: noop,
		openPanel: noop,
		renderToolCall: () => null,
		openFile: noop,
		openWorkspace: () => {},
		peek: () => {},
		onEvent: () => () => {},
		openArtifacts: noop,
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: 128,
		hostApiVersion: 10,
	};
}

const LABELS: LabelsGetResult = {
	apiVersion: 10,
	sessions: [
		{ sessionId: "s1", labels: ["good", "login"], note: null, noted: true },
		{ sessionId: "s2", labels: ["Good"], note: null, noted: false },
	],
	vocabulary: [
		{ label: "good", sessions: 2 },
		{ label: "login", sessions: 1 },
	],
};

describe("labels in the list", () => {
	test("chips show the first labels, then how many more", () => {
		const markup = html(<LabelChips labels={["a", "b", "c", "d", "e"]} />);
		expect(markup.match(/data-testid="session-insights-label"/g)).toHaveLength(3);
		expect(markup).toContain("+2");
		expect(
			html(<LabelChips labels={["a", "b", "c", "d"]} all />).match(/session-insights-label"/g),
		).toHaveLength(4);
		expect(html(<LabelChips labels={[]} />)).toBe("");
	});

	test("a labelled table puts the labels editor before the figures in the row's grid", () => {
		const labelsOf = new Map(LABELS.sessions.map((entry) => [entry.sessionId, entry.labels]));
		const markup = html(
			<SessionsTable
				result={listResult([sessionRow("s1"), sessionRow("s3")])}
				grouped={false}
				now={START}
				onOpen={noop}
				onAnalyse={noop}
				compare={{ from: null, onCompare: noop, onCancel: noop }}
				labels={{
					of: (sessionId) => labelsOf.get(sessionId) ?? [],
					edit: (row, cell) => (
						<LabelsButton
							host={host(() => LABELS)}
							sessionId={row.sessionId}
							labels={labelsOf.get(row.sessionId) ?? []}
							noted={row.sessionId === "s1"}
							vocabulary={LABELS.vocabulary}
							data-grid-key={cell.key}
							data-grid-row={cell.row}
							data-grid-col={cell.col}
							tabIndex={cell.tabIndex}
						/>
					),
				}}
			/>,
		);
		const [first = "", second = ""] = markup.split('data-testid="session-insights-row"').slice(1);
		expect(first.match(/data-testid="session-insights-label"/g)).toHaveLength(2);
		expect(first).toContain(">login<");
		expect(first).toMatch(
			/aria-label="Labels and note"[^>]*data-testid="session-insights-labels"[^>]*data-grid-col="3"/,
		);
		expect([...first.matchAll(/data-grid-col="(\d+)"/g)].map((match) => match[1])).toEqual([
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
			"10",
		]);
		expect(second).not.toContain('data-testid="session-insights-label"');
	});

	test("the label filter sits in the toolbar with the table only, and keeps sessions by label", () => {
		const ready = {
			kind: "ready",
			result: listResult([sessionRow("s1")]),
			receivedAt: START,
		} as const;
		const shown = (mode: "table" | "day") =>
			html(
				<SessionsView
					view={ready}
					scopeKind="project"
					busy={false}
					onScope={noop}
					onRefresh={noop}
					onOpen={noop}
					onAnalyse={noop}
					mode={mode}
					onMode={noop}
					day={<span />}
					labelFilter={<span data-testid="label-filter-slot" />}
				/>,
			);
		expect(shown("table")).toContain('data-testid="label-filter-slot"');
		expect(shown("day")).not.toContain('data-testid="label-filter-slot"');
		expect([...sessionsLabelled(LABELS, "GOOD")].sort()).toEqual(["s1", "s2"]);
		expect([...sessionsLabelled(LABELS, "login")]).toEqual(["s1"]);
		expect(sessionsLabelled(null, "good").size).toBe(0);
	});

	test("labels.get and labels.set travel through the host and refuse another payload version", async () => {
		const seen: unknown[] = [];
		expect(
			await loadLabels(
				host(() => LABELS, seen),
				["s1"],
			),
		).toBe(LABELS);
		expect(seen).toEqual([["labels.get", { sessionIds: ["s1"] }]]);
		await expect(
			loadLabels(
				host(() => ({ ...LABELS, apiVersion: 8 })),
				null,
			),
		).rejects.toBeInstanceOf(VersionSkew);
		const saved = { apiVersion: 10, ok: false, code: "LABELS_FULL" } as const;
		expect(
			await saveLabels(
				host(() => saved),
				{ sessionId: "s1", labels: [], note: null },
			),
		).toEqual(saved);
	});
});

const EVENTS: TraceEvent[] = [
	{ ...turn("t1", 1, T0), label: "Fix it" },
	llm("l1", "t1", T0, T0 + 1),
	tool("x1", "l1", T0 + 1, T0 + 2),
	{ ...turn("t2", 2, T0 + 5), label: "Docs" },
	tool("child:k/x", "x1", T0 + 1, T0 + 2, { label: "grep" }),
];

describe("the export menu", () => {
	test("offers each turn's end, defaults to the selection's turn and a cut right after a selected step", () => {
		expect(exportContext(EVENTS, "x1")).toEqual({
			turns: [
				{ n: 1, label: "Fix it" },
				{ n: 2, label: "Docs" },
			],
			defaultTurn: 1,
			selectedEvent: { id: "x1", label: "bun test" },
		});
		expect(exportContext(EVENTS, null)).toMatchObject({ defaultTurn: 2, selectedEvent: null });
		expect(exportContext(EVENTS, "t2").selectedEvent).toBeNull();
		expect(exportContext(EVENTS, "child:k/x").selectedEvent).toBeNull();
		const cuts = cutOptions(t, exportContext(EVENTS, "x1").turns, { id: "x1", label: "bun test" });
		expect(cuts.map((cut) => cut.value)).toEqual(["turn:1", "turn:2", "event:x1"]);
		expect(cuts.map((cut) => cut.label)).toEqual([
			"The end of turn 1 · Fix it",
			"The end of turn 2 · Docs",
			"Right after the selected step · bun test",
		]);
	});

	test("the trigger is one Export button; the options name the cut, keep labels off and say masking is best effort", () => {
		expect(
			html(
				<ExportMenu
					host={host(() => null)}
					sessionId="s1"
					turns={[]}
					defaultTurn={null}
					selectedEvent={null}
				/>,
			),
		).toMatch(/data-testid="session-insights-export"[^>]*>.*Export/);
		const fixture = html(
			<ExportOptions
				kind="fixture"
				cuts={cutOptions(t, [{ n: 1, label: "Fix it" }], null)}
				cut="turn:1"
				onCut={noop}
				name=""
				onName={noop}
				includeLabels={false}
				onIncludeLabels={noop}
				running={false}
			/>,
		);
		expect(fixture).toContain('data-testid="session-insights-export-cut"');
		expect(fixture).toMatch(/<option value="turn:1" selected="">/);
		expect(fixture).toMatch(/data-testid="session-insights-export-labels"(?![^>]*checked)/);
		expect(fixture).toContain('data-testid="session-insights-export-masking"');
		expect(fixture).not.toContain('data-testid="session-insights-export-progress"');
		const html_ = html(
			<ExportOptions
				kind="html"
				cuts={[]}
				cut=""
				onCut={noop}
				name=""
				onName={noop}
				includeLabels
				onIncludeLabels={noop}
				running
			/>,
		);
		expect(html_).not.toContain('data-testid="session-insights-export-cut"');
		expect(html_).toContain('data-testid="session-insights-export-progress"');
		expect(html_).toMatch(/data-testid="session-insights-export-labels"[^>]*checked/);
	});

	test("an outcome shows the written path and notes, or the coded failure with what the check found", () => {
		const done = html(
			<ExportOutcome
				kind="trace"
				phase={{
					kind: "done",
					result: {
						apiVersion: 10,
						ok: true,
						kind: "trace",
						path: ".thinkrail/context/session-insights/a.trace.json",
						files: 1,
						bytes: 2048,
						notes: ["childrenMissing"],
					},
				}}
			/>,
		);
		expect(done).toContain(".thinkrail/context/session-insights/a.trace.json");
		expect(done).toMatch(/data-testid="session-insights-export-note" data-note="childrenMissing"/);
		expect(done).toContain("Perfetto UI");
		const failed = html(
			<ExportOutcome
				kind="html"
				phase={{
					kind: "failed",
					result: {
						apiVersion: 10,
						ok: false,
						kind: "html",
						code: "CHECK_FAILED",
						found: ["email", "homePath"],
						detail: "email, homePath",
					},
				}}
			/>,
		);
		expect(failed).toContain('role="alert"');
		expect(failed).toContain("an email address, a home folder path");
		expect(failed).toContain(">CHECK_FAILED<");
		expect(html(<ExportOutcome kind="html" phase={{ kind: "broken", version: true }} />)).toContain(
			"Update ThinkRail",
		);
	});

	test("runExport writes into the panel's own workspace and refuses another payload version", async () => {
		const seen: unknown[] = [];
		const answer = {
			apiVersion: 10,
			ok: true,
			kind: "fixture",
			path: "p/",
			files: 2,
			bytes: 3,
			notes: [],
		};
		await runExport(
			host(() => answer, seen),
			{
				kind: "fixture",
				sessionId: "s1",
				includeLabels: false,
				cut: { kind: "turn", turn: 2 },
				name: "x",
			},
		);
		await runExport(
			host(() => answer, seen),
			{ kind: "html", sessionId: "s1", includeLabels: true, name: "x" },
		);
		expect(seen).toEqual([
			[
				"export.fixture",
				{
					sessionId: "s1",
					workspaceId: "w1",
					includeLabels: false,
					cut: { kind: "turn", turn: 2 },
					name: "x",
				},
			],
			["export.html", { sessionId: "s1", workspaceId: "w1", includeLabels: true }],
		]);
		await expect(
			runExport(
				host(() => ({ apiVersion: 8, ok: true })),
				{ kind: "trace", sessionId: "s1", includeLabels: false },
			),
		).rejects.toBeInstanceOf(VersionSkew);
	});
});
