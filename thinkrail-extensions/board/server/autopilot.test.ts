import { describe, expect, test } from "bun:test";
import {
	freeSlots,
	OFFER_RETRY_MS,
	type Offer,
	type PilotCard,
	type PilotWip,
	pauseOf,
	planOffers,
	readyCards,
	select,
	unready,
} from "./autopilot";
import { type AutopilotPause, CATEGORIES, type Category } from "./model";

const card = (
	id: string,
	{
		size = "S",
		...patch
	}: Partial<Omit<PilotCard, "size">> & { size?: PilotCard["size"] | null } = {},
): PilotCard => ({
	id,
	title: id,
	category: "unstarted",
	...(size ? { size } : {}),
	rank: 1,
	active: false,
	blockers: [],
	...patch,
});

const wip = (patch: Partial<Record<keyof PilotWip, [number, number]>> = {}): PilotWip => {
	const figure = ([count, limit]: [number, number]) => ({ count, limit });
	return {
		needsYou: figure(patch.needsYou ?? [0, 3]),
		review: figure(patch.review ?? [0, 5]),
		agents: figure(patch.agents ?? [0, 3]),
	};
};

describe("autopilot selection", () => {
	test("only an unstarted card is ready, whatever else holds", () => {
		for (const category of CATEGORIES)
			expect(unready(card("TR-1", { category }))).toEqual(
				category === "unstarted" ? null : { kind: "category", category },
			);
	});

	test("a blocker that is neither completed nor canceled blocks; the rest do not", () => {
		const table: [Category, boolean][] = CATEGORIES.map((category) => [
			category,
			category !== "completed" && category !== "canceled",
		]);
		for (const [category, blocks] of table) {
			const blocked = card("TR-2", { blockers: [{ id: "TR-1", category }] });
			expect(unready(blocked)).toEqual(
				blocks ? { kind: "blocked", by: [{ id: "TR-1", category }] } : null,
			);
		}
		expect(
			unready(
				card("TR-3", {
					blockers: [
						{ id: "TR-1", category: "completed" },
						{ id: "TR-2", category: "review" },
					],
				}),
			),
		).toEqual({ kind: "blocked", by: [{ id: "TR-2", category: "review" }] });
	});

	test("an active attempt, then a missing size, keep a card back; the size check can be waived", () => {
		expect(unready(card("TR-1", { active: true }))).toEqual({ kind: "active" });
		expect(unready(card("TR-1", { size: null }))).toEqual({ kind: "unsized" });
		expect(unready(card("TR-1", { size: null }), { sized: false })).toBeNull();
		expect(unready(card("TR-1", { active: true, size: null }))).toEqual({ kind: "active" });
		expect(unready(card("TR-1", { category: "backlog", active: true, size: null }))).toMatchObject({
			kind: "category",
		});
	});

	test("ready cards come by rank, then id", () => {
		const cards = [
			card("TR-3", { rank: 2 }),
			card("TR-1", { rank: 2 }),
			card("TR-2", { rank: 1 }),
			card("TR-4", { rank: 0, category: "backlog" }),
		];
		expect(readyCards(cards).map((entry) => entry.id)).toEqual(["TR-2", "TR-1", "TR-3"]);
	});

	test("a human-attention limit past pauses (Review first), at the limit or with no limit does not", () => {
		const table: [Partial<Record<keyof PilotWip, [number, number]>>, AutopilotPause | null][] = [
			[{}, null],
			[{ review: [5, 5] }, null],
			[{ review: [6, 5] }, { kind: "review", count: 6, limit: 5 }],
			[{ review: [9, 0] }, null],
			[{ needsYou: [3, 3] }, null],
			[{ needsYou: [4, 3] }, { kind: "needs_you", count: 4, limit: 3 }],
			[{ needsYou: [4, 0] }, null],
			[
				{ review: [6, 5], needsYou: [4, 3] },
				{ kind: "review", count: 6, limit: 5 },
			],
			[{ agents: [9, 3] }, null],
		];
		for (const [figures, pause] of table) expect(pauseOf(wip(figures), true)).toEqual(pause);
		expect(pauseOf(wip(), false)).toEqual({ kind: "orchestrator" });
		expect(pauseOf(wip({ review: [6, 5] }), false)).toEqual({
			kind: "review",
			count: 6,
			limit: 5,
		});
	});

	test("the agents cap leaves the free slots; a cap of 0 is none", () => {
		expect(freeSlots({ count: 1, limit: 3 })).toBe(2);
		expect(freeSlots({ count: 3, limit: 3 })).toBe(0);
		expect(freeSlots({ count: 5, limit: 3 })).toBe(0);
		expect(freeSlots({ count: 7, limit: 0 })).toBe(Number.POSITIVE_INFINITY);
	});

	test("select takes the ready cards the limits allow, none while paused", () => {
		const cards = [card("TR-1", { rank: 1 }), card("TR-2", { rank: 2 }), card("TR-3", { rank: 3 })];
		const ids = (selection: ReturnType<typeof select>) => ({
			ready: selection.ready.map((entry) => entry.id),
			selected: selection.selected.map((entry) => entry.id),
			pause: selection.pause,
			running: selection.running,
			cap: selection.cap,
		});
		expect(ids(select(cards, wip({ agents: [1, 3] }), { orchestrator: true }))).toEqual({
			ready: ["TR-1", "TR-2", "TR-3"],
			selected: ["TR-1", "TR-2"],
			pause: null,
			running: 1,
			cap: 3,
		});
		expect(ids(select(cards, wip({ agents: [3, 3] }), { orchestrator: true })).selected).toEqual(
			[],
		);
		expect(ids(select(cards, wip({ agents: [8, 0] }), { orchestrator: true })).selected).toEqual([
			"TR-1",
			"TR-2",
			"TR-3",
		]);
		const paused = ids(select(cards, wip({ review: [6, 5] }), { orchestrator: true }));
		expect(paused.selected).toEqual([]);
		expect(paused.ready).toHaveLength(3);
		expect(paused.pause).toEqual({ kind: "review", count: 6, limit: 5 });
		expect(ids(select(cards, wip(), { orchestrator: false })).selected).toEqual([]);
	});
});

describe("autopilot offers", () => {
	const at = 1_000_000;
	const offers = (entries: [string, Offer][]) => new Map(entries);

	test("a selected card is offered once, again once after the retry, then flagged", () => {
		const first = planOffers(["TR-1"], ["TR-1"], new Map(), at);
		expect(first).toEqual({
			offer: ["TR-1"],
			stale: [],
			offers: offers([["TR-1", { at, times: 1 }]]),
			dueAt: at + OFFER_RETRY_MS,
		});
		const waiting = planOffers(["TR-1"], ["TR-1"], first.offers, at + OFFER_RETRY_MS - 1);
		expect(waiting.offer).toEqual([]);
		expect(waiting.stale).toEqual([]);
		const again = planOffers(["TR-1"], ["TR-1"], first.offers, at + OFFER_RETRY_MS);
		expect(again.offer).toEqual(["TR-1"]);
		expect(again.offers.get("TR-1")).toEqual({ at: at + OFFER_RETRY_MS, times: 2 });
		const flagged = planOffers(["TR-1"], ["TR-1"], again.offers, at + 2 * OFFER_RETRY_MS);
		expect(flagged).toEqual({
			offer: [],
			stale: ["TR-1"],
			offers: again.offers,
			dueAt: null,
		});
		expect(planOffers(["TR-1"], ["TR-1"], flagged.offers, at + 9 * OFFER_RETRY_MS).offer).toEqual(
			[],
		);
	});

	test("a card no longer ready is forgotten, one held back by the limits keeps its offer", () => {
		const previous = offers([
			["TR-1", { at, times: 1 }],
			["TR-2", { at, times: 2 }],
		]);
		const plan = planOffers([], ["TR-2"], previous, at + 1);
		expect([...plan.offers.keys()]).toEqual(["TR-2"]);
		expect(plan.offer).toEqual([]);
		expect(plan.dueAt).toBe(at + OFFER_RETRY_MS);
		const back = planOffers(["TR-1"], ["TR-1"], plan.offers, at + 2);
		expect(back.offer).toEqual(["TR-1"]);
		expect(back.offers.get("TR-1")).toEqual({ at: at + 2, times: 1 });
	});

	test("an offer past due while held back sets no due time in the past", () => {
		const previous = offers([["TR-1", { at, times: 1 }]]);
		const plan = planOffers([], ["TR-1"], previous, at + 2 * OFFER_RETRY_MS);
		expect(plan).toEqual({ offer: [], stale: [], offers: previous, dueAt: null });
	});

	test("new cards are offered beside ones still waiting, and the retry is a parameter", () => {
		const previous = offers([["TR-1", { at, times: 1 }]]);
		const early = planOffers(["TR-1", "TR-2"], ["TR-1", "TR-2"], previous, at + 5, 10);
		expect(early.offer).toEqual(["TR-2"]);
		expect(early.dueAt).toBe(at + 10);
		const plan = planOffers(["TR-1", "TR-2"], ["TR-1", "TR-2"], previous, at + 10, 10);
		expect(plan.offer).toEqual(["TR-1", "TR-2"]);
		expect(plan.offers.get("TR-1")).toEqual({ at: at + 10, times: 2 });
		expect(plan.offers.get("TR-2")).toEqual({ at: at + 10, times: 1 });
		expect(plan.dueAt).toBe(at + 20);
	});
});
