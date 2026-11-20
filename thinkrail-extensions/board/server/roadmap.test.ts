import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionQuery } from "@thinkrail/extension-api/server";
import { Board } from "./board";
import { DAY_MS } from "./days";
import type {
	Card,
	Category,
	Initiative,
	InitiativeUpdate,
	Milestone,
	RoadmapProject,
	Transition,
} from "./model";
import { boardQueries } from "./queries";
import type { RoadmapView } from "./roadmap";
import { createTestHost, facts, project, type TestHost } from "./testHost";
import { createBoardTools } from "./tools";

const hosts: TestHost[] = [];
const NOW = Date.parse("2026-11-18T12:00:00Z");

function setup() {
	const t = createTestHost();
	hosts.push(t);
	t.projects.push(project("p2", "Other Team"));
	const clock = { now: NOW };
	const board = new Board(t.host, { now: () => clock.now, owner: "dana", sizeDelayMs: 0 });
	const queries = boardQueries(board);
	const query = async <T>(method: string, params?: unknown): Promise<T> =>
		(await (queries[method] as ExtensionQuery)(params)) as T;
	const card = (title: string, extra: Record<string, unknown> = {}, projectId = "p1") =>
		query<Card>("card.create", { projectId, title, size: "S", ...extra });
	const roadmap = () => query<RoadmapView>("roadmap.get", { projectId: "p1" });
	return { t, board, query, card, roadmap, clock };
}

afterEach(() => {
	for (const t of hosts.splice(0)) rmSync(t.root, { recursive: true, force: true });
});

function move(cardId: string, from: Category | null, to: Category, at: number): Transition {
	return {
		cardId,
		from: from ? { category: from, column: from } : null,
		to: { category: to, column: to },
		at,
		actor: "automation",
		reason: "seeded",
	};
}

describe("roadmap queries", () => {
	test("validate their params before touching the roadmap", async () => {
		const { query, card } = setup();
		await card("One");
		await query("initiative.create", { projectId: "p1", title: "Goal" });
		const refusals: [string, unknown, string][] = [
			["roadmap.get", { projectId: "nope" }, "No open project"],
			["initiative.create", { projectId: "p1" }, "non-empty title"],
			[
				"initiative.create",
				{ projectId: "p1", title: "x", horizon: "soon" },
				"horizon must be one of",
			],
			["initiative.create", { projectId: "p1", title: "x", target: "2026-13-01" }, "YYYY-MM-DD"],
			["initiative.create", { projectId: "p1", title: "x", appetiteDays: 0 }, "more than 0"],
			["initiative.create", { projectId: "p1", title: "x", criteria: "a" }, "list of at most"],
			["initiative.create", { projectId: "p1", title: "x", parentId: "I-9" }, "No initiative I-9"],
			["initiative.update", { projectId: "p1", initiativeId: "I-9" }, "No initiative I-9"],
			[
				"initiative.update",
				{ projectId: "p1", initiativeId: "I-1", proposed: true },
				"only be cleared",
			],
			[
				"initiative.update",
				{ projectId: "p1", initiativeId: "I-1", health: { override: "great" } },
				"override must be one of",
			],
			[
				"initiative.update",
				{ projectId: "p1", initiativeId: "I-1", health: "x" },
				"must be an object",
			],
			["initiative.move", { projectId: "p1", initiativeId: "I-1" }, "Pass a horizon"],
			[
				"initiative.addCards",
				{ projectId: "p1", initiativeId: "I-1", cardIds: [] },
				"cardIds to add",
			],
			[
				"initiative.addCards",
				{ projectId: "p1", initiativeId: "I-1", cardIds: ["TR-9"] },
				"Unknown card",
			],
			[
				"initiative.updateDraft.save",
				{ projectId: "p1", initiativeId: "I-1", text: "x", health: "fine" },
				"health must be one of",
			],
			[
				"initiative.updateDraft.publish",
				{ projectId: "p1", initiativeId: "I-1" },
				"no draft update",
			],
			["project.create", { projectId: "p1", title: "x", initiativeId: "I-9" }, "No initiative I-9"],
			["project.create", { projectId: "p1", title: "x", milestones: [{}] }, "non-empty title"],
			["project.update", { projectId: "p1", roadmapProjectId: "P-9" }, "No project P-9"],
			[
				"milestone.create",
				{ projectId: "p1", roadmapProjectId: "P-9", title: "x" },
				"No project P-9",
			],
			["milestone.update", { projectId: "p1", milestoneId: "M-9" }, "No milestone M-9"],
			["card.assignProject", { cardId: "TR-1" }, "roadmapProjectId or the milestoneId"],
			["card.assignProject", { cardId: "TR-1", roadmapProjectId: "P-9" }, "No project P-9"],
			["card.link", { from: "TR-1" }, "non-empty to"],
			["card.link", { from: "TR-1", to: "TR-1" }, "cannot block itself"],
			["card.pin", { cardId: "TR-1" }, "Pass the start"],
			["card.pin", { cardId: "TR-1", start: "tomorrow" }, "YYYY-MM-DD"],
			["card.shiftChain", { cardId: "TR-1", days: 0 }, "whole number"],
			["card.shiftChain", { cardId: "TR-1", days: 1.5 }, "whole number"],
			["card.update", { cardId: "TR-1", estimateDays: -1 }, "more than 0"],
		];
		for (const [method, params, message] of refusals)
			await expect(query(method, params)).rejects.toThrow(message);
	});

	test("create, nest, update, move and delete initiatives, publishing board.changed", async () => {
		const { t, query } = setup();
		const goal = await query<Initiative>("initiative.create", {
			projectId: "p1",
			title: " Ship roadmaps ",
			outcome: "Plans follow the work",
			criteria: ["forecasts", " "],
			horizon: "now",
			target: "2026-12-20",
			appetiteDays: 15,
			specRefs: ["module-ext-board"],
		});
		expect(goal).toMatchObject({
			id: "I-1",
			title: "Ship roadmaps",
			criteria: ["forecasts"],
			horizon: "now",
			target: "2026-12-20",
			appetiteDays: 15,
			cardIds: [],
			externalCards: [],
			updates: [],
		});
		expect(goal).not.toHaveProperty("proposed");
		expect(t.published.at(-1)).toMatchObject({
			type: "board.changed",
			payload: { projectId: "p1" },
		});
		const child = await query<Initiative>("initiative.create", {
			projectId: "p1",
			title: "Graph",
			parentId: "I-1",
		});
		expect(child).toMatchObject({ id: "I-2", parentId: "I-1", horizon: "later" });
		const grandchild = await query<Initiative>("initiative.create", {
			projectId: "p1",
			title: "Edit",
			parentId: "I-2",
		});

		await expect(
			query("initiative.update", { projectId: "p1", initiativeId: "I-1", parentId: grandchild.id }),
		).rejects.toThrow("cannot nest under itself");
		const updated = await query<Initiative>("initiative.update", {
			projectId: "p1",
			initiativeId: "I-1",
			target: null,
			appetiteDays: null,
			health: { override: "at_risk", note: "Review backlog" },
		});
		expect(updated).not.toHaveProperty("target");
		expect(updated).not.toHaveProperty("appetiteDays");
		expect(updated.health).toEqual({ override: "at_risk", note: "Review backlog" });
		const cleared = await query<Initiative>("initiative.update", {
			projectId: "p1",
			initiativeId: "I-1",
			health: { override: null },
		});
		expect(cleared.health).toEqual({ note: "Review backlog" });
		expect(
			(
				await query<Initiative>("initiative.update", {
					projectId: "p1",
					initiativeId: "I-1",
					health: { note: null },
				})
			).health,
		).toBeUndefined();

		const moved = await query<Initiative>("initiative.move", {
			projectId: "p1",
			initiativeId: "I-3",
			horizon: "now",
		});
		expect(moved).toMatchObject({ horizon: "now", rank: goal.rank + 1 });

		await query("project.create", { projectId: "p1", title: "Lane", initiativeId: "I-2" });
		expect(await query("initiative.delete", { projectId: "p1", initiativeId: "I-2" })).toEqual({
			deleted: "I-2",
		});
		const view = await query<RoadmapView>("roadmap.get", { projectId: "p1" });
		expect(view.initiatives.map((node) => [node.id, node.parentId, node.depth])).toEqual([
			["I-1", undefined, 0],
			["I-3", "I-1", 1],
		]);
		expect(view.initiatives[0]?.childIds).toEqual(["I-3"]);
		expect(view.projects[0]).not.toHaveProperty("initiativeId");
	});

	test("orders the tree's roots by horizon, then rank", async () => {
		const { query, roadmap } = setup();
		for (const [title, horizon] of [
			["Later one", "later"],
			["Now one", "now"],
			["Next one", "next"],
			["Now two", "now"],
		])
			await query("initiative.create", { projectId: "p1", title, horizon });
		expect((await roadmap()).initiatives.map((node) => node.title)).toEqual([
			"Now one",
			"Now two",
			"Next one",
			"Later one",
		]);
	});

	test("projects and milestones: create, update, delete, and their cards let go of them", async () => {
		const { query, card, board } = setup();
		await query("initiative.create", { projectId: "p1", title: "Goal" });
		const created = await query<RoadmapProject>("project.create", {
			projectId: "p1",
			title: "Step graph",
			initiativeId: "I-1",
			milestones: [{ title: "Alpha", target: "2026-11-30" }, { title: "Beta" }],
		});
		expect(created).toMatchObject({
			id: "P-1",
			initiativeId: "I-1",
			milestones: [
				{ id: "M-1", title: "Alpha", target: "2026-11-30" },
				{ id: "M-2", title: "Beta" },
			],
		});
		const second = await query<RoadmapProject>("project.create", {
			projectId: "p1",
			title: "Timeline",
		});
		expect(second.id).toBe("P-2");
		const gamma = await query<Milestone>("milestone.create", {
			projectId: "p1",
			roadmapProjectId: "P-2",
			title: "Gamma",
			target: "2027-01-10",
		});
		expect(gamma).toEqual({ id: "M-3", title: "Gamma", target: "2027-01-10" });
		expect(
			await query<Milestone>("milestone.update", {
				projectId: "p1",
				milestoneId: "M-3",
				title: "G",
				target: null,
			}),
		).toEqual({ id: "M-3", title: "G" });
		expect(
			await query<RoadmapProject>("project.update", {
				projectId: "p1",
				roadmapProjectId: "P-2",
				title: "Timeline view",
				initiativeId: "I-1",
			}),
		).toMatchObject({ title: "Timeline view", initiativeId: "I-1" });
		expect(
			await query<RoadmapProject>("project.update", {
				projectId: "p1",
				roadmapProjectId: "P-2",
				initiativeId: null,
			}),
		).not.toHaveProperty("initiativeId");

		await card("A");
		await card("B");
		await query("card.assignProject", { cardId: "TR-1", milestoneId: "M-1" });
		await query("card.assignProject", {
			cardId: "TR-2",
			roadmapProjectId: "P-1",
			milestoneId: "M-2",
		});
		await query("milestone.delete", { projectId: "p1", milestoneId: "M-1" });
		expect(board.find("TR-1")).toMatchObject({ roadmapProjectId: "P-1" });
		expect(board.find("TR-1")).not.toHaveProperty("milestoneId");
		await query("project.delete", { projectId: "p1", roadmapProjectId: "P-1" });
		expect(board.find("TR-2")).not.toHaveProperty("roadmapProjectId");
		expect(board.find("TR-2")).not.toHaveProperty("milestoneId");
	});

	test("assign a card to a project and milestone, by either, and take it out", async () => {
		const { query, card } = setup();
		await query("project.create", { projectId: "p1", title: "One", milestones: [{ title: "A" }] });
		await query("project.create", { projectId: "p1", title: "Two", milestones: [{ title: "B" }] });
		await card("Card");
		const assign = (params: Record<string, unknown>) =>
			query<Card>("card.assignProject", { cardId: "tr-1", ...params });
		expect(await assign({ milestoneId: "M-1" })).toMatchObject({
			roadmapProjectId: "P-1",
			milestoneId: "M-1",
		});
		expect(await assign({ roadmapProjectId: "P-1" })).toMatchObject({
			roadmapProjectId: "P-1",
			milestoneId: "M-1",
		});
		const moved = await assign({ roadmapProjectId: "P-2" });
		expect(moved.roadmapProjectId).toBe("P-2");
		expect(moved).not.toHaveProperty("milestoneId");
		await expect(assign({ roadmapProjectId: "P-2", milestoneId: "M-1" })).rejects.toThrow(
			"not a milestone of P-2",
		);
		expect(await assign({ milestoneId: "M-2" })).toMatchObject({
			roadmapProjectId: "P-2",
			milestoneId: "M-2",
		});
		const unmilestoned = await assign({ milestoneId: null });
		expect(unmilestoned.roadmapProjectId).toBe("P-2");
		expect(unmilestoned).not.toHaveProperty("milestoneId");
		await expect(assign({ roadmapProjectId: null, milestoneId: "M-2" })).rejects.toThrow(
			"no milestone",
		);
		const out = await assign({ roadmapProjectId: null });
		expect(out).not.toHaveProperty("roadmapProjectId");
		await expect(assign({ projectId: "P-1" })).rejects.toThrow(
			"roadmapProjectId or the milestoneId",
		);
		await expect(
			query("card.assignProject", { cardId: "#4", roadmapProjectId: "P-1" }),
		).rejects.toThrow("Not a card id");
	});

	test("link and unlink cards, refusing a link that closes a cycle wherever it comes from", async () => {
		const { query, card, board } = setup();
		await card("A");
		await card("B");
		await card("C");
		expect((await query<Card>("card.link", { from: "TR-1", to: "tr-2" })).blocks).toEqual(["TR-2"]);
		await query("card.link", { from: "TR-2", to: "TR-3" });
		await expect(query("card.link", { from: "TR-3", to: "TR-1" })).rejects.toThrow(
			"would close a cycle",
		);
		await expect(query("card.update", { cardId: "TR-3", blocks: ["TR-1"] })).rejects.toThrow(
			"would close a cycle",
		);
		await card("Elsewhere", {}, "p2");
		await expect(query("card.link", { from: "TR-1", to: "OT-1" })).rejects.toThrow("not a card of");
		expect((await query<Card>("card.link", { from: "TR-1", to: "TR-2" })).blocks).toEqual(["TR-2"]);
		expect((await query<Card>("card.unlink", { from: "TR-1", to: "tr-2" })).blocks).toEqual([]);
		expect((await query<Card>("card.unlink", { from: "TR-1", to: "TR-3" })).blocks).toEqual([]);
		expect(board.find("TR-2").blocks).toEqual(["TR-3"]);
	});

	test("pin and unpin a planned start; a started card keeps its attempt's", async () => {
		const { query, card } = setup();
		await card("A");
		await card("B");
		expect(await query<Card>("card.pin", { cardId: "TR-1", start: "2026-11-25" })).toMatchObject({
			pinnedStart: "2026-11-25",
		});
		expect(await query<Card>("card.unpin", { cardId: "TR-1" })).not.toHaveProperty("pinnedStart");
		await query("card.start", { cardId: "TR-2" });
		await expect(query("card.pin", { cardId: "TR-2", start: "2026-11-25" })).rejects.toThrow(
			"has started",
		);
		await expect(query("card.shiftChain", { cardId: "TR-2", days: 2 })).rejects.toThrow(
			"has started",
		);
	});

	test("shift a chain: the card and its pinned dependents move together, unpinned ones follow by themselves", async () => {
		const { query, card, board } = setup();
		await card("Root", { size: "M" });
		await card("Pinned");
		await card("Free");
		await card("Started");
		await card("Unrelated");
		await query("card.link", { from: "TR-1", to: "TR-2" });
		await query("card.link", { from: "TR-2", to: "TR-3" });
		await query("card.link", { from: "TR-1", to: "TR-4" });
		await query("card.pin", { cardId: "TR-2", start: "2026-11-30" });
		await query("card.pin", { cardId: "TR-5", start: "2026-11-30" });
		await query("card.start", { cardId: "TR-4" });
		const moved = await query<Card[]>("card.shiftChain", { cardId: "TR-1", days: 3 });
		expect(moved.map((entry) => [entry.id, entry.pinnedStart])).toEqual([
			["TR-1", "2026-11-21"],
			["TR-2", "2026-12-03"],
		]);
		expect(board.find("TR-3")).not.toHaveProperty("pinnedStart");
		expect(board.find("TR-5").pinnedStart).toBe("2026-11-30");
		const back = await query<Card[]>("card.shiftChain", { cardId: "TR-1", days: -1 });
		expect(back.map((entry) => entry.pinnedStart)).toEqual(["2026-11-20", "2026-12-02"]);
	});

	test("set a card's estimate, or fall back to its size's", async () => {
		const { query, card, roadmap } = setup();
		await card("A", { size: "L" });
		const node = async () => (await roadmap()).schedule.nodes.find((entry) => entry.id === "TR-1");
		const today = Math.floor(NOW / DAY_MS);
		expect(await node()).toMatchObject({ start: today, end: today + 6 });
		expect(await query<Card>("card.update", { cardId: "TR-1", estimateDays: 2.5 })).toMatchObject({
			estimateDays: 2.5,
		});
		expect((await node())?.end).toBe(today + 2.5);
		expect(
			await query<Card>("card.update", { cardId: "TR-1", estimateDays: null }),
		).not.toHaveProperty("estimateDays");
	});

	test("add this board's and other boards' cards to an initiative, remove them, and forget deleted ones", async () => {
		const { query, card, roadmap, board } = setup();
		await card("Local");
		await card("Abroad", { size: "L" }, "p2");
		await query("initiative.create", { projectId: "p1", title: "Goal" });
		const added = await query<Initiative>("initiative.addCards", {
			projectId: "p1",
			initiativeId: "I-1",
			cardIds: ["tr-1", "OT-1", "TR-1"],
		});
		expect(added.cardIds).toEqual(["TR-1"]);
		expect(added.externalCards).toEqual([{ projectId: "p2", cardId: "OT-1" }]);
		const view = await roadmap();
		expect(view.externalCards).toEqual([
			{
				projectId: "p2",
				projectName: "Other Team",
				cardId: "OT-1",
				title: "Abroad",
				category: "backlog",
				size: "L",
			},
		]);
		expect(view.initiatives[0]).toMatchObject({
			memberCardIds: ["TR-1"],
			memberExternalCards: [{ projectId: "p2", cardId: "OT-1" }],
		});
		expect(view.rollups.initiatives["I-1"]).toMatchObject({
			cards: 2,
			points: { total: 5, completed: 0 },
		});

		const removed = await query<Initiative>("initiative.removeCards", {
			projectId: "p1",
			initiativeId: "I-1",
			cardIds: ["TR-1"],
		});
		expect(removed.cardIds).toEqual([]);
		await query("initiative.addCards", { projectId: "p1", initiativeId: "I-1", cardIds: ["TR-1"] });
		await query("card.delete", { cardId: "OT-1" });
		await query("card.delete", { cardId: "TR-1" });
		expect(board.store.initiatives("p1").initiatives[0]).toMatchObject({
			cardIds: [],
			externalCards: [],
		});
	});

	test("save one draft update at a time, then publish it with the human's edits", async () => {
		const { query, clock } = setup();
		await query("initiative.create", { projectId: "p1", title: "Goal" });
		const save = (text: string, health: string) =>
			query<InitiativeUpdate>("initiative.updateDraft.save", {
				projectId: "p1",
				initiativeId: "I-1",
				text,
				health,
			});
		expect(await save("Draft one", "on_track")).toEqual({
			id: "U-1",
			at: NOW,
			text: "Draft one",
			health: "on_track",
		});
		clock.now += 1000;
		expect(await save("Draft two", "at_risk")).toEqual({
			id: "U-1",
			at: NOW + 1000,
			text: "Draft two",
			health: "at_risk",
		});
		clock.now += 1000;
		const published = await query<InitiativeUpdate>("initiative.updateDraft.publish", {
			projectId: "p1",
			initiativeId: "I-1",
			text: "Final words",
		});
		expect(published).toEqual({
			id: "U-1",
			at: NOW + 2000,
			text: "Final words",
			health: "at_risk",
			publishedAt: NOW + 2000,
		});
		expect((await save("Next week", "on_track")).id).toBe("U-2");
		await query("initiative.updateDraft.publish", { projectId: "p1", initiativeId: "I-1" });
		const direct = await query<InitiativeUpdate>("initiative.updateDraft.publish", {
			projectId: "p1",
			initiativeId: "I-1",
			text: "Straight out",
			health: "off_track",
		});
		expect(direct).toMatchObject({
			id: "U-3",
			health: "off_track",
			publishedAt: expect.any(Number),
		});
		const view = await query<RoadmapView>("roadmap.get", { projectId: "p1" });
		expect(
			view.initiatives[0]?.updates.map((update) => [update.id, update.publishedAt !== undefined]),
		).toEqual([
			["U-1", true],
			["U-2", true],
			["U-3", true],
		]);
	});
});

describe("roadmap.get", () => {
	test("rolls up initiatives, projects and milestones from live cards, with the schedule and per-initiative critical path", async () => {
		const { t, query, card, roadmap, board } = setup();
		await query("initiative.create", { projectId: "p1", title: "Goal", horizon: "now" });
		await query("initiative.create", { projectId: "p1", title: "Sub", parentId: "I-1" });
		await query("project.create", {
			projectId: "p1",
			title: "Lane",
			initiativeId: "I-2",
			milestones: [{ title: "Beta", target: "2026-11-19" }],
		});
		await card("Working", { size: "M" });
		await card("Waiting", { size: "L" });
		await card("Blocked");
		await card("Loose");
		await query("card.assignProject", { cardId: "TR-1", milestoneId: "M-1" });
		await query("card.assignProject", { cardId: "TR-3", milestoneId: "M-1" });
		await query("initiative.addCards", { projectId: "p1", initiativeId: "I-1", cardIds: ["TR-2"] });
		await query("card.link", { from: "TR-1", to: "TR-3" });
		await query("card.start", { cardId: "TR-1" });
		await query("card.start", { cardId: "TR-2" });
		t.facts.set(
			"w1",
			facts("w1", {
				chats: [
					{
						sessionId: "s1",
						title: "",
						state: "working",
						unread: false,
						plan: null,
						updatedAt: NOW,
					},
				],
			}),
		);
		t.facts.set(
			"w2",
			facts("w2", {
				chats: [
					{
						sessionId: "s2",
						title: "",
						state: "needs_you",
						unread: false,
						plan: null,
						updatedAt: NOW - 2 * DAY_MS,
					},
				],
			}),
		);
		const view = await roadmap();
		expect(view).toMatchObject({ projectId: "p1", projectName: "ThinkRail" });
		expect(view.rollups.initiatives["I-1"]).toMatchObject({
			cards: 3,
			byCategory: { started: 2, backlog: 1 },
			points: { total: 2 + 4 + 1, completed: 0 },
			agents: { working: 1, waiting: 1, failed: 0 },
			blocked: 1,
		});
		expect(view.rollups.initiatives["I-2"]).toMatchObject({ cards: 2, blocked: 1 });
		expect(view.rollups.projects["P-1"]).toMatchObject({ cards: 2 });
		expect(view.rollups.milestones["M-1"]).toMatchObject({ cards: 2 });
		const today = Math.floor(NOW / DAY_MS);
		const node = (id: string) => view.schedule.nodes.find((entry) => entry.id === id);
		expect(node("TR-1")).toMatchObject({ lane: "P-1", start: NOW / DAY_MS, end: NOW / DAY_MS + 3 });
		expect(node("TR-3")).toMatchObject({ start: NOW / DAY_MS + 3, end: NOW / DAY_MS + 4 });
		expect(node("M-1")).toMatchObject({ kind: "milestone", end: NOW / DAY_MS + 4, late: true });
		expect(node("TR-4")).toMatchObject({ start: today, end: today + 1, lane: null });
		expect(view.critical["I-2"]).toEqual(["TR-1", "TR-3", "M-1"]);
		expect(view.critical["I-1"]).toEqual(["TR-2"]);
		expect(view.health["I-2"]).toMatchObject({
			suggested: "on_track",
			effective: "on_track",
			reasons: [],
		});
		expect(view.health["I-1"]).toMatchObject({
			suggested: "at_risk",
			reasons: [{ kind: "waiting", level: "at_risk", cardIds: ["TR-2"] }],
		});
		expect(view.forecast["I-1"]).toMatchObject({ status: "insufficient", reason: "history" });
		expect(view.insufficientData).toEqual({ throughput: true, initiatives: ["I-1", "I-2"] });
		expect(board.find("TR-4")).not.toHaveProperty("roadmapProjectId");
	});

	test("forecasts from the board's weekly throughput and suggests health from the signals, a human's override winning", async () => {
		const { t, query, card, roadmap, board } = setup();
		await query("initiative.create", { projectId: "p1", title: "Goal", target: "2026-11-20" });
		for (const title of ["Done 1", "Done 2", "Done 3", "Left 1", "Left 2", "Left 3"])
			await card(title);
		await query("initiative.addCards", {
			projectId: "p1",
			initiativeId: "I-1",
			cardIds: ["TR-1", "TR-2", "TR-3", "TR-4", "TR-5", "TR-6"],
		});
		const week = 7 * DAY_MS;
		board.store.appendTransitions("p1", [
			move("TR-1", "review", "completed", NOW - 4 * week),
			move("TR-2", "review", "completed", NOW - 3 * week),
			move("TR-3", "review", "completed", NOW - 2 * week),
		]);
		const file = board.store.cards("p1");
		if (!file) throw new Error("no board");
		board.store.saveCards("p1", {
			...file,
			cards: file.cards.map((entry) =>
				["TR-1", "TR-2", "TR-3"].includes(entry.id)
					? { ...entry, category: "completed", column: "done" }
					: entry,
			),
		});
		await query("card.start", { cardId: "TR-4" });
		t.facts.set(
			"w1",
			facts("w1", {
				chats: [
					{
						sessionId: "s1",
						title: "",
						state: "failed",
						unread: false,
						plan: null,
						updatedAt: NOW,
					},
				],
			}),
		);
		const view = await roadmap();
		expect(view.throughput.insufficientData).toBe(false);
		expect(view.throughput.weeks.map((entry) => entry.points)).toEqual([1, 1, 1, 0]);
		const forecast = view.forecast["I-1"];
		expect(forecast).toMatchObject({
			status: "ok",
			inputs: { remainingPoints: 3, totalPoints: 6 },
		});
		expect(await roadmap()).toMatchObject({ forecast: { "I-1": forecast } });
		const health = view.health["I-1"];
		expect(health?.suggested).toBe("off_track");
		expect(health?.reasons.map((reason) => reason.kind)).toEqual(["forecast_late", "failed"]);
		expect(view.cycleTimes).toEqual({});

		await query("initiative.update", {
			projectId: "p1",
			initiativeId: "I-1",
			health: { override: "on_track" },
		});
		expect((await roadmap()).health["I-1"]).toMatchObject({
			suggested: "off_track",
			effective: "on_track",
		});
	});
});

describe("the kickoff and the roadmap tools", () => {
	interface Registered {
		name: string;
		execute: (
			id: string,
			params: unknown,
			signal: undefined,
			update: undefined,
			ctx: unknown,
		) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
	}

	function tools(board: Board) {
		const registered = new Map<string, Registered>();
		createBoardTools(() => board)({
			registerTool: (tool: Registered) => registered.set(tool.name, tool),
			on: () => {},
		} as unknown as ExtensionAPI);
		return (name: string, params: unknown, sessionId = "s1", cwd = "/worktrees/w1") =>
			(registered.get(name) as Registered).execute("call", params, undefined, undefined, {
				cwd,
				sessionManager: { getSessionId: () => sessionId },
			});
	}

	test("a card's kickoff carries its initiative's outcome and criteria, its project and milestone", async () => {
		const { t, query, card } = setup();
		await query("initiative.create", {
			projectId: "p1",
			title: "Roadmap",
			outcome: "Plans follow the work",
			criteria: ["Forecasts", "Health"],
		});
		await query("project.create", {
			projectId: "p1",
			title: "Step graph",
			initiativeId: "I-1",
			milestones: [{ title: "Beta" }],
		});
		await card("In project");
		await card("Listed");
		await card("Plain");
		await card("Abroad", {}, "p2");
		await query("card.assignProject", { cardId: "TR-1", milestoneId: "M-1" });
		await query("initiative.addCards", {
			projectId: "p1",
			initiativeId: "I-1",
			cardIds: ["TR-2", "OT-1"],
		});
		for (const cardId of ["TR-1", "TR-2", "TR-3", "OT-1"]) await query("card.start", { cardId });
		const texts = t.created.map((params) => params.kickoff?.text ?? "");
		expect(texts[0]).toContain(
			[
				"Initiative I-1: Roadmap",
				"Outcome: Plans follow the work",
				"Success criteria:",
				"- Forecasts",
				"- Health",
				"Project: Step graph",
				"Milestone: Beta",
			].join("\n"),
		);
		expect(texts[1]).toContain("Initiative I-1: Roadmap");
		expect(texts[1]).not.toContain("Project:");
		expect(texts[2]).toBe("Card TR-3: Plain");
		expect(texts[3]).toContain("Initiative I-1: Roadmap\nOutcome: Plans follow the work");
	});

	test("a card's live overlay names the initiative it serves, on its board or another", async () => {
		const { query, card } = setup();
		await query("initiative.create", { projectId: "p1", title: "Goal", outcome: "Why" });
		await query("initiative.create", { projectId: "p1", title: "Via project", outcome: "Lane" });
		await query("project.create", { projectId: "p1", title: "Lane", initiativeId: "I-2" });
		await card("Listed");
		await card("In project");
		await card("Plain");
		await card("Abroad", {}, "p2");
		await query("initiative.addCards", {
			projectId: "p1",
			initiativeId: "I-1",
			cardIds: ["TR-1", "TR-2", "OT-1"],
		});
		await query("card.assignProject", { cardId: "TR-2", roadmapProjectId: "P-1" });
		const view = await query<{ cards: { id: string; initiative?: unknown }[] }>("board.get", {
			projectId: "p1",
		});
		const served = Object.fromEntries(view.cards.map((entry) => [entry.id, entry.initiative]));
		expect(served).toEqual({
			"TR-1": { projectId: "p1", id: "I-1", title: "Goal", outcome: "Why" },
			"TR-2": { projectId: "p1", id: "I-2", title: "Via project", outcome: "Lane" },
			"TR-3": undefined,
		});
		const abroad = await query<{ card: { initiative?: unknown } }>("card.get", { cardId: "OT-1" });
		expect(abroad.card.initiative).toEqual({
			projectId: "p1",
			id: "I-1",
			title: "Goal",
			outcome: "Why",
		});
	});

	test("roadmap.chat starts a planning chat in the Default workspace whose kickoff carries the initiative", async () => {
		const { t, query } = setup();
		t.projects[0] = project("p1", "ThinkRail", [
			{ id: "w-default", name: "Default", kind: "default", branch: "main" },
		]);
		await query("initiative.create", {
			projectId: "p1",
			title: "Roadmap",
			outcome: "Plans follow the work",
			criteria: ["Forecasts"],
			horizon: "next",
			target: "2026-12-01",
		});
		const started = await query<Record<string, unknown>>("roadmap.chat", {
			projectId: "p1",
			kind: "plan",
			initiativeId: "I-1",
		});
		expect(started).toMatchObject({ projectId: "p1", workspaceId: "w-default", sessionId: "s1" });
		expect(t.chats).toHaveLength(1);
		const text = t.chats[0]?.kickoff.text ?? "";
		expect(started.kickoff).toBe(text);
		expect(t.chats[0]?.workspaceId).toBe("w-default");
		expect(text.startsWith("/skill:roadmap-plan Plan initiative I-1 of the ThinkRail board")).toBe(
			true,
		);
		expect(text).toContain(
			"Initiative I-1: Roadmap\nOutcome: Plans follow the work\nSuccess criteria:\n- Forecasts\n(horizon next, target 2026-12-01)",
		);
		expect(text).toContain("board_cards_create_batch");
		for (const [kind, skill, tool] of [
			["shape", "roadmap-shape", "goal-and-requirements"],
			["report", "roadmap-report", "board_update_draft"],
			["review", "roadmap-review", "- I-1 (next): Roadmap"],
		] as const) {
			await query("roadmap.chat", { projectId: "p1", kind, initiativeId: "I-1" });
			const kickoff = t.chats.at(-1)?.kickoff.text ?? "";
			expect(kickoff.startsWith(`/skill:${skill} `)).toBe(true);
			expect(kickoff).toContain(tool);
		}
		await query("roadmap.chat", { projectId: "p1", kind: "review" });
		expect(t.chats.at(-1)?.kickoff.text).not.toContain("Start with");

		t.chat.kickoffError = "No model selected";
		expect(
			await query("roadmap.chat", { projectId: "p1", kind: "report", initiativeId: "I-1" }),
		).toMatchObject({ kickoffError: "No model selected" });
		const refusals: [unknown, string][] = [
			[{ projectId: "p1", kind: "plan" }, "Pass the initiativeId to plan"],
			[{ projectId: "p1", kind: "sing", initiativeId: "I-1" }, "kind must be one of"],
			[{ projectId: "p1", kind: "plan", initiativeId: "I-9" }, "No initiative I-9"],
			[{ projectId: "p2", kind: "review" }, "no Default workspace"],
		];
		const before = t.chats.length;
		for (const [params, message] of refusals)
			await expect(query("roadmap.chat", params)).rejects.toThrow(message);
		expect(t.chats).toHaveLength(before);
	});

	test("an agent proposes initiatives and projects, which a human accepts", async () => {
		const { t, query, board } = setup();
		t.places.set("/worktrees/w1", { projectId: "p1", workspaceId: "w1" });
		const call = tools(board);
		const proposed = await call("board_initiative_create_draft", {
			title: " Insights ",
			outcome: "See the flow",
			criteria: ["Cycle time", " "],
			horizon: "next",
		});
		expect(proposed.details.initiative).toMatchObject({
			id: "I-1",
			title: "Insights",
			criteria: ["Cycle time"],
			horizon: "next",
			proposed: true,
			proposedBy: "agent",
		});
		const accepted = await query<Initiative>("initiative.update", {
			projectId: "p1",
			initiativeId: "I-1",
			proposed: false,
		});
		expect(accepted).not.toHaveProperty("proposed");
		expect(accepted.proposedBy).toBe("agent");

		const projectReply = await call("board_project_create", {
			initiativeId: "i-1",
			title: "Charts",
			milestones: [{ title: "CFD", target: "2026-12-01" }],
		});
		expect(projectReply.details.project).toMatchObject({
			id: "P-1",
			initiativeId: "I-1",
			proposed: true,
			milestones: [{ id: "M-1", title: "CFD", target: "2026-12-01" }],
		});
		await expect(
			call("board_project_create", {
				initiativeId: "I-1",
				title: "x",
				milestones: [{ title: "y", target: "soon" }],
			}),
		).rejects.toThrow("not a date");
		await expect(call("board_project_create", { initiativeId: "I-9", title: "x" })).rejects.toThrow(
			"No initiative I-9",
		);
		await expect(
			call("board_initiative_create_draft", { title: "x", outcome: "y" }, "s1", "/elsewhere"),
		).rejects.toThrow("has no board");
	});

	test("an agent files a decomposition into Triage as one group with its links, and refuses a cycle", async () => {
		const { t, query, board, card } = setup();
		t.places.set("/worktrees/w1", { projectId: "p1", workspaceId: "w1" });
		await card("Own");
		await query("card.start", { cardId: "TR-1" });
		await query("project.create", { projectId: "p1", title: "Lane" });
		const call = tools(board);
		const before = t.published.length;
		const reply = await call("board_cards_create_batch", {
			roadmapProjectId: "p-1",
			cards: [
				{ title: "Model", size: "M", acceptance: ["stored", " "], blocksIndex: [1, 2] },
				{ title: "Queries", description: "CRUD", blocksIndex: [2] },
				{ title: "Tools", type: "chore" },
			],
		});
		const cards = reply.details.cards as Card[];
		expect(cards.map((entry) => [entry.id, entry.blocks])).toEqual([
			["TR-2", ["TR-3", "TR-4"]],
			["TR-3", ["TR-4"]],
			["TR-4", []],
		]);
		for (const entry of cards)
			expect(entry).toMatchObject({
				category: "triage",
				createdBy: "agent",
				roadmapProjectId: "P-1",
				origin: { sessionId: "s1", cardId: "TR-1" },
			});
		expect(cards[0]).toMatchObject({ size: "M", sizeSuggested: true, acceptance: ["stored"] });
		expect(t.published.length - before).toBe(1);
		expect(t.asks).toEqual([]);
		expect(reply.content[0]?.text).toContain("Filed 3 cards in Triage as one group");
		await query("triage.accept", { cardIds: cards.map((entry) => entry.id) });
		expect(board.find("TR-4").category).toBe("backlog");

		await expect(
			call("board_cards_create_batch", {
				cards: [
					{ title: "A", blocksIndex: [1] },
					{ title: "B", blocksIndex: [0] },
				],
			}),
		).rejects.toThrow("would close a cycle");
		await expect(
			call("board_cards_create_batch", { cards: [{ title: "A", blocksIndex: [0] }] }),
		).rejects.toThrow("would close a cycle");
		await expect(
			call("board_cards_create_batch", { cards: [{ title: "A", blocksIndex: [3] }] }),
		).rejects.toThrow("not a card of this batch");
		await expect(
			call("board_cards_create_batch", { roadmapProjectId: "P-7", cards: [{ title: "A" }] }),
		).rejects.toThrow("No project P-7");
		expect(board.cards("p1")).toHaveLength(4);
	});

	test("an agent reads its card's initiative and drafts its update, which only a human publishes", async () => {
		const { t, query, board, card } = setup();
		t.places.set("/worktrees/w1", { projectId: "p1", workspaceId: "w1" });
		await query("initiative.create", {
			projectId: "p1",
			title: "Roadmap",
			outcome: "Plans follow the work",
			criteria: ["Forecasts"],
			target: "2026-12-01",
		});
		await query("project.create", {
			projectId: "p1",
			title: "Graph",
			initiativeId: "I-1",
			milestones: [{ title: "Beta" }],
		});
		await card("Own");
		await card("Abroad", {}, "p2");
		await query("card.assignProject", { cardId: "TR-1", roadmapProjectId: "P-1" });
		await query("initiative.addCards", { projectId: "p1", initiativeId: "I-1", cardIds: ["OT-1"] });
		await query("card.start", { cardId: "TR-1" });
		t.places.set("/repo", { projectId: "p1", workspaceId: "w-default" });
		const call = tools(board);
		const own = await call("board_initiative_get", {});
		const text = own.content[0]?.text ?? "";
		expect(text).toContain("I-1 · Roadmap (horizon later, target 2026-12-01)");
		expect(text).toContain("Outcome: Plans follow the work");
		expect(text).toContain("- Forecasts");
		expect(text).toContain("Health: on_track (suggested)");
		expect(text).toContain("Forecast: not enough data (history)");
		expect(text).toContain("- P-1 Graph (milestones: M-1 Beta)");
		expect(text).toContain("Cards: TR-1, OT-1 (Other Team)");
		expect(
			(await call("board_initiative_get", { initiativeId: "i-1" }, "nobody", "/repo")).details
				.initiative,
		).toMatchObject({
			id: "I-1",
		});
		expect((await call("board_initiative_get", {}, "nobody", "/repo")).content[0]?.text).toContain(
			"serves no initiative",
		);
		expect(
			(await call("board_initiative_get", { initiativeId: "I-9" }, "nobody", "/repo")).content[0]
				?.text,
		).toContain("No initiative I-9");

		const drafted = await call("board_update_draft", {
			initiativeId: "I-1",
			text: " Halfway ",
			health: "at_risk",
		});
		expect(drafted.details.update).toEqual({
			id: "U-1",
			at: NOW,
			text: "Halfway",
			health: "at_risk",
		});
		expect(board.store.initiatives("p1").initiatives[0]?.updates[0]).not.toHaveProperty(
			"publishedAt",
		);
		await call("board_update_draft", {
			initiativeId: "I-1",
			text: "Two thirds",
			health: "on_track",
		});
		expect(board.store.initiatives("p1").initiatives[0]?.updates).toHaveLength(1);
	});

	test("roadmap.chat close names initiative-close, and refuses an initiative already closed", async () => {
		const { t, query, board } = setup();
		t.projects[0] = project("p1", "ThinkRail", [
			{ id: "w-default", name: "Default", kind: "default", branch: "main" },
		]);
		await query("initiative.create", {
			projectId: "p1",
			title: "Roadmap",
			outcome: "Plans follow the work",
			criteria: ["Forecasts"],
		});
		const started = await query<{ kickoff: string }>("roadmap.chat", {
			projectId: "p1",
			kind: "close",
			initiativeId: "I-1",
		});
		expect(
			started.kickoff.startsWith("/skill:initiative-close Close initiative I-1 of the ThinkRail"),
		).toBe(true);
		expect(started.kickoff).toContain("Initiative I-1: Roadmap\nOutcome: Plans follow the work");
		for (const part of [
			"goal-and-requirements Capabilities",
			"board_cards_create_batch",
			"ask_user_question",
			'board_initiative_close { initiativeId: "I-1" }',
		])
			expect(started.kickoff).toContain(part);
		await expect(query("roadmap.chat", { projectId: "p1", kind: "close" })).rejects.toThrow(
			"Pass the initiativeId to close",
		);
		board.roadmap.closeInitiative("p1", "I-1");
		await expect(
			query("roadmap.chat", { projectId: "p1", kind: "close", initiativeId: "I-1" }),
		).rejects.toThrow("already closed");
		await query("roadmap.chat", { projectId: "p1", kind: "review" });
		expect(t.chats.at(-1)?.kickoff.text).toContain("It has no initiatives yet.");
		expect(t.chats.at(-1)?.kickoff.text).toContain("board_initiative_move");
	});

	test("an agent reads an initiative's activity, moves it once confirmed, and closes it with its deferrals listed", async () => {
		const { t, query, board, card } = setup();
		t.places.set("/worktrees/w1", { projectId: "p1", workspaceId: "w1" });
		await query("initiative.create", { projectId: "p1", title: "Roadmap", horizon: "later" });
		await card("Chart");
		await card("Export");
		await card("Elsewhere");
		await query("initiative.addCards", {
			projectId: "p1",
			initiativeId: "I-1",
			cardIds: ["TR-1", "TR-2"],
		});
		await query("card.start", { cardId: "TR-1" });
		board.note("s1", "/worktrees/w1", "Charts drawn");
		await query("card.move", { cardId: "TR-1", column: "review" });
		const call = tools(board);

		const read = await call("board_initiative_activity", { initiativeId: "i-1", sinceDays: 3 });
		const text = read.content[0]?.text ?? "";
		expect(text).toContain(
			"Activity of I-1 · Roadmap over the last 3 days (2026-11-15 to 2026-11-18)",
		);
		expect(text).toContain("Started (1): TR-1 Chart");
		expect(text).toContain("Into review (1): TR-1 Chart");
		expect(text).toContain("Filed (2): TR-1 Chart; TR-2 Export");
		expect(text).toContain("- 2026-11-18 TR-1: started → review (human");
		expect(text).toContain("- 2026-11-18 TR-1: Charts drawn");
		expect(text).not.toContain("TR-3");
		expect(
			(await call("board_initiative_activity", { initiativeId: "I-1" })).content[0]?.text,
		).toContain("over the last 7 days");
		await expect(call("board_initiative_activity", { initiativeId: "I-9" })).rejects.toThrow(
			"No initiative I-9",
		);

		const before = t.published.length;
		const moved = await call("board_initiative_move", { initiativeId: "i-1", horizon: "now" });
		expect(moved.content[0]?.text).toBe("Moved I-1 to now.");
		expect(board.store.initiatives("p1").initiatives[0]?.horizon).toBe("now");
		expect(t.published.length).toBeGreaterThan(before);

		t.facts.set("w1", facts("w1"));
		t.taskSpecs.set("w1", [{ id: "task-chart", title: "Chart", status: "done", path: "x.md" }]);
		t.sections.set("w1:task-chart:Deferrals", "- Dark mode charts\n- Export\n- [x] Done already");
		const got = (await call("board_initiative_get", { initiativeId: "I-1" })).content[0]?.text;
		expect(got).toContain("Deferrals its cards' task-specs list (not on the board yet):");
		expect(got).toContain("- Dark mode charts (from task-chart of TR-1)");
		expect(got).not.toContain("- Export (from");

		const closed = await call("board_initiative_close", { initiativeId: "I-1" });
		expect(closed.content[0]?.text).toBe("Closed I-1: Roadmap.");
		expect(board.store.initiatives("p1").initiatives[0]?.closedAt).toBe(NOW);
		expect(
			(await call("board_initiative_get", { initiativeId: "I-1" })).content[0]?.text,
		).toContain("closed 2026-11-18");
		await expect(call("board_initiative_close", { initiativeId: "I-1" })).rejects.toThrow(
			"already closed",
		);
		await call("board_initiative_create_draft", { title: "Idea", outcome: "Why" });
		await expect(call("board_initiative_close", { initiativeId: "I-2" })).rejects.toThrow(
			"a proposal",
		);
	});

	test("roadmap.publish writes the snapshot into the Default workspace through the host, at the remembered path", async () => {
		const { t, query } = setup();
		await expect(query("roadmap.publish", { projectId: "p1" })).rejects.toThrow(
			"no Default workspace",
		);
		t.projects[0] = project("p1", "ThinkRail", [
			{ id: "w-default", name: "Default", kind: "default", branch: "main" },
		]);
		await query("initiative.create", { projectId: "p1", title: "Roadmap", horizon: "now" });
		const written = await query<Record<string, unknown>>("roadmap.publish", { projectId: "p1" });
		expect(written).toMatchObject({
			projectId: "p1",
			workspaceId: "w-default",
			path: "ROADMAP.md",
		});
		expect(t.writes).toHaveLength(1);
		const [first] = t.writes;
		expect(first?.workspaceId).toBe("w-default");
		expect(first?.content.startsWith("# Roadmap — ThinkRail\n\nGenerated on 2026-11-18")).toBe(
			true,
		);
		expect(first?.content).toContain("## Now\n\n### I-1 · Roadmap");
		expect(written.bytes).toBe(Buffer.byteLength(first?.content ?? ""));

		await query("roadmap.publish", { projectId: "p1", path: "docs/ROADMAP.md" });
		expect(t.writes.at(-1)?.path).toBe("docs/ROADMAP.md");
		expect(t.writes.at(-1)?.content).toBe(first?.content);
		expect(
			(await query<{ snapshotPath: string }>("settings.get", { projectId: "p1" })).snapshotPath,
		).toBe("docs/ROADMAP.md");
		await query("roadmap.publish", { projectId: "p1" });
		expect(t.writes.at(-1)?.path).toBe("docs/ROADMAP.md");

		t.refusePaths.add("../ROADMAP.md");
		await expect(
			query("roadmap.publish", { projectId: "p1", path: "../ROADMAP.md" }),
		).rejects.toThrow("not a plain relative path");
		expect(
			(await query<{ snapshotPath: string }>("settings.get", { projectId: "p1" })).snapshotPath,
		).toBe("docs/ROADMAP.md");
		await expect(
			query("roadmap.publish", { projectId: "p1", path: "x".repeat(401) }),
		).rejects.toThrow("longer than 400");
	});

	test("insights.get answers the board's flow over the asked weeks, validated", async () => {
		const { query, card } = setup();
		await card("One");
		await query("card.move", { cardId: "TR-1", column: "building" });
		const result = await query<{ weeks: number; days: unknown[]; empty: boolean }>("insights.get", {
			projectId: "p1",
			weeks: 2,
		});
		expect(result.weeks).toBe(2);
		expect(result.days.length).toBeGreaterThan(7);
		expect(result.empty).toBe(false);
		expect((await query<{ weeks: number }>("insights.get", { projectId: "p1" })).weeks).toBe(12);
		for (const weeks of [0, 53, 1.5, "4"])
			await expect(query("insights.get", { projectId: "p1", weeks })).rejects.toThrow(
				"weeks must be",
			);
		await expect(query("insights.get", { projectId: "nope" })).rejects.toThrow("No open project");
	});
});
