import { describe, expect, test } from "bun:test";
import type { PanelChatTarget } from "@thinkrail/extension-api/web";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setCardInitiative } from "./CardRoadmap";
import { CardTile } from "./CardTile";
import {
	cardOf,
	edgeOf,
	fakeHost,
	initiativeOf,
	rollupOf,
	scheduleOf,
	viewOf,
} from "./fixtures.test";
import { InitiativeDetails } from "./InitiativePanel";
import { dayText } from "./labels";
import { GoalsView, HorizonsView, InitiativeCard, type RoadmapActions } from "./Roadmap";
import {
	acceptInitiative,
	appetiteUsed,
	assignCard,
	deleteInitiative,
	goalGroups,
	horizonColumns,
	horizonMove,
	initiativeDependencies,
	initiativePeekEntry,
	isRoadmapView,
	moveInitiative,
	openRoadmapChat,
	parentOptions,
	rollupBar,
	updateInitiative,
} from "./roadmapApi";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const noop = () => {};
const ACTIONS: RoadmapActions = {
	open: noop,
	create: async () => {},
	move: noop,
	accept: noop,
	discard: noop,
};

const goal = initiativeOf({ id: "I-1", title: "Agents without losing control", horizon: "later" });
const child = initiativeOf({
	id: "I-2",
	parentId: "I-1",
	title: "Planning surface",
	horizon: "now",
	rank: 3,
	depth: 1,
	memberCardIds: ["TR-1", "TR-2"],
});
const grandchild = initiativeOf({
	id: "I-3",
	parentId: "I-2",
	title: "Board inbox",
	horizon: "now",
	rank: 2,
	depth: 2,
	memberCardIds: ["TR-2"],
});
const other = initiativeOf({
	id: "I-4",
	title: "OpenSpec",
	horizon: "next",
	rank: 4,
	memberCardIds: ["TR-9"],
});
const tree = [goal, child, grandchild, other];

describe("the roadmap's derivations", () => {
	test("put every initiative on its horizon by rank, with its goal and a parent between them", () => {
		const columns = horizonColumns(viewOf(tree));
		expect(columns.now.map((entry) => entry.initiative.id)).toEqual(["I-3", "I-2"]);
		expect(columns.next.map((entry) => entry.initiative.id)).toEqual(["I-4"]);
		expect(columns.later.map((entry) => entry.initiative.id)).toEqual(["I-1"]);
		const [inbox, planning] = columns.now;
		expect(inbox?.goal?.id).toBe("I-1");
		expect(inbox?.parent?.id).toBe("I-2");
		expect(planning?.goal?.id).toBe("I-1");
		expect(planning?.parent).toBeNull();
		expect(columns.later[0]?.goal).toBeNull();
	});

	test("group the Goals view by top-level initiative, in tree order", () => {
		expect(
			goalGroups(viewOf(tree)).map((group) => [
				group.goal.id,
				group.initiatives.map((entry) => entry.id),
			]),
		).toEqual([
			["I-1", ["I-2", "I-3"]],
			["I-4", []],
		]);
	});

	test("draw the stack bar from the categories, Triage and Canceled out, and count done of the rest", () => {
		const bar = rollupBar(
			rollupOf({
				completed: 2,
				review: 1,
				started: 1,
				unstarted: 0,
				backlog: 4,
				triage: 3,
				canceled: 5,
			}),
		);
		expect(bar.total).toBe(8);
		expect(bar.done).toBe(2);
		expect(bar.percent).toBe(25);
		expect(bar.triage).toBe(3);
		expect(bar.segments).toEqual([
			{ category: "completed", count: 2, start: 0, width: 25 },
			{ category: "review", count: 1, start: 25, width: 12.5 },
			{ category: "started", count: 1, start: 37.5, width: 12.5 },
			{ category: "backlog", count: 4, start: 50, width: 50 },
		]);
		expect(rollupBar(rollupOf({ backlog: 1 }))).toMatchObject({ done: 0, total: 1, percent: 0 });
		expect(rollupBar(undefined)).toEqual({
			segments: [],
			done: 0,
			total: 0,
			percent: 0,
			triage: 0,
		});
		expect(rollupBar(rollupOf({ completed: 1, backlog: 2 })).percent).toBe(33);
	});

	test("measure appetite in days of time spent, only when one is set", () => {
		const day = 24 * 60 * 60 * 1000;
		expect(appetiteUsed({ appetiteDays: 10 }, rollupOf({}, { timeSpentMs: 1.5 * day }))).toEqual({
			used: 1.5,
			appetite: 10,
			percent: 15,
		});
		expect(appetiteUsed({ appetiteDays: 2 }, rollupOf({}, { timeSpentMs: 3 * day }))?.percent).toBe(
			100,
		);
		expect(appetiteUsed({}, rollupOf())).toBeNull();
	});

	test("say an initiative waits for another whose card blocks one of its own, never for its relatives", () => {
		const view = viewOf(tree, {
			schedule: scheduleOf({
				edges: [
					edgeOf("TR-9", "TR-1"),
					edgeOf("TR-9", "TR-2"),
					edgeOf("TR-1", "TR-2"),
					edgeOf("TR-7", "TR-1"),
				],
			}),
		});
		const after = initiativeDependencies(view);
		expect(after.get("I-2")?.map((entry) => entry.id)).toEqual(["I-4"]);
		expect(after.get("I-3")?.map((entry) => entry.id)).toEqual(["I-4"]);
		expect(after.has("I-4")).toBe(false);
	});

	test("move only onto another horizon, and nest only outside its own subtree", () => {
		const view = viewOf(tree);
		expect(horizonMove(view, "I-2", "next")).toEqual({ initiativeId: "I-2", horizon: "next" });
		expect(horizonMove(view, "I-2", "now")).toBeNull();
		expect(horizonMove(view, "I-2", "board-column")).toBeNull();
		expect(horizonMove(view, "I-9", "later")).toBeNull();
		expect(horizonMove(view, "I-2", null)).toBeNull();
		expect(parentOptions(view, "I-2").map((entry) => entry.id)).toEqual(["I-1", "I-4"]);
	});

	test("check a roadmap reply's shape", () => {
		expect(isRoadmapView(viewOf(tree))).toBe(true);
		expect(isRoadmapView({ ...viewOf(tree), schedule: {} })).toBe(false);
		expect(isRoadmapView({ projectId: "p1" })).toBe(false);
	});
});

describe("the roadmap's writes", () => {
	test("accept a proposal by clearing it, discard it by deleting it, and move one by horizon", async () => {
		const { host, queries } = fakeHost();
		await acceptInitiative(host, "p1", "I-5");
		await deleteInitiative(host, "p1", "I-5");
		await moveInitiative(host, "p1", "I-2", "next");
		expect(queries).toEqual([
			{
				method: "initiative.update",
				params: { projectId: "p1", initiativeId: "I-5", proposed: false },
			},
			{ method: "initiative.delete", params: { projectId: "p1", initiativeId: "I-5" } },
			{
				method: "initiative.move",
				params: { projectId: "p1", initiativeId: "I-2", horizon: "next" },
			},
		]);
	});

	test("send the panel's edits as initiative.update patches and card placements as card.assignProject", async () => {
		const { host, queries } = fakeHost();
		await updateInitiative(host, "p1", "I-2", { criteria: ["One click"], target: "2026-12-01" });
		await updateInitiative(host, "p1", "I-2", { appetiteDays: null, parentId: null });
		await updateInitiative(host, "p1", "I-2", {
			health: { override: "at_risk", note: "slipping" },
		});
		await assignCard(host, "TR-1", { roadmapProjectId: "P-1" });
		await assignCard(host, "TR-1", { milestoneId: null });
		expect(queries.map((entry) => [entry.method, entry.params])).toEqual([
			[
				"initiative.update",
				{ projectId: "p1", initiativeId: "I-2", criteria: ["One click"], target: "2026-12-01" },
			],
			[
				"initiative.update",
				{ projectId: "p1", initiativeId: "I-2", appetiteDays: null, parentId: null },
			],
			[
				"initiative.update",
				{ projectId: "p1", initiativeId: "I-2", health: { override: "at_risk", note: "slipping" } },
			],
			["card.assignProject", { cardId: "TR-1", roadmapProjectId: "P-1" }],
			["card.assignProject", { cardId: "TR-1", milestoneId: null }],
		]);
	});

	test("move a card between initiatives: off every one listing it directly, onto the picked one", async () => {
		const view = viewOf([
			initiativeOf({ id: "I-1", cardIds: ["TR-1", "TR-2"] }),
			initiativeOf({ id: "I-2", cardIds: [] }),
			initiativeOf({ id: "I-3", cardIds: ["TR-1"] }),
		]);
		const { host, queries } = fakeHost();
		await setCardInitiative(host, view, "TR-1", "I-2");
		await setCardInitiative(host, view, "TR-2", null);
		await setCardInitiative(host, view, "TR-1", "I-1");
		expect(queries.map((entry) => [entry.method, entry.params])).toEqual([
			["initiative.removeCards", { projectId: "p1", initiativeId: "I-1", cardIds: ["TR-1"] }],
			["initiative.removeCards", { projectId: "p1", initiativeId: "I-3", cardIds: ["TR-1"] }],
			["initiative.addCards", { projectId: "p1", initiativeId: "I-2", cardIds: ["TR-1"] }],
			["initiative.removeCards", { projectId: "p1", initiativeId: "I-1", cardIds: ["TR-2"] }],
			["initiative.removeCards", { projectId: "p1", initiativeId: "I-3", cardIds: ["TR-1"] }],
		]);
	});

	test("a roadmap chat starts on the server and opens in the Default workspace it names", async () => {
		const chats: PanelChatTarget[] = [];
		const started = {
			projectId: "p1",
			workspaceId: "w-default",
			sessionId: "s9",
			kickoff: "/skill:roadmap-plan Plan initiative I-2",
		};
		const { host, queries } = fakeHost(() => started);
		const opened = await openRoadmapChat(
			{ ...host, openChat: (target) => chats.push(target) },
			"p1",
			"plan",
			"I-2",
		);
		expect(opened).toEqual(started);
		expect(queries).toEqual([
			{ method: "roadmap.chat", params: { projectId: "p1", kind: "plan", initiativeId: "I-2" } },
		]);
		expect(chats).toEqual([{ projectId: "p1", workspaceId: "w-default", sessionId: "s9" }]);
		const odd = fakeHost(() => ({ sessionId: "s9" }));
		await expect(openRoadmapChat(odd.host, "p1", "review")).rejects.toThrow("unknown shape");
	});

	test("an initiative peeks as its panel on its board", () => {
		expect(initiativePeekEntry("p1", child)).toEqual({
			kind: "extension",
			panel: "initiative",
			params: { projectId: "p1", initiativeId: "I-2" },
			title: "I-2 · Planning surface",
		});
	});
});

describe("the roadmap's views", () => {
	const rollups = {
		initiatives: {
			"I-2": rollupOf(
				{ completed: 2, started: 1, backlog: 1, triage: 3 },
				{ agents: { working: 1, waiting: 1, failed: 0 }, blocked: 2, timeSpentMs: 2 * 86_400_000 },
			),
		},
		projects: {},
		milestones: {},
	};
	const health = {
		"I-2": { suggested: "at_risk" as const, effective: "at_risk" as const, reasons: [] },
		"I-4": {
			suggested: "on_track" as const,
			effective: "off_track" as const,
			override: "off_track" as const,
			reasons: [],
		},
	};

	test("an initiative card shows its goal, crumb, suggested health, rollup, agents, blocks, appetite and what it waits for", () => {
		const view = viewOf(tree, { rollups, health });
		const columns = horizonColumns(view);
		const entry = columns.now.find((candidate) => candidate.initiative.id === "I-2");
		if (!entry) throw new Error("no entry");
		const markup = html(
			<ul>
				<InitiativeCard
					entry={{ ...entry, initiative: { ...entry.initiative, appetiteDays: 10 } }}
					view={view}
					after={[other]}
					actions={ACTIONS}
				/>
			</ul>,
		);
		expect(markup).toContain("Agents without losing control");
		expect(markup).toContain('data-health="at_risk"');
		expect(markup).toContain('data-suggested="true"');
		expect(markup).toContain(">suggested<");
		expect(markup).toContain('data-testid="board-roadmap-stack"');
		expect(markup).toContain("2/4 cards · 50 %");
		expect(markup).toContain("Triage 3");
		expect(markup).toContain("1 working");
		expect(markup).toContain("1 waiting for you");
		expect(markup).toContain("2 blocked");
		expect(markup).toContain("2 of 10 days");
		expect(markup).toContain("After “OpenSpec”");
		expect(markup).not.toContain('data-testid="board-initiative-accept"');

		const inbox = columns.now.find((candidate) => candidate.initiative.id === "I-3");
		if (!inbox) throw new Error("no entry");
		expect(
			html(
				<ul>
					<InitiativeCard entry={inbox} view={view} after={[]} actions={ACTIONS} />
				</ul>,
			),
		).toContain("Planning surface ›");
	});

	test("a proposed initiative is marked and offers Accept and Discard; an override shows no suggestion", () => {
		const proposed = initiativeOf({
			id: "I-4",
			title: "OpenSpec",
			proposed: true,
			proposedBy: "agent",
		});
		const view = viewOf([proposed], { health });
		const markup = html(
			<ul>
				<InitiativeCard
					entry={{ initiative: proposed, goal: null, parent: null }}
					view={view}
					after={[]}
					actions={ACTIONS}
				/>
			</ul>,
		);
		expect(markup).toContain('data-proposed="true"');
		expect(markup).toContain(">Proposed<");
		expect(markup).toContain('data-testid="board-initiative-accept"');
		expect(markup).toContain('data-testid="board-initiative-discard"');
		expect(markup).toContain('data-health="off_track"');
		expect(markup).not.toContain(">suggested<");
		expect(markup).toContain("Not broken down yet");
	});

	test("Now / Next / Later lays the three horizons out with an Initiative button each; Goals groups them", () => {
		const view = viewOf(tree, { rollups, health });
		const horizons = html(<HorizonsView view={view} layout="columns" actions={ACTIONS} />);
		for (const horizon of ["now", "next", "later"])
			expect(horizons).toContain(`data-horizon="${horizon}"`);
		expect(horizons.match(/data-testid="board-initiative-new"/g)).toHaveLength(3);
		expect(horizons.match(/data-testid="board-initiative"/g)).toHaveLength(4);

		const goals = html(
			<GoalsView
				view={viewOf(
					[{ ...goal, specRefs: ["goal-and-requirements#board"] }, child, grandchild, other],
					{ rollups, health },
				)}
				actions={ACTIONS}
			/>,
		);
		expect(goals.match(/data-testid="board-goal"/g)).toHaveLength(2);
		expect(goals).toContain('data-testid="board-goal-spec"');
		expect(goals).toContain("goal-and-requirements#board");
		expect(goals).toContain('data-initiative-id="I-3" data-depth="2"');
		expect(goals).toContain("50 %");
		expect(goals).toContain("Nothing is nested under this goal yet.");
		expect(html(<GoalsView view={viewOf([])} actions={ACTIONS} />)).toContain("No initiatives yet");
	});

	test("a card tile carries its initiative's chip", () => {
		const markup = html(
			<ul>
				<CardTile
					card={cardOf({
						initiative: { projectId: "p1", id: "I-2", title: "Planning surface", outcome: "" },
					})}
					actions={{
						open: noop,
						enter: noop,
						start: noop,
						adopt: noop,
						cancelStart: noop,
						keyDown: noop,
					}}
					starting={false}
				/>
			</ul>,
		);
		expect(markup).toContain('data-testid="board-card-initiative"');
		expect(markup).toContain('data-initiative-id="I-2"');
		expect(markup).toContain("Planning surface");
	});

	test("the initiative panel shows its criteria, legend, reasons, forecast miss, projects, external cards and draft", () => {
		const initiative = initiativeOf({
			...child,
			criteria: ["Start from a card in one click"],
			appetiteDays: 10,
			target: "2026-12-08",
			updates: [{ id: "U-1", at: 5, text: "Inbox shipped.", health: "at_risk" }],
			memberExternalCards: [{ projectId: "p2", cardId: "OT-1" }],
		});
		const view = viewOf([goal, initiative], {
			rollups,
			health: {
				"I-2": {
					suggested: "at_risk",
					effective: "at_risk",
					reasons: [
						{ kind: "waiting", level: "at_risk", cardIds: ["TR-1"] },
						{ kind: "forecast_late", level: "at_risk", p85: "2026-12-22", target: "2026-12-08" },
					],
				},
			},
			forecast: { "I-2": { status: "insufficient", reason: "history" } },
			projects: [
				{
					id: "P-1",
					initiativeId: "I-2",
					title: "Board",
					milestones: [{ id: "M-1", title: "Usable" }],
				},
			],
			externalCards: [
				{
					projectId: "p2",
					projectName: "Payments",
					cardId: "OT-1",
					title: "Abroad",
					category: "started",
				},
			],
		});
		const { host } = fakeHost();
		const markup = html(
			<InitiativeDetails
				host={host}
				view={view}
				board={null}
				initiative={initiative}
				write={noop}
				onError={noop}
				onDeleted={noop}
			/>,
		);
		expect(markup).toContain("Start from a card in one click");
		expect(markup).toContain('data-testid="board-roadmap-legend"');
		expect(markup).toContain("done 2");
		expect(markup).toContain("in progress 1");
		expect(markup).toContain("Waiting for you over a day on the critical path: TR-1");
		expect(markup).toContain(
			`The 85 % forecast, ${dayText("2026-12-22")}, is past the target ${dayText("2026-12-08")}`,
		);
		expect(markup).toContain("Not enough data — needs ≥3 weeks of history");
		expect(markup).toContain("The board has less than 3 whole weeks of history.");
		expect(markup).toContain('data-testid="board-initiative-appetite-bar"');
		expect(markup).toContain('data-project-id="P-1"');
		expect(markup).toContain('data-milestone-id="M-1"');
		expect(markup).toContain("From Payments");
		expect(markup).toContain('data-testid="board-initiative-draft"');
		expect(markup).toContain("Inbox shipped.");
		for (const kind of ["plan", "shape", "report", "review", "close"])
			expect(markup).toContain(`data-testid="board-initiative-chat-${kind}"`);
		expect(markup).not.toContain('data-testid="board-initiative-closed"');
	});

	test("a closed initiative is marked Closed, on its card and in its panel, and offers no Close", () => {
		const closed = initiativeOf({ ...child, closedAt: Date.UTC(2026, 10, 18) });
		const view = viewOf([goal, closed]);
		const { host } = fakeHost();
		const panel = html(
			<InitiativeDetails
				host={host}
				view={view}
				board={null}
				initiative={closed}
				write={noop}
				onError={noop}
				onDeleted={noop}
			/>,
		);
		expect(panel).toContain('data-testid="board-initiative-closed"');
		expect(panel).not.toContain('data-testid="board-initiative-chat-close"');
		expect(panel).not.toContain('data-testid="board-initiative-chat-plan"');
		expect(panel).toContain('data-testid="board-initiative-chat-report"');
		const card = html(
			<InitiativeCard
				entry={{ initiative: closed, goal, parent: null }}
				view={view}
				after={[]}
				actions={ACTIONS}
			/>,
		);
		expect(card).toContain("Closed");
	});
});
