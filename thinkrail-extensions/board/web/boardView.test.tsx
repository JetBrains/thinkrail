import { afterEach, describe, expect, test } from "bun:test";
import type { PanelChatTarget, PanelHost } from "@thinkrail/extension-api/web";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type AgentEntry,
	answerCard,
	answerInbox,
	attemptStart,
	BoardReplyError,
	cardIdPeekEntry,
	elapsedText,
	type InboxItem,
	loadActivity,
	loadAgents,
	loadProjects,
	sortAgents,
} from "./api";
import {
	filterCards,
	filtering,
	inQueue,
	queueCount,
	resetBoardSelection,
	selectCenterView,
	selectInitiative,
	selectProject,
	shownProject,
	toggleQueue,
} from "./boardState";
import { CardChat, cardChats, defaultCardTab } from "./CardTabs";
import { boardOf, cardOf, fakeHost, initiativeOf, liveOf, viewOf } from "./fixtures.test";
import { InitiativeDetails } from "./InitiativePanel";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

afterEach(resetBoardSelection);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const waiting = cardOf({
	id: "TR-2",
	category: "started",
	column: "designing",
	attempts: [
		{ workspaceId: "w1", sessionId: "s1", workflow: "implement", startedAt: 1, notes: [] },
	],
	live: [liveOf({ chat: { state: "needs_you", unread: false, title: "" } })],
});

describe("the navigation's filters", () => {
	const cards = [
		cardOf({ id: "TR-1", type: "bug", size: "S" }),
		waiting,
		cardOf({ id: "TR-3", category: "triage", column: "triage", createdBy: "agent", size: "M" }),
		cardOf({ id: "TR-4", category: "review", column: "review" }),
		cardOf({
			id: "TR-5",
			category: "started",
			column: "building",
			live: [liveOf({ chat: { state: "interrupted", unread: false, title: "" } })],
		}),
	];
	type Narrowing = Parameters<typeof filterCards>[1];
	const none: Narrowing = {
		initiativeId: null,
		queue: null,
		filters: { types: [], sizes: [], mine: false },
	};
	const ids = (selection: Narrowing, initiatives = [initiativeOf()]) =>
		filterCards(cards, selection, initiatives).map((card) => card.id);

	test("narrow the cards to an initiative's members, a queue, a type, a size and the human's own", () => {
		expect(ids(none)).toEqual(["TR-1", "TR-2", "TR-3", "TR-4", "TR-5"]);
		expect(filtering(none)).toBe(false);
		const members = [initiativeOf({ id: "I-1", memberCardIds: ["TR-2", "TR-4"] })];
		expect(ids({ ...none, initiativeId: "I-1" }, members)).toEqual(["TR-2", "TR-4"]);
		expect(ids({ ...none, initiativeId: "I-9" }, members)).toHaveLength(5);
		expect(ids({ ...none, queue: "needsYou" })).toEqual(["TR-2"]);
		expect(ids({ ...none, queue: "failed" })).toEqual(["TR-5"]);
		expect(ids({ ...none, queue: "triage" })).toEqual(["TR-3"]);
		expect(ids({ ...none, queue: "review" })).toEqual(["TR-4"]);
		const filters = (patch: Partial<Narrowing["filters"]>): Narrowing => ({
			...none,
			filters: { ...none.filters, ...patch },
		});
		expect(ids(filters({ types: ["bug"] }))).toEqual(["TR-1"]);
		expect(ids(filters({ sizes: ["S", "M"] }))).toEqual(["TR-1", "TR-3"]);
		expect(ids(filters({ mine: true }))).not.toContain("TR-3");
		expect(filtering(filters({ mine: true }))).toBe(true);
		expect(ids({ ...filters({ sizes: ["M"] }), queue: "triage" })).toEqual(["TR-3"]);
	});

	test("count each queue, Review against its limit", () => {
		const view = boardOf(cards, {
			wip: {
				needsYou: { count: 1, limit: 3 },
				review: { count: 1, limit: 2 },
				agents: { count: 0, limit: 3 },
			},
		});
		expect(queueCount(view, "review")).toEqual({ count: 1, limit: 2 });
		expect(queueCount(view, "needsYou")).toEqual({ count: 1, limit: 0 });
		expect(inQueue(waiting, "needsYou")).toBe(true);
	});

	test("keep the project picked while it is open, else follow the active workspace's", () => {
		const open = [{ projectId: "p1" }, { projectId: "p2" }];
		expect(shownProject(null, "p1", open)).toBe("p1");
		expect(shownProject("p2", "p1", open)).toBe("p2");
		expect(shownProject("p2", "p1", null)).toBe("p2");
		expect(shownProject("gone", "p1", open)).toBe("p1");
	});

	test("clear the initiative and the queue on a project switch, and pick a card view for a filter", async () => {
		const { useBoardSelection } = await import("./boardState");
		let seen = "";
		function Probe() {
			const selection = useBoardSelection();
			seen = `${selection.projectId}|${selection.view}|${selection.initiativeId}|${selection.queue}`;
			return null;
		}
		selectCenterView("insights");
		selectInitiative("I-1");
		html(<Probe />);
		expect(seen).toBe("null|board|I-1|null");
		toggleQueue("review");
		selectProject("p2");
		html(<Probe />);
		expect(seen).toBe("p2|board|null|null");
	});
});

describe("Board view's bottom: activity and agents", () => {
	const agent = (state: AgentEntry["state"], startedAt: number): AgentEntry => ({
		projectId: "p1",
		projectName: "ThinkRail",
		cardId: `TR-${startedAt}`,
		title: state,
		workspaceId: `w${startedAt}`,
		sessionId: `s${startedAt}`,
		state,
		startedAt,
		plan: null,
	});

	test("list the agents waiting first, then the failed, then the working, oldest first", () => {
		const sorted = sortAgents([
			agent("working", 3),
			agent("waiting", 5),
			agent("failed", 4),
			agent("working", 1),
			agent("waiting", 2),
		]);
		expect(sorted.map((entry) => entry.cardId)).toEqual(["TR-2", "TR-5", "TR-4", "TR-1", "TR-3"]);
	});

	test("word how long an agent has been on its attempt", () => {
		const start = Date.UTC(2026, 10, 20, 9);
		expect(elapsedText(start, start + 23 * MINUTE)).toBe("23m");
		expect(elapsedText(start, start + 125 * MINUTE)).toBe("2h 05m");
		expect(elapsedText(start + 10, start)).toBe("0m");
		expect(elapsedText(start, start + 3 * DAY + 5)).toBe("3d");
		expect(elapsedText(start, start + 30 * DAY + 5)).toBe("30d");
	});

	test("show the day an attempt started past a month, and nothing for a start the store does not know", () => {
		const seeded = 1_704_000_000_000;
		const now = seeded + 1055 * DAY;
		const day = new Date(seeded).toLocaleDateString(undefined, { dateStyle: "medium" });
		expect(elapsedText(seeded, now)).toBe(day);
		expect(elapsedText(seeded, seeded + 31 * DAY)).toBe(day);
		expect(elapsedText(0, now)).toBe("");
		expect(elapsedText(-5, now)).toBe("");
		expect(attemptStart(seeded)?.getTime()).toBe(seeded);
		expect(attemptStart(0)).toBeNull();
		expect(attemptStart(Number.NaN)).toBeNull();
		expect(attemptStart(9e15)).toBeNull();
	});

	test("check the activity, agents and projects answers on arrival, and send their params", async () => {
		const answers: Record<string, unknown> = {
			"activity.get": {
				entries: [{ projectId: "p1", cardId: "TR-1", at: 2, actor: "agent", from: null, to: null }],
			},
			"agents.get": { agents: [agent("working", 1)] },
			"projects.list": { projects: [{ projectId: "p1", name: "ThinkRail", cards: 2 }] },
		};
		const { host, queries } = fakeHost((method) => answers[method]);
		expect(await loadActivity(host, { limit: 50 })).toHaveLength(1);
		expect((await loadAgents(host))[0]?.state).toBe("working");
		expect((await loadProjects(host))[0]?.name).toBe("ThinkRail");
		expect(queries).toEqual([
			{ method: "activity.get", params: { limit: 50 } },
			{ method: "agents.get", params: {} },
			{ method: "projects.list", params: {} },
		]);
		const bad = fakeHost(() => ({ agents: [{ ...agent("working", 1), state: "idle" }] }));
		await expect(loadAgents(bad.host)).rejects.toBeInstanceOf(BoardReplyError);
	});

	test("peek a card known only by its id", () => {
		expect(cardIdPeekEntry("p1", "TR-7", "Ship")).toEqual({
			kind: "extension",
			panel: "card",
			params: { projectId: "p1", cardId: "TR-7" },
			title: "TR-7 · Ship",
		});
	});
});

describe("the card's tabs", () => {
	test("open on the chat while the agent waits or failed, else on the details", () => {
		expect(defaultCardTab(waiting)).toBe("chat");
		expect(
			defaultCardTab(
				cardOf({ live: [liveOf({ chat: { state: "failed", unread: false, title: "" } })] }),
			),
		).toBe("chat");
		expect(defaultCardTab(cardOf({ live: [liveOf()] }))).toBe("details");
		expect(defaultCardTab(cardOf())).toBe("details");
	});

	test("show the latest open attempt's live chat through the host, with a picker when several are open", () => {
		const { host, chats } = fakeHost();
		const markup = html(<CardChat host={host} projectId="p1" card={waiting} />);
		expect(chats).toEqual([{ workspaceId: "w1", sessionId: "s1" }]);
		expect(markup).toContain("chat:w1/s1");
		expect(markup).toContain('data-badge="waiting"');
		expect(markup).not.toContain('data-testid="board-card-chat-attempt"');
		const twice = cardOf({
			attempts: [
				{ workspaceId: "w1", sessionId: "s1", workflow: "brainstorm", startedAt: 1, notes: [] },
				{ workspaceId: "w2", sessionId: "s2", workflow: "implement", startedAt: 2, notes: [] },
				{ workspaceId: "w3", sessionId: "s3", workflow: "implement", startedAt: 3, notes: [] },
			],
			live: [
				liveOf(),
				liveOf({ workspaceId: "w2", sessionId: "s2", open: false, chat: null }),
				liveOf({ workspaceId: "w3", sessionId: "s3" }),
			],
		});
		expect(cardChats(twice).map((chat) => chat.sessionId)).toEqual(["s1", "s3"]);
		const picked = html(<CardChat host={host} projectId="p1" card={twice} />);
		expect(picked).toContain('data-testid="board-card-chat-attempt"');
		expect(picked).toContain("chat:w3/s3");
		expect(html(<CardChat host={host} projectId="p1" card={cardOf()} />)).toContain("No chat yet");
	});
});

describe("the inbox's Answer", () => {
	const item: InboxItem = {
		projectId: "p2",
		projectName: "payments-api",
		reason: "needs_you",
		card: waiting,
	};

	test("opens the card in Peek, on its chat, with a workspace active; else the attempt's chat", () => {
		const { host, peeks } = fakeHost();
		const opened: unknown[] = [];
		expect(answerInbox({ ...host, openChat: (target) => opened.push(target) }, item)).toBe("peek");
		expect(peeks).toEqual([
			{
				kind: "extension",
				panel: "card",
				params: { projectId: "p2", cardId: "TR-2" },
				title: "TR-2 · Ship the board",
			},
		]);
		expect(opened).toEqual([]);
		expect(
			answerInbox({ ...host, scope: null, openChat: (target) => opened.push(target) }, item),
		).toBe("chat");
		expect(opened).toEqual([{ projectId: "p2", workspaceId: "w1", sessionId: "s1" }]);
	});
});

describe("the initiative panel's Agents now", () => {
	const failed = cardOf({
		id: "TR-5",
		category: "started",
		column: "building",
		live: [
			liveOf({
				workspaceId: "w5",
				sessionId: "s5",
				chat: { state: "failed", unread: false, title: "" },
			}),
		],
	});
	const working = cardOf({
		id: "TR-6",
		category: "started",
		column: "building",
		live: [liveOf({ workspaceId: "w6", sessionId: "s6" })],
	});
	const initiative = initiativeOf({ id: "I-1", memberCardIds: ["TR-2", "TR-5", "TR-6"] });
	const rows = (markup: string) =>
		new Map(
			markup
				.split('data-testid="board-initiative-agent"')
				.slice(1)
				.map((row) => [/data-card-id="([^"]+)"/.exec(row)?.[1] ?? "", row]),
		);

	test("offer Answer or Retry on the cards that need the human, and Open workspace on each", () => {
		const { host } = fakeHost();
		const markup = html(
			<InitiativeDetails
				host={host}
				view={viewOf([initiative])}
				board={boardOf([waiting, failed, working])}
				initiative={initiative}
				write={() => {}}
				onError={() => {}}
				onDeleted={() => {}}
			/>,
		);
		const byCard = rows(markup);
		expect([...byCard.keys()]).toEqual(["TR-2", "TR-5", "TR-6"]);
		expect(byCard.get("TR-2")).toContain('data-testid="board-initiative-agent-answer"');
		expect(byCard.get("TR-2")).toContain("Answer");
		expect(byCard.get("TR-5")).toContain("Retry");
		expect(byCard.get("TR-6")).not.toContain('data-testid="board-initiative-agent-answer"');
		for (const row of byCard.values())
			expect(row).toContain('data-testid="board-initiative-agent-workspace"');
	});

	test("Answer shows the card in Peek, opened on its Chat tab, never switching workspace", () => {
		const { host, peeks, workspaces } = fakeHost();
		const opened: PanelChatTarget[] = [];
		const spy: PanelHost = { ...host, openChat: (target) => opened.push(target) };
		answerCard(spy, "p1", waiting);
		expect(peeks).toEqual([
			{
				kind: "extension",
				panel: "card",
				params: { projectId: "p1", cardId: "TR-2" },
				title: "TR-2 · Ship the board",
			},
		]);
		expect(opened).toEqual([]);
		expect(workspaces).toEqual([]);
		expect(defaultCardTab(waiting)).toBe("chat");
		expect(defaultCardTab(failed)).toBe("chat");
	});
});
