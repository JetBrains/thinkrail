import { describe, expect, test } from "bun:test";
import type { Category } from "./model";
import {
	criticalWithin,
	dependentsOf,
	isPinnable,
	type ScheduleCard,
	type ScheduleNode,
	schedule,
	wouldCycle,
} from "./schedule";

const TODAY = 100;

function card(id: string, overrides: Partial<ScheduleCard> = {}): ScheduleCard {
	return { id, category: "backlog", blocks: [], estimateDays: 1, ...overrides };
}

function plan(
	cards: ScheduleCard[],
	milestones: { id: string; lane: string; target?: number }[] = [],
) {
	const result = schedule({ cards, milestones, today: TODAY });
	const node = (id: string) => result.nodes.find((entry) => entry.id === id) as ScheduleNode;
	return { result, node };
}

const span = (node: ScheduleNode) => [node.start, node.end];

describe("the step graph's schedule", () => {
	test("a chain starts today and runs end to end, every card critical", () => {
		const { result, node } = plan([
			card("A", { estimateDays: 2, blocks: ["B"] }),
			card("B", { estimateDays: 3, blocks: ["C"] }),
			card("C"),
		]);
		expect([span(node("A")), span(node("B")), span(node("C"))]).toEqual([
			[100, 102],
			[102, 105],
			[105, 106],
		]);
		expect(result.finish).toBe(106);
		expect(result.criticalPath).toEqual(["A", "B", "C"]);
		expect(result.nodes.map((entry) => entry.slack)).toEqual([0, 0, 0]);
		expect(result.edges).toEqual([
			{ from: "A", to: "B", critical: true, conflict: false },
			{ from: "B", to: "C", critical: true, conflict: false },
		]);
	});

	test("a shorter branch has slack; the longer one is the critical path", () => {
		const { result, node } = plan([
			card("A", { estimateDays: 2, blocks: ["C"] }),
			card("B", { estimateDays: 5, blocks: ["C"] }),
			card("C"),
		]);
		expect(span(node("C"))).toEqual([105, 106]);
		expect(node("A")).toMatchObject({ slack: 3, critical: false });
		expect(node("B")).toMatchObject({ slack: 0, critical: true });
		expect(result.criticalPath).toEqual(["B", "C"]);
		expect(result.edges.find((edge) => edge.from === "A")?.critical).toBe(false);
	});

	test("lists every node after its blockers", () => {
		const { result } = plan([
			card("C"),
			card("B", { blocks: ["C"] }),
			card("A", { blocks: ["B"] }),
		]);
		expect(result.nodes.map((entry) => entry.id)).toEqual(["A", "B", "C"]);
	});

	test("a pinned start holds; one earlier than its blockers' end is a conflict on the node and the link", () => {
		const late = plan([
			card("A", { estimateDays: 2, blocks: ["B"] }),
			card("B", { pinnedStart: 110 }),
		]);
		expect(late.node("B")).toMatchObject({ start: 110, end: 111, pinned: true, conflict: false });
		expect(late.node("A")).toMatchObject({ slack: 8, critical: false });
		const early = plan([
			card("A", { estimateDays: 4, blocks: ["B"] }),
			card("B", { pinnedStart: 101 }),
		]);
		expect(early.node("B")).toMatchObject({ start: 101, end: 102, conflict: true });
		expect(early.result.edges).toEqual([{ from: "A", to: "B", critical: false, conflict: true }]);
		expect(plan([card("P", { pinnedStart: 95 })]).node("P")).toMatchObject({
			start: 95,
			conflict: false,
		});
	});

	test("a started card runs from its actual start, not before today's end, ignoring a pin", () => {
		const { node } = plan([
			card("W", { category: "started", startedAt: 98.5, estimateDays: 3, pinnedStart: 120 }),
			card("Late", { category: "review", startedAt: 90, estimateDays: 3 }),
			card("Fresh", { category: "started" }),
		]);
		expect(span(node("W"))).toEqual([98.5, 101.5]);
		expect(node("W").pinned).toBe(false);
		expect(span(node("Late"))).toEqual([90, 100]);
		expect(span(node("Fresh"))).toEqual([100, 101]);
	});

	test("a done card keeps its actual span, has no slack and is never critical; its dependents start today", () => {
		const { node } = plan([
			card("D", {
				category: "completed",
				firstStartedAt: 90,
				startedAt: 93,
				completedAt: 95,
				blocks: ["N"],
			}),
			card("N", { estimateDays: 2 }),
			card("Quick", { category: "completed", completedAt: 96, estimateDays: 2 }),
		]);
		expect(node("D")).toMatchObject({ start: 90, end: 95, done: true, slack: 0, critical: false });
		expect(span(node("N"))).toEqual([100, 102]);
		expect(span(node("Quick"))).toEqual([94, 96]);
	});

	test("a milestone is a zero-length node after its cards, late past its target day", () => {
		const { result, node } = plan(
			[
				card("A", { estimateDays: 2, lane: "P-1", milestoneId: "M-1" }),
				card("B", { estimateDays: 4, lane: "P-1", milestoneId: "M-1" }),
				card("Other", { estimateDays: 9 }),
			],
			[
				{ id: "M-1", lane: "P-1", target: 102 },
				{ id: "M-2", lane: "P-1", target: 120 },
				{ id: "M-3", lane: "P-2" },
			],
		);
		expect(node("M-1")).toMatchObject({
			kind: "milestone",
			lane: "P-1",
			start: 104,
			end: 104,
			late: true,
		});
		expect(node("M-2")).toMatchObject({ start: 120, end: 120 });
		expect(node("M-2")).not.toHaveProperty("late");
		expect(node("M-3")).toMatchObject({ start: 100, end: 100 });
		expect(node("A").lane).toBe("P-1");
		expect(result.finish).toBe(120);
		expect(result.edges.filter((edge) => edge.to === "M-1").map((edge) => edge.from)).toEqual([
			"A",
			"B",
		]);
	});

	test("a milestone whose cards are all done is done", () => {
		const { node } = plan(
			[card("A", { category: "completed", completedAt: 99, milestoneId: "M-1" })],
			[{ id: "M-1", lane: "P-1" }],
		);
		expect(node("M-1")).toMatchObject({ done: true, critical: false, end: 99 });
	});

	test("a cycle of links is cut at one link and reported, and every card still scheduled", () => {
		const { result } = plan([
			card("A", { blocks: ["B"] }),
			card("B", { blocks: ["A"] }),
			card("C", { blocks: ["C"] }),
		]);
		expect(result.cycles).toEqual([{ from: "A", to: "B" }]);
		expect(result.nodes.map((entry) => entry.id).sort()).toEqual(["A", "B", "C"]);
		expect(result.edges).toEqual([{ from: "B", to: "A", critical: true, conflict: false }]);
	});

	test("leaves canceled cards and links to unknown cards out", () => {
		const { result, node } = plan([
			card("X", { category: "canceled", estimateDays: 9, blocks: ["Y"] }),
			card("Y", { blocks: ["gone"] }),
		]);
		expect(result.nodes.map((entry) => entry.id)).toEqual(["Y"]);
		expect(span(node("Y"))).toEqual([100, 101]);
		expect(result.edges).toEqual([]);
	});

	test("an empty board finishes today", () => {
		expect(schedule({ cards: [], milestones: [], today: TODAY })).toEqual({
			today: TODAY,
			finish: TODAY,
			nodes: [],
			edges: [],
			criticalPath: [],
			cycles: [],
		});
	});

	test("an initiative's critical path is its own cards' longest chain, not the board's", () => {
		const { result } = plan([
			card("X", { estimateDays: 20 }),
			card("A", { estimateDays: 2, blocks: ["B"] }),
			card("B", { estimateDays: 1 }),
			card("C", { estimateDays: 1 }),
		]);
		expect(result.criticalPath).toEqual(["X"]);
		expect([...criticalWithin(result, new Set(["A", "B", "C"]))].sort()).toEqual(["A", "B"]);
		expect(criticalWithin(result, new Set())).toEqual(new Set());
	});
});

describe("links and pins", () => {
	const blocks = new Map<string, string[]>([
		["A", ["B"]],
		["B", ["C", "D"]],
		["D", ["E"]],
	]);
	const blocksOf = (id: string) => blocks.get(id);

	test("a link closing a cycle, or to the card itself, is caught", () => {
		expect(wouldCycle(blocksOf, "E", "A")).toBe(true);
		expect(wouldCycle(blocksOf, "C", "B")).toBe(true);
		expect(wouldCycle(blocksOf, "A", "A")).toBe(true);
		expect(wouldCycle(blocksOf, "A", "E")).toBe(false);
		expect(wouldCycle(blocksOf, "C", "E")).toBe(false);
	});

	test("dependents are every card blocked transitively", () => {
		expect([...dependentsOf(blocksOf, "A")].sort()).toEqual(["B", "C", "D", "E"]);
		expect(dependentsOf(blocksOf, "E")).toEqual(new Set());
	});

	test("only a card that has not started can be pinned", () => {
		const open: Category[] = ["triage", "backlog", "unstarted"];
		const begun: Category[] = ["started", "review", "completed", "canceled"];
		expect(open.every(isPinnable)).toBe(true);
		expect(begun.some(isPinnable)).toBe(false);
	});
});
