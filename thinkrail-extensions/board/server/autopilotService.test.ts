import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionChatFacts, ExtensionQuery } from "@thinkrail/extension-api/server";
import { OFFER_RETRY_MS } from "./autopilot";
import type { AutopilotView } from "./autopilotService";
import { Board, type CardDetail, type RunResult } from "./board";
import { WAKE_READY, WAKE_RUN } from "./kickoff";
import type { Card, Initiative } from "./model";
import { boardQueries } from "./queries";
import { createTestHost, facts, type TestHost } from "./testHost";
import { AUTOPILOT_SECTION, createBoardTools } from "./tools";

const hosts: TestHost[] = [];
const NOW = Date.parse("2026-11-20T09:00:00Z");

function setup() {
	const t = createTestHost();
	hosts.push(t);
	const clock = { now: NOW };
	const board = new Board(t.host, { now: () => clock.now, owner: "dana", sizeDelayMs: 0 });
	const queries = boardQueries(board);
	const query = async <T>(method: string, params?: unknown): Promise<T> =>
		(await (queries[method] as ExtensionQuery)(params)) as T;
	const card = (title: string, extra: Record<string, unknown> = {}) =>
		query<Card>("card.create", { projectId: "p1", title, size: "S", column: "ready", ...extra });
	const initiative = async (cardIds: string[]) => {
		await query<Initiative>("initiative.create", {
			projectId: "p1",
			title: "Checkout",
			outcome: "Buyers pay in one step",
			criteria: ["One page", "Saved cards"],
		});
		if (cardIds.length > 0)
			await query("initiative.addCards", { projectId: "p1", initiativeId: "I-1", cardIds });
	};
	const view = () =>
		query<AutopilotView>("autopilot.get", { projectId: "p1", initiativeId: "I-1" });
	return { t, board, query, card, initiative, view, clock };
}

afterEach(() => {
	for (const t of hosts.splice(0)) rmSync(t.root, { recursive: true, force: true });
});

const chat = (sessionId: string, state: ExtensionChatFacts["state"]): ExtensionChatFacts => ({
	sessionId,
	title: sessionId,
	state,
	unread: false,
	plan: null,
	updatedAt: NOW,
});

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
	const hooks: ((event: unknown, ctx: unknown) => void)[] = [];
	createBoardTools(() => board)({
		registerTool: (tool: Registered) => registered.set(tool.name, tool),
		on: (name: string, handler: (event: unknown, ctx: unknown) => void) => {
			if (name === "before_agent_start") hooks.push(handler);
		},
	} as unknown as ExtensionAPI);
	const ctx = (sessionId: string, cwd: string) => ({
		cwd,
		sessionManager: { getSessionId: () => sessionId },
	});
	return {
		call: (name: string, params: unknown, sessionId: string, cwd = "/containers/c1") =>
			(registered.get(name) as Registered).execute(
				"call",
				params,
				undefined,
				undefined,
				ctx(sessionId, cwd),
			),
		sections: (sessionId: string) => {
			const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
			for (const hook of hooks) hook(event, ctx(sessionId, "/containers/c1"));
			return event.systemPromptOptions.sections;
		},
	};
}

describe("Run initiative", () => {
	test("starts the first ready card, makes a container of it, starts its orchestrator and briefs it", async () => {
		const { t, query, card, initiative } = setup();
		await card("Later", { column: "backlog" });
		await card("Pay page");
		await card("Saved cards");
		await query("card.link", { from: "TR-2", to: "TR-3" });
		await initiative(["TR-1", "TR-2", "TR-3"]);
		const run = await query<RunResult>("initiative.run", { projectId: "p1", initiativeId: "I-1" });
		expect(run).toEqual({
			projectId: "p1",
			initiativeId: "I-1",
			containerId: "c1",
			orchestrator: { projectId: "chats", workspaceId: "chat-c1", sessionId: "orch-c1" },
			started: { cardId: "TR-2", workspaceId: "w1", sessionId: "s1" },
		});
		expect(t.created.map((created) => created.into)).toEqual([undefined]);
		expect(t.containers).toEqual([
			{
				id: "c1",
				name: "Checkout",
				workspaceIds: ["w1"],
				orchestrator: { projectId: "chats", workspaceId: "chat-c1", sessionId: "orch-c1" },
			},
		]);
		expect(t.orchestratorStarts).toEqual(["c1"]);
		expect(t.wakes.map((wake) => [wake.containerId, wake.kind])).toEqual([["c1", WAKE_RUN]]);
		const brief = t.wakes[0]?.text ?? "";
		expect(brief).toContain(
			'This container runs initiative I-1 "Checkout" of the ThinkRail board.',
		);
		expect(brief).toContain("Outcome: Buyers pay in one step");
		expect(brief).toContain("- Saved cards");
		expect(brief).toContain('Run started TR-2 "Pay page"');
		expect(brief).toContain("Autopilot is off");
		expect(brief).toContain("board_card_start");
		const detail = await query<CardDetail>("card.get", { cardId: "TR-2" });
		expect(detail.card.category).toBe("started");
		expect(detail.transitions.at(-1)).toMatchObject({
			actor: "automation",
			reason: "started by Run initiative I-1",
		});
		const roadmap = await query<{ initiatives: Initiative[] }>("roadmap.get", { projectId: "p1" });
		expect(roadmap.initiatives[0]?.containerId).toBe("c1");
		expect(roadmap.initiatives[0]?.autopilot).toBeUndefined();
	});

	test("reuses the initiative's container: no card started, the orchestrator briefed again", async () => {
		const { t, query, card, initiative } = setup();
		await card("Pay page");
		await card("Saved cards");
		await initiative(["TR-1", "TR-2"]);
		await query("initiative.run", { projectId: "p1", initiativeId: "I-1" });
		const again = await query<RunResult>("initiative.run", {
			projectId: "p1",
			initiativeId: "I-1",
		});
		expect(again.started).toBeNull();
		expect(again.containerId).toBe("c1");
		expect(t.created).toHaveLength(1);
		expect(t.containers).toHaveLength(1);
		expect(t.wakes.at(-1)?.text).toContain("Run reused this container");
	});

	test("refuses a proposal, nothing ready, and a human-attention limit past", async () => {
		const { t, query, card, initiative } = setup();
		await card("Backlog only", { column: "backlog" });
		await initiative(["TR-1"]);
		await expect(query("initiative.run", { projectId: "p1", initiativeId: "I-1" })).rejects.toThrow(
			"No card of I-1 is ready",
		);
		await query("initiative.create", { projectId: "p1", title: "Empty" });
		await expect(query("initiative.run", { projectId: "p1", initiativeId: "I-2" })).rejects.toThrow(
			"I-2 has no cards",
		);
		await card("Ready one");
		await query("initiative.addCards", { projectId: "p1", initiativeId: "I-1", cardIds: ["TR-2"] });
		await card("In review", { column: "review" });
		await card("Also in review", { column: "review" });
		await query("settings.update", { projectId: "p1", wipLimits: { review: 1 } });
		await expect(query("initiative.run", { projectId: "p1", initiativeId: "I-1" })).rejects.toThrow(
			"Review is over its limit (2/1)",
		);
		expect(t.created).toEqual([]);
		expect(t.containers).toEqual([]);
	});
});

describe("autopilot", () => {
	async function running(extra: (s: ReturnType<typeof setup>) => Promise<void> = async () => {}) {
		const s = setup();
		await s.card("Pay page");
		await s.card("Saved cards");
		await s.card("Receipts");
		await s.initiative(["TR-1", "TR-2", "TR-3"]);
		await extra(s);
		await s.query("initiative.run", { projectId: "p1", initiativeId: "I-1" });
		s.t.facts.set("w1", facts("w1", { chats: [chat("s1", "working")] }));
		return s;
	}

	test("is off by default and switches on only once the initiative has a container", async () => {
		const { query, card, initiative, view } = setup();
		await card("Pay page");
		await initiative(["TR-1"]);
		expect((await view()).on).toBe(false);
		await expect(
			query("initiative.autopilot", { projectId: "p1", initiativeId: "I-1", on: true }),
		).rejects.toThrow("Run I-1 first");
		await expect(
			query("initiative.autopilot", { projectId: "p1", initiativeId: "I-1" }),
		).rejects.toThrow("Pass on");
	});

	test("wakes the orchestrator with the ready cards the cap allows, once, and again once after the retry", async () => {
		const { t, board, query, view, clock } = await running();
		await query("initiative.autopilot", { projectId: "p1", initiativeId: "I-1", on: true });
		await query("settings.update", { projectId: "p1", wipLimits: { agents: 2 } });
		await board.autopilot.evaluate();
		const ready = t.wakes.filter((wake) => wake.kind === WAKE_READY);
		expect(ready).toHaveLength(1);
		expect(ready[0]?.text).toContain('Autopilot of initiative I-1 "Checkout"');
		expect(ready[0]?.text).toContain(
			"1 of 2 agents run on the board, so up to 1 more may start now",
		);
		expect(ready[0]?.text).toContain('- TR-2 "Saved cards" · size S → implement');
		expect(ready[0]?.text).not.toContain("TR-3");
		expect(await view()).toMatchObject({
			on: true,
			pausedReason: null,
			running: 1,
			cap: 2,
			ready: [
				{ id: "TR-2", offered: true, stale: false },
				{ id: "TR-3", offered: false, stale: false },
			],
		});
		await board.autopilot.evaluate();
		expect(t.wakes.filter((wake) => wake.kind === WAKE_READY)).toHaveLength(1);
		clock.now += OFFER_RETRY_MS;
		await board.autopilot.evaluate();
		const again = t.wakes.filter((wake) => wake.kind === WAKE_READY);
		expect(again).toHaveLength(2);
		expect(again[1]?.text).toContain("Offered again, not started yet: TR-2.");
		clock.now += OFFER_RETRY_MS;
		await board.autopilot.evaluate();
		expect(t.wakes.filter((wake) => wake.kind === WAKE_READY)).toHaveLength(2);
		expect((await view()).ready[0]).toMatchObject({ id: "TR-2", offered: false, stale: true });
		expect(t.published.at(-1)).toMatchObject({
			type: "board.changed",
			payload: { projectId: "p1" },
		});
	});

	test("pauses itself with its reason while Review is past its limit, records it, and resumes", async () => {
		const { t, board, query, card, view } = await running();
		await query("initiative.autopilot", { projectId: "p1", initiativeId: "I-1", on: true });
		await card("Shipped", { column: "review" });
		await card("Shipped too", { column: "review" });
		await query("settings.update", { projectId: "p1", wipLimits: { review: 1 } });
		await board.autopilot.evaluate();
		expect(t.wakes.filter((wake) => wake.kind === WAKE_READY)).toEqual([]);
		const pause = { kind: "review" as const, count: 2, limit: 1 };
		expect((await view()).pausedReason).toEqual(pause);
		const roadmap = await query<{ initiatives: Initiative[] }>("roadmap.get", { projectId: "p1" });
		expect(roadmap.initiatives[0]?.autopilot).toEqual({ on: true, pausedReason: pause });
		await query("settings.update", { projectId: "p1", wipLimits: { review: 5 } });
		await board.autopilot.evaluate();
		expect(t.wakes.filter((wake) => wake.kind === WAKE_READY)).toHaveLength(1);
		const resumed = await query<{ initiatives: Initiative[] }>("roadmap.get", { projectId: "p1" });
		expect(resumed.initiatives[0]?.autopilot).toEqual({ on: true });
		await query("initiative.autopilot", { projectId: "p1", initiativeId: "I-1", on: false });
		expect(await view()).toMatchObject({ on: false, pausedReason: null });
		await board.autopilot.evaluate();
		expect(t.wakes.filter((wake) => wake.kind === WAKE_READY)).toHaveLength(1);
	});

	test("a container that went away turns autopilot off and forgets the container", async () => {
		const { t, board, query, view } = await running();
		await query("initiative.autopilot", { projectId: "p1", initiativeId: "I-1", on: true });
		t.containers.splice(0);
		await board.autopilot.evaluate();
		const roadmap = await query<{ initiatives: Initiative[] }>("roadmap.get", { projectId: "p1" });
		expect(roadmap.initiatives[0]).not.toHaveProperty("containerId");
		expect(roadmap.initiatives[0]?.autopilot).toEqual({ on: false });
		expect((await view()).container).toBeNull();
	});

	test("the container overview reads the initiative a container runs", async () => {
		const { query } = await running();
		expect(await query("autopilot.ofContainer", { containerId: "c9" })).toBeNull();
		expect(await query("autopilot.ofContainer", { containerId: "c1" })).toMatchObject({
			projectId: "p1",
			initiativeId: "I-1",
			title: "Checkout",
			on: false,
			container: { id: "c1", name: "Checkout", members: 1 },
		});
	});

	test("a human's Start of the initiative's card lands in its container", async () => {
		const { t, query } = await running();
		await query("card.start", { cardId: "TR-3" });
		expect(t.created.at(-1)?.into).toBe("c1");
		expect(t.containers[0]?.workspaceIds).toEqual(["w1", "w2"]);
	});
});

describe("board_card_start", () => {
	test("starts a ready card of the container's initiative into it, the note on its kickoff, logged as automation", async () => {
		const { t, board, query, card, initiative } = setup();
		await card("Pay page");
		await card("Saved cards", { size: "M" });
		await initiative(["TR-1", "TR-2"]);
		await query("initiative.run", { projectId: "p1", initiativeId: "I-1" });
		const { call } = tools(board);
		const answer = await call(
			"board_card_start",
			{ cardId: "tr-2", note: "Reuse the pay page's form." },
			"orch-c1",
		);
		expect(answer.content[0]?.text).toContain(
			'Started TR-2 (brainstorm) as workspace w2 of the container "Checkout"',
		);
		const created = t.created.at(-1);
		expect(created?.into).toBe("c1");
		expect(created?.kickoff.text.startsWith("/skill:brainstorming Card TR-2: Saved cards")).toBe(
			true,
		);
		expect(created?.kickoff.text).toContain(
			'Note from the orchestrator of the container "Checkout":\nReuse the pay page\'s form.',
		);
		const detail = await query<CardDetail>("card.get", { cardId: "TR-2" });
		expect(detail.transitions.at(-1)).toMatchObject({
			actor: "automation",
			reason: 'started by the orchestrator of the container "Checkout"',
		});
		expect(t.containers[0]?.workspaceIds).toEqual(["w1", "w2"]);
	});

	test("refuses outside a container, for another initiative's card, and a card not ready or blocked", async () => {
		const { t, board, query, card, initiative } = setup();
		await card("Pay page");
		await card("Saved cards");
		await card("Elsewhere");
		await card("Backlog one", { column: "backlog" });
		await card("After saved cards");
		await query("card.link", { from: "TR-2", to: "TR-5" });
		await initiative(["TR-1", "TR-2", "TR-4", "TR-5"]);
		const { call } = tools(board);
		await expect(call("board_card_start", { cardId: "TR-2" }, "s-loose", "/repo")).rejects.toThrow(
			"this chat is in no container",
		);
		await query("initiative.run", { projectId: "p1", initiativeId: "I-1" });
		await expect(call("board_card_start", { cardId: "TR-3" }, "orch-c1")).rejects.toThrow(
			'TR-3 is not a card of I-1 "Checkout", which the container "Checkout" runs',
		);
		await expect(call("board_card_start", { cardId: "TR-4" }, "orch-c1")).rejects.toThrow(
			"TR-4 is not ready to start: it is backlog",
		);
		await expect(call("board_card_start", { cardId: "TR-1" }, "orch-c1")).rejects.toThrow(
			"TR-1 is not ready to start: it is started",
		);
		await expect(call("board_card_start", { cardId: "TR-5" }, "orch-c1")).rejects.toThrow(
			"TR-5 is blocked by TR-2 (unstarted)",
		);
		await expect(call("board_card_start", { cardId: "TR-9" }, "orch-c1")).rejects.toThrow(
			"Unknown card TR-9",
		);
		t.containers.push({ id: "c2", name: "Loose", workspaceIds: ["w7"], orchestrator: null });
		t.places.set("/worktrees/w7", { projectId: "p1", workspaceId: "w7" });
		await expect(
			call("board_card_start", { cardId: "TR-2" }, "s7", "/worktrees/w7"),
		).rejects.toThrow('The container "Loose" runs no initiative');
		expect(t.created).toHaveLength(1);
	});

	test("a chat of a member workspace may start its container's initiative's cards too", async () => {
		const { t, board, query, card, initiative } = setup();
		await card("Pay page");
		await card("Saved cards");
		await initiative(["TR-1", "TR-2"]);
		await query("initiative.run", { projectId: "p1", initiativeId: "I-1" });
		t.places.set("/worktrees/w1", { projectId: "p1", workspaceId: "w1" });
		const { call } = tools(board);
		await call(
			"board_card_start",
			{ cardId: "TR-2", workflow: "implement" },
			"s1",
			"/worktrees/w1",
		);
		expect(t.created.at(-1)).toMatchObject({ into: "c1" });
	});

	test("the orchestrator's prompt names the board's tools only while its container runs an initiative", async () => {
		const { t, board, query, card, initiative } = setup();
		const { sections, call } = tools(board);
		await card("Pay page");
		await card("Follow-up");
		await initiative(["TR-1"]);
		expect(sections("orch-c1")).toEqual({});
		await query("initiative.run", { projectId: "p1", initiativeId: "I-1" });
		const rule = sections("orch-c1")[AUTOPILOT_SECTION] ?? "";
		expect(rule).toContain('This container runs the board initiative I-1 "Checkout"');
		expect(rule).toContain("board_card_start { cardId, workflow?, note? }");
		expect(sections("s1")).toEqual({});
		const filed = await call("board_card_create", { title: "Retry declined cards" }, "orch-c1");
		expect(filed.content[0]?.text).toContain("in Triage");
		expect(t.published.some((entry) => entry.type === "board.changed")).toBe(true);
	});
});
