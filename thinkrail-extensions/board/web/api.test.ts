import { describe, expect, test } from "bun:test";
import {
	adjacentColumn,
	agentBadge,
	BoardReplyError,
	boardLayout,
	COLUMNS_MIN_WIDTH,
	canStart,
	loadBoard,
	moveOnDrop,
	sortCards,
	workflowFor,
} from "./api";
import { boardOf, cardOf, fakeHost, liveOf } from "./fixtures.test";
import { startDefaults, startRequest } from "./StartSection";

describe("the agent badge", () => {
	test("reads the latest open attempt's chat state", () => {
		const badge = (live: Parameters<typeof liveOf>[0]) =>
			agentBadge(cardOf({ live: [liveOf(live)] }));
		expect(badge({})).toBe("working");
		expect(badge({ chat: { state: "needs_you", unread: false, title: "" } })).toBe("waiting");
		expect(badge({ chat: { state: "failed", unread: false, title: "" } })).toBe("failed");
		expect(badge({ chat: { state: "interrupted", unread: false, title: "" } })).toBe("failed");
		expect(badge({ chat: { state: "finished", unread: false, title: "" } })).toBe("finished");
		expect(badge({ chat: { state: "finished", unread: true, title: "" } })).toBe("unread");
		expect(badge({ chat: { state: "idle", unread: false, title: "" } })).toBeNull();
		expect(badge({ open: false })).toBeNull();
		expect(badge({ chat: null })).toBeNull();
		expect(agentBadge(cardOf())).toBeNull();
	});

	test("follows the latest attempt, not an earlier one", () => {
		const card = cardOf({
			live: [liveOf(), liveOf({ chat: { state: "needs_you", unread: false, title: "" } })],
		});
		expect(agentBadge(card)).toBe("waiting");
	});
});

describe("Start", () => {
	test("is offered on a backlog or unstarted card with no open attempt", () => {
		expect(canStart(cardOf())).toBe(true);
		expect(canStart(cardOf({ category: "unstarted", column: "ready" }))).toBe(true);
		expect(canStart(cardOf({ live: [liveOf()] }))).toBe(false);
		expect(canStart(cardOf({ live: [liveOf({ open: false })] }))).toBe(true);
		for (const category of ["triage", "started", "review", "completed", "canceled"] as const)
			expect(canStart(cardOf({ category }))).toBe(false);
	});

	test("defaults its workflow by size: S, bugs and unsized cards implement, M and L brainstorm", () => {
		expect(workflowFor({ type: "feature" })).toBe("implement");
		expect(workflowFor({ type: "feature", size: "S" })).toBe("implement");
		expect(workflowFor({ type: "feature", size: "M" })).toBe("brainstorm");
		expect(workflowFor({ type: "chore", size: "L" })).toBe("brainstorm");
		expect(workflowFor({ type: "bug", size: "L" })).toBe("implement");
		expect(startDefaults({ type: "feature", size: "M" })).toEqual({
			workflow: "brainstorm",
			model: "",
			effort: "",
			baseRef: "",
		});
	});

	test("sends only the choices the user made, leaving the host its defaults", () => {
		expect(startRequest(startDefaults({ type: "bug" }))).toEqual({ workflow: "implement" });
		expect(
			startRequest({
				workflow: "brainstorm",
				model: "acme/big",
				effort: "high",
				baseRef: " origin/main ",
			}),
		).toEqual({
			workflow: "brainstorm",
			model: "acme/big",
			thinkingLevel: "high",
			baseRef: "origin/main",
		});
	});
});

describe("moving cards", () => {
	const view = boardOf([
		cardOf(),
		cardOf({ id: "TR-2", column: "done", category: "completed", rank: 2 }),
	]);

	test("a drop onto another column calls card.move; onto its own column or nowhere, nothing", async () => {
		const { host, queries } = fakeHost();
		await moveOnDrop(host, view, "TR-1", "ready");
		expect(queries).toEqual([{ method: "card.move", params: { cardId: "TR-1", column: "ready" } }]);
		expect(moveOnDrop(host, view, "TR-1", "backlog")).toBeNull();
		expect(moveOnDrop(host, view, "TR-1", null)).toBeNull();
		expect(moveOnDrop(host, view, "TR-9", "ready")).toBeNull();
		expect(queries).toHaveLength(1);
	});

	test("Alt+arrows step across the shown columns and stop at the edges", () => {
		expect(adjacentColumn(view, { column: "backlog" }, 1)).toBe("ready");
		expect(adjacentColumn(view, { column: "backlog" }, -1)).toBeNull();
		expect(adjacentColumn(view, { column: "done" }, 1)).toBeNull();
		expect(adjacentColumn(view, { column: "triage" }, 1)).toBeNull();
	});

	test("the list sorts by column, then rank, or by rank alone", () => {
		const cards = boardOf([
			cardOf({ id: "TR-3", column: "done", rank: 1 }),
			cardOf({ id: "TR-4", column: "backlog", rank: 3 }),
			cardOf({ id: "TR-5", column: "backlog", rank: 2 }),
		]);
		expect(sortCards(cards, "column").map((card) => card.id)).toEqual(["TR-5", "TR-4", "TR-3"]);
		expect(sortCards(cards, "rank").map((card) => card.id)).toEqual(["TR-3", "TR-5", "TR-4"]);
	});
});

test("the board lays out columns once its pane is wide enough, else one stacked list", () => {
	expect(boardLayout(0)).toBe("stacked");
	expect(boardLayout(COLUMNS_MIN_WIDTH - 1)).toBe("stacked");
	expect(boardLayout(COLUMNS_MIN_WIDTH)).toBe("columns");
});

test("a reply of an unknown shape is a version skew, not a board", async () => {
	const { host, queries } = fakeHost(() => ({ nope: true }));
	await expect(loadBoard(host, "p1")).rejects.toBeInstanceOf(BoardReplyError);
	expect(queries).toEqual([{ method: "board.get", params: { projectId: "p1" } }]);
	const good = fakeHost(() => boardOf([]));
	expect((await loadBoard(good.host, "p1")).projectName).toBe("ThinkRail");
});
