import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionQuery, Workspace } from "@thinkrail/extension-api/server";
import { Board, type BoardView, type CardView } from "./board";
import extension from "./index";
import type { Card } from "./model";
import { boardQueries } from "./queries";
import { createTestHost, facts, project, type TestHost } from "./testHost";
import { createBoardTools } from "./tools";

const hosts: TestHost[] = [];

function setup() {
	const t = createTestHost();
	hosts.push(t);
	let now = 1_000;
	const board = new Board(t.host, { now: () => ++now, owner: "dana", sizeDelayMs: 0 });
	const queries = boardQueries(board);
	const query = async <T>(method: string, params?: unknown): Promise<T> =>
		(await (queries[method] as ExtensionQuery)(params)) as T;
	return { t, board, query };
}

afterEach(() => {
	for (const t of hosts.splice(0)) rmSync(t.root, { recursive: true, force: true });
});

describe("board queries", () => {
	test("create cards with sequential ids under the project's prefix, into Backlog by default", async () => {
		const { t, query } = setup();
		const first = await query<Card>("card.create", { projectId: "p1", title: " Inbox " });
		const second = await query<Card>("card.create", {
			projectId: "p1",
			title: "Ready one",
			column: "ready",
			size: "M",
			acceptance: ["a", " "],
		});
		expect([first.id, second.id]).toEqual(["TR-1", "TR-2"]);
		expect(first).toMatchObject({
			title: "Inbox",
			category: "backlog",
			column: "backlog",
			createdBy: "human",
			ownerHuman: "dana",
			source: { kind: "native", ref: "TR-1" },
		});
		expect(second).toMatchObject({
			category: "unstarted",
			column: "ready",
			size: "M",
			acceptance: ["a"],
		});
		expect(second).not.toHaveProperty("sizeSuggested");
		expect(second.rank).toBeGreaterThan(first.rank);
		expect(t.published.at(-1)).toEqual({
			type: "board.changed",
			payload: { projectId: "p1" },
			scope: { projectId: "p1" },
		});
	});

	test("give a second project's board a prefix of its own", async () => {
		const { t, query } = setup();
		t.projects.push(project("p2", "Thin Rope"));
		await query("card.create", { projectId: "p1", title: "One" });
		expect((await query<Card>("card.create", { projectId: "p2", title: "Two" })).id).toBe("TRH-1");
	});

	test("validate their params before touching the board", async () => {
		const { query } = setup();
		const refusals: [string, unknown, string][] = [
			["board.get", { projectId: "nope" }, "No open project"],
			["board.get", "p1", "object of params"],
			["card.create", { projectId: "p1" }, "non-empty title"],
			["card.create", { projectId: "p1", title: "x".repeat(301) }, "longer than"],
			["card.create", { projectId: "p1", title: "x", type: "epic" }, "type must be one of"],
			["card.create", { projectId: "p1", title: "x", size: "XL" }, "size must be one of"],
			["card.create", { projectId: "p1", title: "x", acceptance: "a" }, "list of at most"],
			["card.create", { projectId: "p1", title: "x", column: "nowhere" }, "no column"],
			["card.update", { cardId: "TR-1", cancelPending: true }, "only be dismissed"],
			["card.move", { cardId: "TR-1" }, "non-empty column"],
			["card.move", { cardId: "not an id", column: "ready" }, "Not a card id"],
			["card.get", { cardId: "TR-99" }, "Unknown card"],
			["triage.accept", { cardIds: [] }, "cardIds"],
			["card.start", { cardId: "TR-1", workflow: "yolo" }, "workflow must be one of"],
			["card.start", { cardId: "TR-1", thinkingLevel: "loud" }, "thinkingLevel must be one of"],
			["settings.update", { projectId: "p1", preset: "scrum" }, "preset must be one of"],
			["settings.update", { projectId: "p1", wipLimits: { review: -1 } }, "whole number"],
			["settings.update", { projectId: "p1", followSelection: "yes" }, "true or false"],
		];
		for (const [method, params, message] of refusals)
			await expect(query(method, params)).rejects.toThrow(message);
	});

	test("update, move by hand with a logged override, and delete with its links", async () => {
		const { board, query } = setup();
		await query("card.create", { projectId: "p1", title: "Blocker" });
		await query("card.create", { projectId: "p1", title: "Blocked" });
		const updated = await query<Card>("card.update", {
			cardId: "tr-1",
			description: "Do it",
			blocks: ["TR-2"],
			size: "S",
		});
		expect(updated).toMatchObject({ description: "Do it", blocks: ["TR-2"], size: "S" });
		await expect(query("card.update", { cardId: "TR-1", blocks: ["TR-1"] })).rejects.toThrow(
			"cannot block itself",
		);
		await expect(query("card.update", { cardId: "TR-1", blocks: ["TR-9"] })).rejects.toThrow(
			"not a card of",
		);
		const moved = await query<Card>("card.move", { cardId: "TR-2", column: "review", rank: 0.5 });
		expect(moved).toMatchObject({ category: "review", column: "review", rank: 0.5 });
		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(view.cards.map((card) => card.id)).toEqual(["TR-2", "TR-1"]);
		expect(view.cards[0]?.blockedBy).toEqual(["TR-1"]);
		const detail = await query<{ transitions: { actor: string; reason: string }[] }>("card.get", {
			cardId: "TR-2",
		});
		expect(detail.transitions.map(({ actor, reason }) => `${actor}: ${reason}`)).toEqual([
			"human: created",
			"human: moved by hand",
		]);
		expect(await query("card.delete", { cardId: "TR-2" })).toEqual({ deleted: "TR-2" });
		expect(board.find("TR-1").blocks).toEqual([]);
		expect(board.store.transitions("p1").at(-1)).toMatchObject({ cardId: "TR-2", to: null });
	});

	test("accept a decomposition from Triage as a whole, or nothing", async () => {
		const { board, query } = setup();
		const a = board.createCard("p1", { title: "Part A", size: "S" }, "agent");
		const b = board.createCard("p1", { title: "Part B" }, "agent");
		await query("card.create", { projectId: "p1", title: "Human" });
		expect(a).toMatchObject({
			category: "triage",
			column: "triage",
			createdBy: "agent",
			sizeSuggested: true,
		});
		await expect(query("triage.accept", { cardIds: [a.id, "TR-3"] })).rejects.toThrow(
			"Not in Triage: TR-3",
		);
		expect(board.find(a.id).category).toBe("triage");
		const accepted = await query<Card[]>("triage.accept", { cardIds: [a.id, b.id] });
		expect(accepted.map((card) => `${card.id}:${card.category}/${card.column}`)).toEqual([
			"TR-1:backlog/backlog",
			"TR-2:backlog/backlog",
		]);
	});

	test("start a card: the kickoff from the card, the workflow by size, the attempt recorded, the card started", async () => {
		const { t, query } = setup();
		await query("card.create", {
			projectId: "p1",
			title: "Board inbox",
			size: "M",
			acceptance: ["Lists waiting cards"],
			specRefs: ["module-ext-board"],
		});
		await query("card.create", { projectId: "p1", title: "Typo", type: "bug", size: "L" });
		const started = await query<{ card: Card }>("card.start", {
			cardId: "TR-1",
			model: "acme/big",
			thinkingLevel: "high",
			baseRef: "release",
		});
		expect(t.created[0]).toEqual({
			projectId: "p1",
			baseRef: "release",
			kickoff: {
				text: "/skill:brainstorming Card TR-1: Board inbox\n\nAcceptance criteria:\n- Lists waiting cards\n\nSpecs:\n- module-ext-board",
				model: "acme/big",
				thinkingLevel: "high",
			},
		});
		expect(started.card).toMatchObject({ category: "started", column: "designing" });
		expect(started.card.attempts).toEqual([
			{
				workspaceId: "w1",
				sessionId: "s1",
				workflow: "brainstorm",
				startedAt: expect.any(Number),
				notes: [],
			},
		]);
		const bug = await query<{ card: Card }>("card.start", { cardId: "TR-2" });
		expect(t.created[1]?.kickoff.text).toBe("Card TR-2: Typo");
		expect(bug.card).toMatchObject({ column: "building" });
		const chosen = await query<{ card: Card }>("card.start", {
			cardId: "TR-2",
			workflow: "brainstorm",
		});
		expect(chosen.card.attempts.map((attempt) => attempt.workflow)).toEqual([
			"implement",
			"brainstorm",
		]);
		expect(chosen.card.column).toBe("designing");
	});

	test("refuse to start a Triage card or one that is already starting", async () => {
		const { t, board, query } = setup();
		const triage = board.createCard("p1", { title: "Triage" }, "agent");
		await expect(query("card.start", { cardId: triage.id })).rejects.toThrow(
			"Accept TR-1 from Triage",
		);
		await query("card.create", { projectId: "p1", title: "Once" });
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const create = t.host.actions.createWorkspace;
		(t.host.actions as { createWorkspace: typeof create }).createWorkspace = async (params) => {
			await gate;
			return create(params);
		};
		const first = query("card.start", { cardId: "TR-2" });
		await expect(query("card.start", { cardId: "TR-2" })).rejects.toThrow("already starting");
		release();
		await first;
		expect(t.created).toHaveLength(1);
	});

	test("compute live overlays and WIP from host facts per request, never storing them", async () => {
		const { t, board, query } = setup();
		await query("card.create", { projectId: "p1", title: "Working" });
		await query("card.create", { projectId: "p1", title: "Waiting" });
		await query("card.start", { cardId: "TR-1" });
		await query("card.start", { cardId: "TR-2" });
		t.facts.set(
			"w1",
			facts("w1", {
				diff: { added: 12, removed: 3 },
				review: { kind: "pull-request", number: 9, state: "open" },
				chats: [
					{
						sessionId: "s1",
						title: "Work",
						state: "working",
						unread: false,
						plan: { open: 1, total: 3 },
						updatedAt: 1,
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
						title: "Ask",
						state: "needs_you",
						unread: true,
						plan: null,
						updatedAt: 1,
					},
				],
			}),
		);
		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(view.cards[0]?.live).toEqual([
			{
				workspaceId: "w1",
				sessionId: "s1",
				open: true,
				chat: { state: "working", unread: false, title: "Work" },
				plan: { open: 1, total: 3 },
				diff: { added: 12, removed: 3 },
				pr: { kind: "pull-request", number: 9, state: "open" },
			},
		]);
		expect(view.wip).toEqual({
			needsYou: { count: 1, limit: 3 },
			review: { count: 0, limit: 5 },
			agents: { count: 1, limit: 3 },
		});
		expect(view).toMatchObject({
			prefix: "TR",
			projectName: "ThinkRail",
			settings: { preset: "agentic-kanban" },
		});
		expect(view.columns.map((column) => column.id)).toContain("designing");
		expect(JSON.stringify(board.store.cards("p1"))).not.toContain("needs_you");

		t.facts.delete("w1");
		const gone = await query<BoardView>("board.get", { projectId: "p1" });
		expect(gone.cards[0]?.live[0]).toMatchObject({ open: false, chat: null, pr: null });
	});

	test("carry a chat's last action into its attempt's overlay, as the host reports it", async () => {
		const { t, query } = setup();
		await query("card.create", { projectId: "p1", title: "Working" });
		await query("card.start", { cardId: "TR-1" });
		const lastAction = { tool: "edit", target: "src/board.ts", at: 5 };
		t.facts.set(
			"w1",
			facts("w1", {
				chats: [
					{
						sessionId: "s1",
						title: "Work",
						state: "working",
						unread: false,
						plan: null,
						updatedAt: 1,
						lastAction,
					},
				],
			}),
		);
		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(view.cards[0]?.live[0]?.chat).toEqual({
			state: "working",
			unread: false,
			title: "Work",
			lastAction,
		});
		const detail = await query<{ card: CardView }>("card.get", { cardId: "TR-1" });
		expect(detail.card.live[0]?.chat?.lastAction).toEqual(lastAction);
	});

	test("gather the cards that wait for the human or failed, across the open projects", async () => {
		const { t, board, query } = setup();
		t.projects.push(project("p2", "Other"));
		for (const [projectId, title] of [
			["p1", "Waiting"],
			["p1", "Fine"],
			["p2", "Failed"],
			["p2", "Stopped"],
		] as const) {
			const card = board.createCard(projectId, { title }, "human");
			await query("card.start", { cardId: card.id });
		}
		const chat = (
			sessionId: string,
			state: "needs_you" | "finished" | "failed" | "interrupted",
		) => ({
			sessionId,
			title: "",
			state,
			unread: false,
			plan: null,
			updatedAt: 1,
		});
		t.facts.set("w1", facts("w1", { chats: [chat("s1", "needs_you")] }));
		t.facts.set("w2", facts("w2", { chats: [chat("s2", "finished")] }));
		t.facts.set("w3", facts("w3", { projectId: "p2", chats: [chat("s3", "failed")] }));
		t.facts.set("w4", facts("w4", { projectId: "p2", chats: [chat("s4", "interrupted")] }));
		const { items } = await query<{
			items: { projectName: string; reason: string; card: CardView }[];
		}>("inbox", {});
		expect(items.map((item) => [item.projectName, item.reason, item.card.title])).toEqual([
			["ThinkRail", "needs_you", "Waiting"],
			["Other", "failed", "Failed"],
			["Other", "failed", "Stopped"],
		]);
	});

	test("switch presets by remapping every card's column from its category", async () => {
		const { query } = setup();
		await query("card.create", { projectId: "p1", title: "Ready", column: "ready" });
		await query("card.create", { projectId: "p1", title: "Review", column: "review" });
		const settings = await query("settings.update", {
			projectId: "p1",
			preset: "solo",
			wipLimits: { review: 2 },
			followSelection: true,
		});
		expect(settings).toEqual({
			preset: "solo",
			wipLimits: { needsYou: 3, review: 2, agents: 3 },
			followSelection: true,
			github: { enabled: false, filter: "open" },
		});
		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(view.cards.map((card) => `${card.category}/${card.column}`)).toEqual([
			"unstarted/todo",
			"review/doing",
		]);
		expect(await query("settings.get", { projectId: "p1" })).toEqual(settings);
	});

	test("list the host's new-chat models for the Start dialog, as host facts", async () => {
		const { t, query } = setup();
		const models = [
			{
				id: "acme/big",
				name: "Big",
				provider: "acme",
				thinkingLevels: ["off" as const, "high" as const],
			},
		];
		t.host.models = async () => models;
		expect(await query("models.list")).toEqual({ models });
		await expect(query("models.list", "nope")).rejects.toThrow("object of params");
	});
});

describe("board rules over host events", () => {
	async function started(setupResult: ReturnType<typeof setup>) {
		const { board, query } = setupResult;
		const stop = board.listen();
		await query("card.create", { projectId: "p1", title: "Card" });
		await query("card.start", { cardId: "TR-1" });
		return stop;
	}

	test("a settle with changes moves the card to review; a merge completes it; replays change nothing", async () => {
		const s = setup();
		const { t, board } = s;
		await started(s);
		t.facts.set("w1", facts("w1", { chats: [] }));
		t.emit("agent.settled", { workspaceId: "w1", sessionId: "s1" });
		await board.idle();
		expect(board.find("TR-1").category).toBe("started");

		t.facts.set("w1", facts("w1", { diff: { added: 1, removed: 0 } }));
		t.emit("agent.settled", { workspaceId: "w1", sessionId: "s1" });
		t.emit("agent.settled", { workspaceId: "w1", sessionId: "s1" });
		await board.idle();
		expect(board.find("TR-1")).toMatchObject({ category: "review", column: "review" });

		const workspace: Workspace = {
			id: "w1",
			projectId: "p1",
			name: "w1",
			branch: "w1",
			worktreePath: "/w1",
			baseBranch: "main",
			review: { kind: "pull-request", number: 3, state: "merged" },
		};
		t.emit("workspace.updated", workspace);
		t.emit("workspace.updated", workspace);
		await board.idle();
		expect(board.find("TR-1")).toMatchObject({ category: "completed", column: "done" });
		t.emit("workspace.removed", { projectId: "p1", id: "w1" });
		await board.idle();
		expect(board.find("TR-1").cancelPending).toBeUndefined();
		expect(
			board.store.transitions("p1").map((entry) => `${entry.actor}: ${entry.to?.category}`),
		).toEqual(["human: backlog", "automation: started", "automation: review", "git: completed"]);
	});

	test("a move by hand after a merge stands through repeated merged updates and a restart", async () => {
		const s = setup();
		const { t, board, query } = s;
		const stop = await started(s);
		const workspace: Workspace = {
			id: "w1",
			projectId: "p1",
			name: "w1",
			branch: "w1",
			worktreePath: "/w1",
			baseBranch: "main",
			review: { kind: "pull-request", number: 3, state: "merged" },
		};
		t.emit("workspace.updated", workspace);
		await board.idle();
		expect(board.find("TR-1").category).toBe("completed");
		await query("card.move", { cardId: "TR-1", column: "review" });
		t.emit("workspace.updated", workspace);
		await board.idle();
		expect(board.find("TR-1")).toMatchObject({ category: "review", column: "review" });
		stop();
		const restarted = new Board(t.host, { owner: "dana" });
		restarted.listen();
		t.emit("workspace.updated", workspace);
		await restarted.idle();
		expect(restarted.find("TR-1")).toMatchObject({ category: "review", column: "review" });
	});

	test("a plan done settles into review; a removed unmerged workspace only asks to cancel", async () => {
		const s = setup();
		const { t, board, query } = s;
		await started(s);
		t.facts.set(
			"w1",
			facts("w1", {
				chats: [
					{
						sessionId: "s1",
						title: "",
						state: "finished",
						unread: true,
						plan: { open: 0, total: 2 },
						updatedAt: 1,
					},
				],
			}),
		);
		t.emit("agent.settled", { workspaceId: "w1", sessionId: "s1" });
		await board.idle();
		expect(board.find("TR-1").category).toBe("review");
		t.emit("workspace.removed", { projectId: "p1", id: "w1" });
		await board.idle();
		expect(board.find("TR-1")).toMatchObject({
			category: "review",
			cancelPending: { workspaceId: "w1" },
		});
		await query("card.update", { cardId: "TR-1", cancelPending: false });
		expect(board.find("TR-1").cancelPending).toBeUndefined();
	});

	test("ignore unbound workspaces, republish a bound chat's state change once, and stop listening", async () => {
		const s = setup();
		const { t, board } = s;
		const stop = await started(s);
		const before = t.published.length;
		const record = (execution: "idle" | "running") => ({
			sessionId: "s1",
			workspaceId: "w1",
			projectId: "p1",
			state: {
				execution,
				runId: null,
				needsInput: null,
				completion: null,
				completionUnread: false,
				queuedCount: 0,
				backgroundWork: false,
			},
		});
		t.emit("session.state", record("running"));
		t.emit("session.state", record("running"));
		t.emit("session.state", { ...record("running"), workspaceId: "elsewhere", sessionId: "x" });
		t.emit("agent.settled", { workspaceId: "elsewhere", sessionId: "x" });
		await board.idle();
		expect(t.published.length - before).toBe(1);
		stop();
		expect(t.listeners()).toBe(0);
	});

	test("republish a bound chat's tool starts at most once per window, the last one included", async () => {
		const t = createTestHost();
		hosts.push(t);
		const board = new Board(t.host, { owner: "dana", sizeDelayMs: 0, actionRefreshMs: 40 });
		const stop = board.listen();
		const card = board.createCard("p1", { title: "Card" }, "human");
		await boardQueries(board)["card.start"]?.({ cardId: card.id });
		const changes = () => t.published.filter((entry) => entry.type === "board.changed").length;
		const before = changes();
		t.emit("agent.tool", { workspaceId: "w1", sessionId: "s1" });
		t.emit("agent.tool", { workspaceId: "w1", sessionId: "s1" });
		t.emit("agent.tool", { workspaceId: "w1", sessionId: "s1" });
		t.emit("agent.tool", { workspaceId: "elsewhere", sessionId: "x" });
		expect(changes() - before).toBe(1);
		await Bun.sleep(60);
		expect(changes() - before).toBe(2);
		await Bun.sleep(60);
		expect(changes() - before).toBe(2);
		t.emit("agent.tool", { workspaceId: "w1", sessionId: "s1" });
		stop();
		t.emit("agent.tool", { workspaceId: "w1", sessionId: "s1" });
		await Bun.sleep(60);
		expect(changes() - before).toBe(3);
	});

	test("republish a project's board when the project opens or closes, for the inbox", async () => {
		const { t, board } = setup();
		const stop = board.listen();
		t.emit("project.closed", { projectId: "p2" });
		t.emit("project.opened", { projectId: "p3" });
		expect(t.published).toEqual([
			{ type: "board.changed", payload: { projectId: "p2" }, scope: { projectId: "p2" } },
			{ type: "board.changed", payload: { projectId: "p3" }, scope: { projectId: "p3" } },
		]);
		stop();
	});

	test("log a failing rule and keep applying later events", async () => {
		const s = setup();
		const { t, board } = s;
		await started(s);
		const workspaceFacts = t.host.workspaceFacts;
		(t.host as { workspaceFacts: typeof workspaceFacts }).workspaceFacts = async () => {
			throw new Error("git is gone");
		};
		t.emit("agent.settled", { workspaceId: "w1", sessionId: "s1" });
		await board.idle();
		expect(t.warnings).toContain("a board rule failed");
		t.emit("workspace.removed", { projectId: "p1", id: "w1" });
		await board.idle();
		expect(board.find("TR-1").cancelPending).toMatchObject({ workspaceId: "w1" });
	});
});

describe("board tools", () => {
	interface Registered {
		name: string;
		execute: (
			id: string,
			params: unknown,
			signal: undefined,
			update: undefined,
			ctx: unknown,
		) => Promise<{ content: { text: string }[]; details: { card?: Card } }>;
	}

	function tools(board: Board) {
		const registered = new Map<string, Registered>();
		const pi = {
			registerTool: (tool: Registered) => registered.set(tool.name, tool),
		} as unknown as ExtensionAPI;
		createBoardTools(() => board)(pi);
		return {
			names: [...registered.keys()],
			call: (name: string, params: unknown, sessionId = "s-other", cwd = "/elsewhere") =>
				(registered.get(name) as Registered).execute("call", params, undefined, undefined, {
					cwd,
					sessionManager: { getSessionId: () => sessionId },
				}),
		};
	}

	test("read the chat's own card through its attempt, create only into Triage, link and note", async () => {
		const { t, board, query } = setup();
		t.places.set("/worktrees/w1", { projectId: "p1", workspaceId: "w1" });
		t.places.set("/repo", { projectId: "p1", workspaceId: "w-default" });
		await query("card.create", { projectId: "p1", title: "Own", acceptance: ["done right"] });
		await query("card.create", { projectId: "p1", title: "Later" });
		await query("card.start", { cardId: "TR-1" });
		const { names, call } = tools(board);
		expect(names).toEqual([
			"board_card_get",
			"board_cards_list",
			"board_card_create",
			"board_link",
			"board_card_note",
		]);

		const own = await call("board_card_get", {}, "s1");
		expect(own.content[0]?.text).toContain("TR-1 · Own");
		expect(own.content[0]?.text).toContain("- done right");
		expect((await call("board_card_get", {}, "other", "/worktrees/w1")).details.card?.id).toBe(
			"TR-1",
		);
		expect((await call("board_card_get", { cardId: "tr-2" })).details.card?.id).toBe("TR-2");
		expect((await call("board_card_get", {})).content[0]?.text).toContain("works on no board card");

		const created = await call(
			"board_card_create",
			{ title: "Follow-up", size: "L", type: "chore", acceptance: ["x"] },
			"s1",
			"/worktrees/w1",
		);
		expect(created.details.card).toMatchObject({
			id: "TR-3",
			category: "triage",
			column: "triage",
			createdBy: "agent",
			size: "L",
			sizeSuggested: true,
			origin: { sessionId: "s1", cardId: "TR-1" },
		});
		expect(board.find("TR-3").origin).toEqual({ sessionId: "s1", cardId: "TR-1" });
		await expect(call("board_card_create", { title: "x" }, "s1", "/elsewhere")).rejects.toThrow(
			"has no board",
		);
		expect(
			(await call("board_cards_list", { status: "triage" }, "s1", "/repo")).content[0]?.text,
		).toBe("TR-3 [triage] Follow-up (L)");
		expect(
			(await call("board_link", { cardId: "TR-1", blocks: ["TR-2", "tr-3"] })).details.card?.blocks,
		).toEqual(["TR-2", "TR-3"]);
		await call("board_card_note", { text: "Half way there" }, "s1", "/worktrees/w1");
		expect(board.find("TR-1").attempts[0]?.notes).toEqual([
			{ text: "Half way there", at: expect.any(Number) },
		]);
		await expect(call("board_card_note", { text: "lost" }, "nobody", "/repo")).rejects.toThrow(
			"works on no board card",
		);
	});

	test("answer that the board is not running before its host service or queries built it", async () => {
		const registered = new Map<string, Registered>();
		createBoardTools(() => undefined)({
			registerTool: (tool: Registered) => registered.set(tool.name, tool),
		} as unknown as ExtensionAPI);
		await expect(
			registered.get("board_cards_list")?.execute("c", {}, undefined, undefined, { cwd: "/" }),
		).rejects.toThrow("not running");
	});
});

describe("the board descriptor", () => {
	test("composes queries, a host service and per-session tools on one board per data folder", async () => {
		const t = createTestHost();
		hosts.push(t);
		expect(extension).toMatchObject({
			name: "board",
			title: "Board",
			apiVersion: 1,
			extensions: [],
		});
		const queries = extension.queries?.(t.host) ?? {};
		expect(Object.keys(queries).sort()).toEqual([
			"board.get",
			"card.adopt",
			"card.create",
			"card.deferrals",
			"card.delete",
			"card.get",
			"card.move",
			"card.start",
			"card.update",
			"github.refresh",
			"github.set",
			"inbox",
			"models.list",
			"settings.get",
			"settings.update",
			"triage.accept",
		]);
		const service = extension.hostService?.(t.host);
		expect(t.listeners()).toBe(7);
		await (queries["card.create"] as ExtensionQuery)({ projectId: "p1", title: "Shared" });
		const registered: string[] = [];
		const pi = { registerTool: (tool: { name: string }) => registered.push(tool.name) };
		for (const factory of extension.sessionExtensions?.() ?? [])
			await factory(pi as unknown as ExtensionAPI);
		expect(registered).toHaveLength(5);
		await service?.stop?.();
		expect(t.listeners()).toBe(0);
	});

	test("a run after a switch-off builds a fresh board on its own services", async () => {
		const t = createTestHost();
		hosts.push(t);
		const first = new AbortController();
		const service = extension.hostService?.({ ...t.host, signal: first.signal });
		expect(t.listeners()).toBe(7);
		await service?.stop?.();
		first.abort();
		const subscribed: string[] = [];
		extension.hostService?.({
			...t.host,
			signal: new AbortController().signal,
			events: {
				subscribe: (type) => {
					subscribed.push(type);
					return () => {};
				},
			},
		});
		expect(t.listeners()).toBe(0);
		expect(subscribed.sort()).toEqual([
			"agent.settled",
			"agent.tool",
			"project.closed",
			"project.opened",
			"session.state",
			"workspace.removed",
			"workspace.updated",
		]);
	});
});
