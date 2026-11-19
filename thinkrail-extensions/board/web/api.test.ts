import { describe, expect, test } from "bun:test";
import {
	acceptTriage,
	adjacentColumn,
	agentBadge,
	attentionOverLimit,
	attentionWarning,
	BoardReplyError,
	boardLayout,
	COLUMNS_MIN_WIDTH,
	canStart,
	columnWip,
	enterCard,
	inboxTarget,
	loadBoard,
	loadInbox,
	moveOnDrop,
	overLimit,
	selectCard,
	setFollowSelection,
	setWipLimits,
	sortCards,
	triageGroups,
	workflowFor,
	workingAction,
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

	test("names what a working agent does, from its latest attempt, only while it works", () => {
		const lastAction = { tool: "edit", target: "src/a.ts", at: 1 };
		const working = liveOf({ chat: { state: "working", unread: false, title: "", lastAction } });
		expect(workingAction(cardOf({ live: [working] }))).toEqual(lastAction);
		expect(
			workingAction(
				cardOf({
					live: [liveOf({ chat: { state: "finished", unread: false, title: "", lastAction } })],
				}),
			),
		).toBeUndefined();
		expect(workingAction(cardOf({ live: [working, liveOf()] }))).toBeUndefined();
		expect(workingAction(cardOf({ live: [{ ...working, open: false }] }))).toBeUndefined();
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
		expect(queries).toEqual([
			{ method: "card.move", params: { cardId: "TR-1", column: "ready", projectId: "p1" } },
		]);
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

describe("WIP, Triage and the inbox", () => {
	const wip = (review: [number, number], needsYou: [number, number] = [0, 3]) =>
		boardOf([], {
			wip: {
				needsYou: { count: needsYou[0], limit: needsYou[1] },
				review: { count: review[0], limit: review[1] },
				agents: { count: 0, limit: 3 },
			},
		});

	test("a count is over its limit only past it, and a limit of 0 is none", () => {
		expect(overLimit({ count: 3, limit: 2 })).toBe(true);
		expect(overLimit({ count: 2, limit: 2 })).toBe(false);
		expect(overLimit({ count: 9, limit: 0 })).toBe(false);
	});

	test("Start warns about Review first, then Needs you, and not about agents", () => {
		expect(attentionWarning(wip([6, 5], [4, 3]))).toEqual({ key: "review", n: 6, limit: 5 });
		expect(attentionWarning(wip([5, 5], [4, 3]))).toEqual({ key: "needsYou", n: 4, limit: 3 });
		expect(attentionWarning(wip([5, 5]))).toBeNull();
		expect(attentionWarning(null)).toBeNull();
		expect(attentionOverLimit(wip([6, 5]))).toEqual(["review"]);
		expect(attentionOverLimit(wip([6, 5], [4, 3]))).toEqual(["review", "needsYou"]);
		expect(attentionOverLimit(wip([5, 5], [4, 3]))).toEqual(["needsYou"]);
		expect(attentionOverLimit(wip([5, 5]))).toEqual([]);
	});

	test("only a column of Review cards carries the Review limit", () => {
		const view = wip([1, 5]);
		const limits = view.columns.map((column) => [column.id, columnWip(view, column)]);
		expect(limits.filter(([, limit]) => limit !== null)).toEqual([
			["review", { count: 1, limit: 5 }],
		]);
		expect(columnWip(view, { id: "doing", categories: ["started", "review"] })).toBeNull();
	});

	test("groups Triage cards by the chat that filed them, by rank, with the chat's own card", () => {
		const view = boardOf([
			cardOf({
				id: "TR-4",
				category: "triage",
				column: "triage",
				rank: 4,
				origin: { sessionId: "s1", cardId: "TR-1" },
			}),
			cardOf({
				id: "TR-2",
				category: "triage",
				column: "triage",
				rank: 2,
				origin: { sessionId: "s1", cardId: "TR-1" },
			}),
			cardOf({ id: "TR-3", category: "triage", column: "triage", rank: 3 }),
			cardOf({
				id: "TR-5",
				category: "triage",
				column: "triage",
				rank: 5,
				origin: { sessionId: "s2" },
			}),
			cardOf({ id: "TR-1", rank: 1 }),
		]);
		expect(
			triageGroups(view).map(({ key, cardId, cards }) => [
				key,
				cardId,
				cards.map((card) => card.id),
			]),
		).toEqual([
			["s1", "TR-1", ["TR-2", "TR-4"]],
			["", null, ["TR-3"]],
			["s2", null, ["TR-5"]],
		]);
	});

	test("reads the inbox, refusing an unknown shape, and answers in the latest attempt's chat", async () => {
		const card = cardOf({
			category: "started",
			column: "building",
			live: [
				liveOf({
					workspaceId: "w7",
					sessionId: "s7",
					chat: { state: "needs_you", unread: false, title: "" },
				}),
			],
		});
		const item = { projectId: "p2", projectName: "Payments", reason: "needs_you" as const, card };
		const { host, queries } = fakeHost(() => ({ items: [item] }));
		expect(await loadInbox(host)).toEqual([item]);
		expect(queries).toEqual([{ method: "inbox", params: {} }]);
		await expect(loadInbox(fakeHost(() => ({ items: [{ card }] })).host)).rejects.toBeInstanceOf(
			BoardReplyError,
		);
		expect(inboxTarget(item)).toEqual({ projectId: "p2", workspaceId: "w7", sessionId: "s7" });
		expect(inboxTarget({ ...item, card: { ...card, live: [liveOf({ open: false })] } })).toBeNull();
	});

	test("accepts Triage cards and saves WIP limits through the board's queries", async () => {
		const { host, queries } = fakeHost();
		await acceptTriage(host, ["TR-2", "TR-4"]);
		await setWipLimits(host, "p1", { needsYou: 2, review: 1, agents: 4 });
		expect(queries).toEqual([
			{ method: "triage.accept", params: { cardIds: ["TR-2", "TR-4"] } },
			{
				method: "settings.update",
				params: { projectId: "p1", wipLimits: { needsYou: 2, review: 1, agents: 4 } },
			},
		]);
	});
});

describe("selecting a card", () => {
	const running = cardOf({
		category: "started",
		column: "building",
		live: [
			liveOf({ workspaceId: "w1", open: false }),
			liveOf({ workspaceId: "w2", sessionId: "s2" }),
		],
	});
	const peekOf = (card: typeof running) => ({
		kind: "extension" as const,
		panel: "card",
		params: { projectId: "p1", cardId: card.id },
		title: `${card.id} · ${card.title}`,
	});

	test("a click only peeks the card while follow selection is off", () => {
		const { host, peeks, workspaces } = fakeHost();
		expect(selectCard(host, "p1", running, false)).toBe("peek");
		expect(peeks).toEqual([peekOf(running)]);
		expect(workspaces).toEqual([]);
	});

	test("with follow selection a click enters the open attempt's chat and peeks the card there", () => {
		const { host, peeks, workspaces } = fakeHost();
		expect(selectCard(host, "p1", running, true)).toBe("follow");
		expect(peeks).toEqual([]);
		expect(workspaces).toEqual([
			{ workspaceId: "w2", projectId: "p1", sessionId: "s2", peek: peekOf(running) },
		]);
	});

	test("with follow selection a card without an open attempt still only peeks", () => {
		const { host, peeks, workspaces } = fakeHost();
		const idle = cardOf({ live: [liveOf({ open: false })] });
		expect(selectCard(host, "p1", idle, true)).toBe("peek");
		expect(selectCard(host, "p1", cardOf(), true)).toBe("peek");
		expect(peeks).toHaveLength(2);
		expect(workspaces).toEqual([]);
	});

	test("a double click enters the open attempt's workspace, on its chat when it has one", () => {
		const { host, workspaces } = fakeHost();
		expect(enterCard(host, "p1", running)).toBe(true);
		expect(enterCard(host, "p1", cardOf({ live: [liveOf({ chat: null })] }))).toBe(true);
		expect(enterCard(host, "p1", cardOf())).toBe(false);
		expect(workspaces).toEqual([
			{ workspaceId: "w2", projectId: "p1", sessionId: "s2" },
			{ workspaceId: "w1", projectId: "p1" },
		]);
	});

	test("saves follow selection through the board's settings", async () => {
		const { host, queries } = fakeHost();
		await setFollowSelection(host, "p1", true);
		expect(queries).toEqual([
			{ method: "settings.update", params: { projectId: "p1", followSelection: true } },
		]);
	});
});
