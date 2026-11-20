import { describe, expect, test } from "bun:test";
import type { Attempt, Card, Category } from "./model";
import { applyEvent, type BoardEvent, moveByHand } from "./rules";

const AT = 5_000;

function attempt(overrides: Partial<Attempt> = {}): Attempt {
	return {
		workspaceId: "w1",
		sessionId: "s1",
		workflow: "implement",
		startedAt: 1,
		notes: [],
		...overrides,
	};
}

function card(category: Category, column: string, attempts: Attempt[] = [attempt()]): Card {
	return {
		id: "TR-1",
		source: { kind: "native", ref: "TR-1" },
		title: "Card",
		description: "",
		acceptance: [],
		type: "feature",
		labels: [],
		blocks: [],
		specRefs: [],
		rank: 1,
		category,
		column,
		ownerHuman: "me",
		attempts,
		createdBy: "human",
		createdAt: 1,
		updatedAt: 1,
	};
}

const settled = (planDone: boolean, diffNonEmpty: boolean): BoardEvent => ({
	kind: "settled",
	workspaceId: "w1",
	planDone,
	diffNonEmpty,
});

const placement = (result: ReturnType<typeof applyEvent>) =>
	result ? `${result.card.category}/${result.card.column}` : null;

describe("applyEvent", () => {
	test("Start moves a card to started in its workflow's column, from anywhere", () => {
		for (const [category, column] of [
			["backlog", "backlog"],
			["unstarted", "ready"],
			["review", "review"],
			["completed", "done"],
		] as const) {
			const result = applyEvent(
				card(category, column),
				{ kind: "started", workspaceId: "w1", workflow: "brainstorm" },
				"agentic-kanban",
				AT,
			);
			expect(placement(result)).toBe("started/designing");
			expect(result?.transition).toEqual({
				cardId: "TR-1",
				from: { category, column },
				to: { category: "started", column: "designing" },
				at: AT,
				actor: "automation",
				reason: "an attempt started",
			});
		}
		expect(
			placement(
				applyEvent(
					card("unstarted", "todo"),
					{ kind: "started", workspaceId: "w1", workflow: "implement" },
					"solo",
					AT,
				),
			),
		).toBe("started/doing");
	});

	test("a settle moves a started card to review only with its plan done or a diff", () => {
		const started = card("started", "building");
		expect(applyEvent(started, settled(false, false), "agentic-kanban", AT)).toBeNull();
		const planned = applyEvent(started, settled(true, false), "agentic-kanban", AT);
		expect(placement(planned)).toBe("review/review");
		expect(planned?.transition?.reason).toBe("the agent settled with its plan done");
		const changed = applyEvent(started, settled(false, true), "solo", AT);
		expect(placement(changed)).toBe("review/doing");
		expect(changed?.transition?.reason).toBe("the agent settled with changes");
		for (const category of ["backlog", "review", "completed", "canceled"] as const)
			expect(applyEvent(card(category, "x"), settled(true, true), "agentic-kanban", AT)).toBeNull();
		expect(
			applyEvent(
				card("started", "building", [attempt({ removedAt: 2 })]),
				settled(true, true),
				"agentic-kanban",
				AT,
			),
		).toBeNull();
	});

	test("a merged PR completes the card and marks its attempt, once", () => {
		const merged = applyEvent(
			card("review", "review"),
			{ kind: "merged", workspaceId: "w1" },
			"agentic-kanban",
			AT,
		);
		expect(placement(merged)).toBe("completed/done");
		expect(merged?.transition).toMatchObject({ actor: "git", reason: "its PR was merged" });
		expect(merged?.card.attempts[0]?.merged).toBe(true);
		expect(
			applyEvent(merged?.card as Card, { kind: "merged", workspaceId: "w1" }, "agentic-kanban", AT),
		).toBeNull();
		const manuallyDone = applyEvent(
			card("completed", "done"),
			{ kind: "merged", workspaceId: "w1" },
			"agentic-kanban",
			AT,
		);
		expect(manuallyDone?.transition).toBeUndefined();
		expect(manuallyDone?.card.attempts[0]?.merged).toBe(true);
	});

	test("a move by hand after a merge survives a repeated merged event", () => {
		const merged = applyEvent(
			card("review", "review"),
			{ kind: "merged", workspaceId: "w1" },
			"agentic-kanban",
			AT,
		);
		const reopened = moveByHand(merged?.card as Card, "review", "agentic-kanban", AT + 1);
		expect(placement(reopened)).toBe("review/review");
		expect(
			applyEvent(
				reopened?.card as Card,
				{ kind: "merged", workspaceId: "w1" },
				"agentic-kanban",
				AT + 2,
			),
		).toBeNull();
	});

	test("a workspace removed unmerged asks to cancel and never cancels", () => {
		const removed = applyEvent(
			card("started", "building"),
			{ kind: "removed", workspaceId: "w1" },
			"agentic-kanban",
			AT,
		);
		expect(placement(removed)).toBe("started/building");
		expect(removed?.transition).toBeUndefined();
		expect(removed?.card.cancelPending).toEqual({ workspaceId: "w1", at: AT });
		expect(removed?.card.attempts[0]?.removedAt).toBe(AT);
		expect(
			applyEvent(
				removed?.card as Card,
				{ kind: "removed", workspaceId: "w1" },
				"agentic-kanban",
				AT,
			),
		).toBeNull();

		for (const quiet of [
			card("completed", "done"),
			card("canceled", "canceled"),
			card("review", "review", [attempt({ merged: true })]),
			card("started", "building", [attempt(), attempt({ workspaceId: "w2" })]),
		]) {
			const result = applyEvent(
				quiet,
				{ kind: "removed", workspaceId: "w1" },
				"agentic-kanban",
				AT,
			);
			expect(result?.card.cancelPending).toBeUndefined();
			expect(result?.card.attempts[0]?.removedAt).toBe(AT);
		}
	});

	test("an event about a workspace no attempt of the card holds changes nothing", () => {
		for (const event of [
			{ kind: "started", workspaceId: "w9", workflow: "implement" },
			{ kind: "settled", workspaceId: "w9", planDone: true, diffNonEmpty: true },
			{ kind: "merged", workspaceId: "w9" },
			{ kind: "removed", workspaceId: "w9" },
		] as BoardEvent[])
			expect(applyEvent(card("started", "building"), event, "agentic-kanban", AT)).toBeNull();
	});

	test("re-applying the outcome of any event is a no-op", () => {
		const events: BoardEvent[] = [
			{ kind: "started", workspaceId: "w1", workflow: "implement" },
			settled(true, true),
			{ kind: "merged", workspaceId: "w1" },
			{ kind: "removed", workspaceId: "w1" },
		];
		for (const event of events) {
			const first = applyEvent(card("started", "building"), event, "agentic-kanban", AT);
			const base = first?.card ?? card("started", "building");
			expect(applyEvent(base, event, "agentic-kanban", AT + 1)).toBeNull();
		}
	});
});

describe("moveByHand", () => {
	test("is a logged human override that clears the cancel question", () => {
		const asked = { ...card("started", "building"), cancelPending: { workspaceId: "w1", at: 2 } };
		const moved = moveByHand(asked, "canceled", "agentic-kanban", AT);
		expect(placement(moved)).toBe("canceled/canceled");
		expect(moved?.transition).toMatchObject({ actor: "human", reason: "moved by hand" });
		expect(moved?.card.cancelPending).toBeUndefined();
	});

	test("within the same column only reorders, with no transition", () => {
		const moved = moveByHand(card("review", "review"), "review", "agentic-kanban", AT, 0.5);
		expect(moved?.card.rank).toBe(0.5);
		expect(moved?.transition).toBeUndefined();
		expect(moveByHand(card("review", "review"), "nowhere", "agentic-kanban", AT)).toBeNull();
	});
});
