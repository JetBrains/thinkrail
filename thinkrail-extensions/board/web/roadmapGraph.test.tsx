import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Card } from "./api";
import {
	boardOf,
	cardOf,
	edgeOf,
	fakeHost,
	initiativeOf,
	liveOf,
	rollupOf,
	scheduleOf,
	viewOf,
} from "./fixtures.test";
import {
	applyDrag,
	dragCommit,
	linkFromGraph,
	linkRefusal,
	unlinkFromGraph,
	unpinFromGraph,
} from "./graphEdits";
import RoadmapFlow from "./RoadmapFlow";
import type { RoadmapProject, ScheduleNode } from "./roadmapApi";
import {
	canDrag,
	dayOfIso,
	edgeLook,
	GRAPH,
	isoOfDay,
	mondays,
	NODE_LOOKS,
	nodeLook,
	nodeStatus,
	packRows,
	scopeMembers,
	stepGraphLayout,
	TIMELINE,
	timelineLayout,
	xOfDay,
} from "./roadmapGraph";

const TODAY = dayOfIso("2026-11-18");
const PX = 40;

function nodeOf(overrides: Partial<ScheduleNode> & { id: string }): ScheduleNode {
	return {
		kind: "card",
		lane: null,
		start: TODAY,
		end: TODAY + 3,
		slack: 0,
		critical: false,
		conflict: false,
		pinned: false,
		done: false,
		...overrides,
	};
}

const projects: RoadmapProject[] = [
	{
		id: "P-1",
		initiativeId: "I-1",
		title: "Board UI",
		milestones: [{ id: "M-1", title: "Usable" }],
	},
	{ id: "P-2", title: "Roadmap", milestones: [] },
];

const cards: Card[] = [
	cardOf({ id: "TR-1", title: "Design", category: "completed", roadmapProjectId: "P-1" }),
	cardOf({
		id: "TR-2",
		title: "Build",
		category: "started",
		roadmapProjectId: "P-1",
		live: [liveOf({ chat: { state: "needs_you", unread: false, title: "Build" } })],
	}),
	cardOf({ id: "TR-3", title: "Polish", category: "unstarted", roadmapProjectId: "P-1" }),
	cardOf({ id: "TR-4", title: "Forecast", category: "triage", roadmapProjectId: "P-2" }),
	cardOf({ id: "TR-5", title: "Loose end", category: "backlog", blocks: ["TR-3"] }),
];

const schedule = scheduleOf({
	today: TODAY,
	nodes: [
		nodeOf({ id: "TR-1", lane: "P-1", start: TODAY - 6, end: TODAY - 2, done: true }),
		nodeOf({ id: "TR-2", lane: "P-1", start: TODAY - 2, end: TODAY + 2, critical: true }),
		nodeOf({ id: "TR-5", start: TODAY, end: TODAY + 1, slack: 1 }),
		nodeOf({
			id: "TR-3",
			lane: "P-1",
			start: TODAY + 1,
			end: TODAY + 4,
			critical: true,
			pinned: true,
			conflict: true,
		}),
		nodeOf({ id: "TR-4", lane: "P-2", start: TODAY, end: TODAY + 6, slack: 2.5 }),
		nodeOf({ id: "M-1", kind: "milestone", lane: "P-1", start: TODAY + 4, end: TODAY + 4 }),
	],
	edges: [
		edgeOf("TR-1", "TR-2"),
		edgeOf("TR-2", "TR-3", { critical: true }),
		edgeOf("TR-5", "TR-3", { conflict: true }),
		edgeOf("TR-3", "M-1", { critical: true }),
	],
});

const initiative = initiativeOf({
	id: "I-1",
	title: "Planning surface",
	memberCardIds: ["TR-1", "TR-2", "TR-3"],
	target: "2026-11-30",
	createdAt: (TODAY - 10) * 86_400_000,
});
const view = viewOf([initiative], {
	projects,
	schedule,
	critical: { "I-1": ["TR-3", "M-1"] },
	rollups: {
		initiatives: { "I-1": rollupOf({ completed: 1, started: 1, unstarted: 2 }) },
		projects: {},
		milestones: {},
	},
});
const board = boardOf(cards);

describe("the step graph's layout", () => {
	test("maps days to x with today at 0, ISO dates to day numbers, and Mondays to the week grid", () => {
		expect(xOfDay(TODAY, TODAY, PX)).toBe(0);
		expect(xOfDay(TODAY + 2.5, TODAY, PX)).toBe(100);
		expect(xOfDay(TODAY - 1, TODAY, 16)).toBe(-16);
		expect(isoOfDay(TODAY + 1.7)).toBe("2026-11-19");
		expect(dayOfIso(isoOfDay(TODAY))).toBe(TODAY);
		const weeks = mondays(TODAY - 7, TODAY + 7);
		expect(weeks.map(isoOfDay)).toEqual(["2026-11-16", "2026-11-23"]);
	});

	test("pack overlapping intervals into new rows and reuse a row once it is free", () => {
		const { rows, count } = packRows([
			{ id: "a", x0: 0, x1: 100 },
			{ id: "b", x0: 50, x1: 120 },
			{ id: "c", x0: 100, x1: 160 },
			{ id: "d", x0: 110, x1: 130 },
		]);
		expect([...rows]).toEqual([
			["a", 0],
			["b", 1],
			["c", 0],
			["d", 2],
		]);
		expect(count).toBe(3);
		expect(packRows([]).count).toBe(1);
	});

	test("lay cards out by time in their projects' lanes, then No project, each lane's rows packed", () => {
		const layout = stepGraphLayout(view, board, null, PX);
		expect(layout.lanes.map((lane) => [lane.id, lane.title])).toEqual([
			["P-1", "Board UI"],
			["P-2", "Roadmap"],
			[null, null],
		]);
		const [first, second, third] = layout.lanes;
		expect(first?.top).toBe(GRAPH.header);
		expect(second?.top).toBe(GRAPH.header + (first?.height ?? 0));
		expect(third?.top).toBe((second?.top ?? 0) + (second?.height ?? 0));
		const byId = new Map(layout.nodes.map((node) => [node.id, node]));
		expect(byId.get("TR-2")?.x).toBe(-2 * PX);
		expect(byId.get("TR-2")?.width).toBe(4 * PX);
		expect(byId.get("TR-5")?.width).toBe(GRAPH.minWidth);
		expect(byId.get("M-1")?.x).toBe(4 * PX - GRAPH.milestone / 2);
		expect(byId.get("TR-1")?.y).toBe(GRAPH.header + GRAPH.laneTop);
		expect(byId.get("TR-2")?.y).toBe(GRAPH.header + GRAPH.laneTop + GRAPH.row);
		expect(byId.get("TR-3")?.y).toBe(GRAPH.header + GRAPH.laneTop);
		expect(byId.get("M-1")?.y).toBe(
			GRAPH.header + GRAPH.laneTop + GRAPH.row + (GRAPH.node - GRAPH.milestone) / 2,
		);
		expect(first?.height).toBe(GRAPH.laneTop + 2 * GRAPH.row);
		expect(layout.height).toBe((third?.top ?? 0) + (third?.height ?? 0));
		expect(layout.day0).toBeLessThanOrEqual(TODAY - 7);
		expect(layout.day1).toBeGreaterThanOrEqual(TODAY + 21);
		expect(layout.milestones.map((node) => node.id)).toEqual(["M-1"]);
		expect(layout.criticalPath).toEqual(["TR-2", "TR-3"]);
	});

	test("carry each card's status, slack, pin, conflict, drag and wait, and each link's critical and conflict", () => {
		const layout = stepGraphLayout(view, board, null, PX);
		const byId = new Map(layout.nodes.map((node) => [node.id, node]));
		expect(layout.nodes.map((node) => [node.id, node.status, node.draggable])).toEqual([
			["TR-1", "done", false],
			["TR-2", "waiting", false],
			["TR-5", "backlog", true],
			["TR-3", "ready", true],
			["TR-4", "triage", true],
			["M-1", "backlog", false],
		]);
		expect(byId.get("TR-4")?.slack).toBe(2.5);
		expect(byId.get("TR-2")?.slack).toBeNull();
		expect(byId.get("TR-3")).toMatchObject({ pinned: true, conflict: true, critical: true });
		expect(byId.get("TR-2")?.wait).toBe(2 * PX);
		expect(byId.get("TR-3")?.wait).toBe(0);
		expect(layout.edges).toEqual([
			{
				id: "TR-1->TR-2",
				from: "TR-1",
				to: "TR-2",
				critical: false,
				conflict: false,
				deletable: true,
			},
			{
				id: "TR-2->TR-3",
				from: "TR-2",
				to: "TR-3",
				critical: true,
				conflict: false,
				deletable: true,
			},
			{
				id: "TR-5->TR-3",
				from: "TR-5",
				to: "TR-3",
				critical: false,
				conflict: true,
				deletable: true,
			},
			{
				id: "TR-3->M-1",
				from: "TR-3",
				to: "M-1",
				critical: true,
				conflict: false,
				deletable: false,
			},
		]);
	});

	test("narrow to an initiative's cards and its projects' milestones, with its own critical path", () => {
		expect([...(scopeMembers(view, "I-1") ?? [])]).toEqual(["TR-1", "TR-2", "TR-3", "M-1"]);
		expect(scopeMembers(view, null)).toBeNull();
		const layout = stepGraphLayout(view, board, "I-1", PX);
		expect(layout.nodes.map((node) => node.id)).toEqual(["TR-1", "TR-2", "TR-3", "M-1"]);
		expect(layout.lanes.map((lane) => lane.id)).toEqual(["P-1"]);
		expect(layout.nodes.filter((node) => node.critical).map((node) => node.id)).toEqual([
			"TR-3",
			"M-1",
		]);
		expect(layout.edges.map((edge) => [edge.id, edge.critical])).toEqual([
			["TR-1->TR-2", false],
			["TR-2->TR-3", false],
			["TR-3->M-1", true],
		]);
	});
});

describe("the step graph's looks", () => {
	test("read a card's status from its category and its agent", () => {
		expect(nodeStatus(cardOf({ category: "completed" }))).toBe("done");
		expect(nodeStatus(cardOf({ category: "started", live: [liveOf()] }))).toBe("working");
		expect(
			nodeStatus(
				cardOf({ live: [liveOf({ chat: { state: "failed", unread: false, title: "x" } })] }),
			),
		).toBe("failed");
		expect(nodeStatus(cardOf({ category: "review" }))).toBe("started");
		expect(nodeStatus(cardOf({ category: "triage" }))).toBe("triage");
		expect(nodeStatus(cardOf({ category: "unstarted" }))).toBe("ready");
		expect(nodeStatus(cardOf({ category: "backlog" }))).toBe("backlog");
		expect(canDrag(cardOf({ category: "unstarted" }), "ready")).toBe(true);
		expect(canDrag(cardOf({ category: "backlog" }), "working")).toBe(false);
		expect(canDrag(cardOf({ category: "started" }), "started")).toBe(false);
		expect(canDrag(undefined, "backlog")).toBe(false);
	});

	test("map each status to its border, and add conflict, critical and selection", () => {
		expect(NODE_LOOKS.done).toContain("opacity-60");
		expect(NODE_LOOKS.working).toBe("border-primary");
		expect(NODE_LOOKS.waiting).toBe("border-feedback-warning");
		expect(NODE_LOOKS.failed).toBe("border-feedback-error");
		expect(NODE_LOOKS.triage).toBe("border-dashed border-series-3");
		expect(nodeLook({ status: "ready", critical: true, conflict: false }, false)).toBe(
			"border-border-default ring-1 ring-feedback-warning",
		);
		expect(nodeLook({ status: "ready", critical: true, conflict: true }, true)).toBe(
			"border-border-default border-feedback-error ring-2 ring-primary",
		);
		expect(edgeLook({ critical: true, conflict: false }, false).stroke).toContain(
			"stroke-feedback-warning",
		);
		expect(edgeLook({ critical: true, conflict: true }, false).stroke).toContain(
			"stroke-feedback-error",
		);
		expect(edgeLook({ critical: false, conflict: false }, true).fill).toBe("fill-primary");
	});
});

describe("the step graph's edits", () => {
	test("a drop pins the day it snapped to, Shift moves the chain by the days moved, the same day is none", () => {
		const node = { start: TODAY + 1.5 };
		expect(dragCommit(node, { today: TODAY, px: PX, x: 2 * PX, shift: false })).toEqual({
			kind: "none",
		});
		expect(dragCommit(node, { today: TODAY, px: PX, x: 5 * PX, shift: false })).toEqual({
			kind: "pin",
			start: "2026-11-23",
		});
		expect(dragCommit(node, { today: TODAY, px: PX, x: 5 * PX, shift: true })).toEqual({
			kind: "shift",
			days: 4,
		});
		expect(dragCommit({ start: TODAY }, { today: TODAY, px: 16, x: -32, shift: true })).toEqual({
			kind: "shift",
			days: -2,
		});
	});

	test("send card.pin, card.shiftChain and card.unpin, and say what changed", async () => {
		const fake = fakeHost();
		expect(await applyDrag(fake.host, { id: "TR-3" }, { kind: "none" })).toBeNull();
		const pinned = await applyDrag(fake.host, { id: "TR-3" }, { kind: "pin", start: "2026-11-23" });
		const shifted = await applyDrag(fake.host, { id: "TR-3" }, { kind: "shift", days: 2 });
		const unpinned = await unpinFromGraph(fake.host, "TR-3");
		expect(fake.queries).toEqual([
			{ method: "card.pin", params: { cardId: "TR-3", start: "2026-11-23" } },
			{ method: "card.shiftChain", params: { cardId: "TR-3", days: 2 } },
			{ method: "card.unpin", params: { cardId: "TR-3" } },
		]);
		expect(pinned?.key).toBe("board.roadmap.graph.notice.pinned");
		expect(shifted).toMatchObject({
			key: "board.roadmap.graph.notice.shifted",
			values: { days: "+2" },
		});
		expect(unpinned.key).toBe("board.roadmap.graph.notice.unpinned");
	});

	test("a drawn connection links two cards, refuses a cycle in place and skips one already there", async () => {
		expect(linkRefusal(board, "TR-3", "TR-5")).toBe("cycle");
		expect(linkRefusal(board, "TR-5", "TR-3")).toBe("present");
		expect(linkRefusal(board, "TR-1", "TR-1")).toBe("self");
		expect(linkRefusal(board, "TR-1", "M-1")).toBe("not-card");
		expect(linkRefusal(board, "TR-1", "TR-4")).toBeNull();
		const fake = fakeHost();
		const refused = await linkFromGraph(fake.host, board, "TR-3", "TR-5");
		expect(refused).toMatchObject({ tone: "error", key: "board.roadmap.graph.notice.cycle" });
		expect(await linkFromGraph(fake.host, board, "TR-5", "TR-3")).toBeNull();
		const linked = await linkFromGraph(fake.host, board, "TR-1", "TR-4");
		expect(linked).toMatchObject({ tone: "info", values: { from: "TR-1", to: "TR-4" } });
		expect(fake.queries).toEqual([{ method: "card.link", params: { from: "TR-1", to: "TR-4" } }]);
	});

	test("Delete unlinks each blocks link and leaves a card's edge to its milestone", async () => {
		const fake = fakeHost();
		const notice = await unlinkFromGraph(fake.host, [
			{ from: "TR-2", to: "TR-3", deletable: true },
			{ from: "TR-3", to: "M-1", deletable: false },
		]);
		expect(fake.queries).toEqual([{ method: "card.unlink", params: { from: "TR-2", to: "TR-3" } }]);
		expect(notice?.key).toBe("board.roadmap.graph.notice.unlinked");
		expect(
			await unlinkFromGraph(fake.host, [{ from: "TR-3", to: "M-1", deletable: false }]),
		).toBeNull();
	});
});

describe("the timeline's layout", () => {
	const other = initiativeOf({
		id: "I-2",
		title: "Insights",
		memberCardIds: ["TR-4"],
		createdAt: TODAY * 86_400_000,
	});
	const withForecast = viewOf([initiative, other], {
		projects,
		schedule: scheduleOf({ ...schedule, edges: [...schedule.edges, edgeOf("TR-3", "TR-4")] }),
		forecast: {
			"I-1": { status: "ok", p50: "2026-11-28", p85: "2026-12-04", p50Weeks: 2, p85Weeks: 3 },
			"I-2": { status: "insufficient", reason: "history" },
		},
		rollups: view.rollups,
	});

	test("draw an initiative's bar from its cards' start to its target, filled as done, with its forecast band", () => {
		const layout = timelineLayout(withForecast, PX, new Set());
		const [first, second] = layout.rows;
		expect(layout.rows.map((row) => [row.kind, row.id])).toEqual([
			["initiative", "I-1"],
			["initiative", "I-2"],
		]);
		expect(first?.bar).toEqual({ start: TODAY - 6, end: dayOfIso("2026-11-30") });
		expect(first?.done).toBe(0.25);
		expect(first?.band).toEqual({ p50: dayOfIso("2026-11-28"), p85: dayOfIso("2026-12-04") });
		expect(first?.target).toBe(dayOfIso("2026-11-30"));
		expect(first?.x).toBe(xOfDay(TODAY - 6, TODAY, PX));
		expect(first?.width).toBe((dayOfIso("2026-12-04") - (TODAY - 6)) * PX);
		expect(first?.y).toBe(TIMELINE.header);
		expect(first?.projects).toBe(1);
		expect(second).toMatchObject({ band: null, insufficient: true, target: null });
		expect(second?.bar).toEqual({ start: TODAY, end: TODAY + 6 });
		expect(second?.y).toBe(TIMELINE.header + TIMELINE.row);
		expect(layout.edges).toEqual([{ id: "I-1->I-2", from: "I-1", to: "I-2" }]);
	});

	test("unfold an initiative's projects under it with their cards' span and milestones", () => {
		const layout = timelineLayout(withForecast, PX, new Set(["I-1"]));
		expect(layout.rows.map((row) => [row.kind, row.id, row.depth])).toEqual([
			["initiative", "I-1", 0],
			["project", "P-1", 1],
			["initiative", "I-2", 0],
		]);
		const project = layout.rows[1];
		expect(project?.bar).toEqual({ start: TODAY - 6, end: TODAY + 4 });
		expect(project?.milestones).toEqual([
			{ id: "M-1", title: "Usable", day: TODAY + 4, late: false },
		]);
		expect(project?.initiativeId).toBe("I-1");
		expect(layout.rows[0]?.expanded).toBe(true);
	});
});

const html = (node: ReactNode) => renderToStaticMarkup(node);

describe("the rendered views", () => {
	test("the step graph draws a node per card and milestone, the links and the forecast dates", () => {
		const markup = html(
			<RoadmapFlow
				host={fakeHost().host}
				view={view}
				board={board}
				kind="graph"
				layout="columns"
				onError={() => {}}
				onReload={() => {}}
			/>,
		);
		expect(markup).toContain('data-testid="board-graph"');
		expect(markup.match(/data-testid="board-graph-node"/g)?.length).toBe(5);
		expect(markup.match(/data-testid="board-graph-milestone"/g)?.length).toBe(1);
		expect(markup).toContain('data-card-id="TR-3" data-status="ready" data-critical="true"');
		expect(markup).toContain('data-testid="board-graph-pin"');
		expect(markup).toContain('data-testid="board-graph-wait"');
		expect(markup).toContain('data-testid="board-graph-kpi" data-milestone-id="M-1"');
		expect(markup).toContain("Critical path: TR-2 → TR-3");
		expect(markup).toContain('data-testid="board-graph-legend"');
	});

	test("the timeline draws a bar per initiative and says when there is not enough data", () => {
		const markup = html(
			<RoadmapFlow
				host={fakeHost().host}
				view={view}
				board={board}
				kind="timeline"
				layout="columns"
				onError={() => {}}
				onReload={() => {}}
			/>,
		);
		expect(markup).toContain('data-testid="board-timeline"');
		expect(markup).toContain(
			'data-testid="board-timeline-row" data-kind="initiative" data-row-id="I-1"',
		);
		expect(markup).toContain('data-testid="board-timeline-bar"');
		expect(markup).toContain('data-testid="board-timeline-insufficient"');
	});
});
