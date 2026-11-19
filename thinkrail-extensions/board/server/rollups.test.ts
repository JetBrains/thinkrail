import { describe, expect, test } from "bun:test";
import type { Category, Initiative, Placement, RoadmapProject, Transition } from "./model";
import {
	agentStateOf,
	blockedCards,
	initiativeCards,
	type RollupCard,
	rollup,
	subtree,
	timeSpent,
} from "./rollups";

const at = (category: Category): Placement => ({ category, column: category });

function move(
	cardId: string,
	from: Category | null,
	to: Category | null,
	when: number,
): Transition {
	return {
		cardId,
		from: from ? at(from) : null,
		to: to ? at(to) : null,
		at: when,
		actor: "automation",
		reason: "test",
	};
}

function initiative(id: string, overrides: Partial<Initiative> = {}): Initiative {
	return {
		id,
		title: id,
		outcome: "",
		criteria: [],
		horizon: "now",
		rank: 0,
		specRefs: [],
		updates: [],
		cardIds: [],
		externalCards: [],
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function project(id: string, initiativeId?: string): RoadmapProject {
	return {
		id,
		...(initiativeId ? { initiativeId } : {}),
		title: id,
		milestones: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("rollups", () => {
	const card = (id: string, overrides: Partial<RollupCard> = {}): RollupCard => ({
		id,
		category: "backlog",
		blocked: false,
		timeSpentMs: 0,
		...overrides,
	});

	test("count cards by category, size points, active agents, blocked cards and time spent", () => {
		const counted = rollup([
			card("A", { category: "completed", size: "L", agent: "working", timeSpentMs: 5 }),
			card("B", { category: "started", size: "S", agent: "working", timeSpentMs: 7 }),
			card("C", { category: "review", agent: "waiting" }),
			card("D", { category: "unstarted", size: "M", agent: "failed", blocked: true }),
			card("E", {
				category: "canceled",
				size: "L",
				agent: "failed",
				blocked: true,
				timeSpentMs: 3,
			}),
			card("F", { blocked: true }),
		]);
		expect(counted).toEqual({
			cards: 6,
			byCategory: {
				triage: 0,
				backlog: 1,
				unstarted: 1,
				started: 1,
				review: 1,
				completed: 1,
				canceled: 1,
			},
			points: { total: 4 + 1 + 2 + 2 + 2, completed: 4 },
			agents: { working: 1, waiting: 1, failed: 1 },
			blocked: 2,
			timeSpentMs: 15,
		});
	});

	test("an empty rollup is all zeros", () => {
		expect(rollup([])).toMatchObject({
			cards: 0,
			points: { total: 0, completed: 0 },
			agents: { working: 0, waiting: 0, failed: 0 },
			blocked: 0,
			timeSpentMs: 0,
		});
	});

	test("read a chat state as an agent state, an interrupted run as failed", () => {
		expect(agentStateOf("working")).toBe("working");
		expect(agentStateOf("needs_you")).toBe("waiting");
		expect(agentStateOf("failed")).toBe("failed");
		expect(agentStateOf("interrupted")).toBe("failed");
		expect(agentStateOf("finished")).toBeUndefined();
		expect(agentStateOf("idle")).toBeUndefined();
		expect(agentStateOf(undefined)).toBeUndefined();
	});

	test("a card is blocked by an active blocker only, and a finished card never is", () => {
		const blocked = blockedCards([
			{ id: "A", category: "started", blocks: ["B", "F"] },
			{ id: "B", category: "backlog", blocks: [] },
			{ id: "C", category: "completed", blocks: ["D"] },
			{ id: "D", category: "backlog", blocks: [] },
			{ id: "E", category: "canceled", blocks: ["G"] },
			{ id: "F", category: "completed", blocks: [] },
			{ id: "G", category: "unstarted", blocks: [] },
		]);
		expect([...blocked]).toEqual(["B"]);
	});

	test("time spent sums every span in started, an open one until now", () => {
		const spent = timeSpent(
			[
				move("A", null, "backlog", 0),
				move("A", "backlog", "started", 10),
				move("A", "started", "started", 15),
				move("A", "started", "review", 30),
				move("A", "review", "started", 40),
				move("A", "started", "completed", 45),
				move("B", "unstarted", "started", 100),
				move("C", "backlog", "started", 50),
				move("C", "started", "backlog", 70),
				move("C", "backlog", "canceled", 80),
				move("D", "backlog", "unstarted", 5),
			],
			130,
		);
		expect(Object.fromEntries(spent)).toEqual({ A: 25, B: 30, C: 20 });
	});

	test("time spent reads the log in time order", () => {
		const spent = timeSpent(
			[move("A", "started", "review", 30), move("A", "backlog", "started", 10)],
			99,
		);
		expect(spent.get("A")).toBe(20);
	});
});

describe("initiative membership", () => {
	const initiatives = [
		initiative("I-1", { cardIds: ["TR-1"], externalCards: [{ projectId: "p2", cardId: "OT-1" }] }),
		initiative("I-2", {
			parentId: "I-1",
			cardIds: ["TR-2"],
			externalCards: [
				{ projectId: "p2", cardId: "OT-1" },
				{ projectId: "p2", cardId: "OT-2" },
			],
		}),
		initiative("I-3", { parentId: "I-2" }),
		initiative("I-4"),
	];
	const projects = [project("P-1", "I-1"), project("P-2", "I-3"), project("P-3")];
	const cards = [
		{ id: "TR-1" },
		{ id: "TR-2" },
		{ id: "TR-3", projectId: "P-1" },
		{ id: "TR-4", projectId: "P-2" },
		{ id: "TR-5", projectId: "P-3" },
		{ id: "TR-6" },
	];

	test("a subtree is the initiative and everything nested in it", () => {
		expect([...subtree(initiatives, "I-1")]).toEqual(["I-1", "I-2", "I-3"]);
		expect([...subtree(initiatives, "I-2")]).toEqual(["I-2", "I-3"]);
		expect([...subtree(initiatives, "I-4")]).toEqual(["I-4"]);
	});

	test("an initiative holds its cards, its projects' cards and its nested initiatives', external ones once", () => {
		expect(initiativeCards("I-1", initiatives, projects, cards)).toEqual({
			local: ["TR-1", "TR-2", "TR-3", "TR-4"],
			external: [
				{ projectId: "p2", cardId: "OT-1" },
				{ projectId: "p2", cardId: "OT-2" },
			],
		});
		expect(initiativeCards("I-3", initiatives, projects, cards)).toEqual({
			local: ["TR-4"],
			external: [],
		});
		expect(initiativeCards("I-4", initiatives, projects, cards)).toEqual({
			local: [],
			external: [],
		});
	});
});
