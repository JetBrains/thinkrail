import type { AutopilotPause, CardSize, CardType, Category } from "./model";

/** How long a card offered to the orchestrator may stay unstarted before it is offered again, once. */
export const OFFER_RETRY_MS = 10 * 60_000;
/** How long board changes gather before autopilot looks again. */
export const AUTOPILOT_DEBOUNCE_MS = 2_000;

/** A card of the initiative as the selection reads it. */
export interface PilotCard {
	id: string;
	title: string;
	category: Category;
	size?: CardSize;
	type?: CardType;
	rank: number;
	/** An attempt whose workspace is open, or a start in flight. */
	active: boolean;
	/** The cards that block it, with their categories. */
	blockers: readonly { id: string; category: Category }[];
}

export interface PilotCount {
	count: number;
	/** 0 is no limit. */
	limit: number;
}

/** The board's WIP figures (`wipOf`): human attention and running agents against the settings' limits. */
export interface PilotWip {
	needsYou: PilotCount;
	review: PilotCount;
	agents: PilotCount;
}

/** Why a card is not ready; `null` when it is. */
export type Unready =
	| { kind: "category"; category: Category }
	| { kind: "blocked"; by: readonly { id: string; category: Category }[] }
	| { kind: "active" }
	| { kind: "unsized" };

const done = (category: Category) => category === "completed" || category === "canceled";

/**
 * Ready: unstarted, every blocker done (completed, or canceled as the board's blocked count reads it),
 * no active attempt and — unless `sized: false` — a size (a suggested one counts).
 */
export function unready(
	card: PilotCard,
	{ sized = true }: { sized?: boolean } = {},
): Unready | null {
	if (card.category !== "unstarted") return { kind: "category", category: card.category };
	const open = card.blockers.filter((blocker) => !done(blocker.category));
	if (open.length > 0) return { kind: "blocked", by: open };
	if (card.active) return { kind: "active" };
	if (sized && !card.size) return { kind: "unsized" };
	return null;
}

const byRank = (a: PilotCard, b: PilotCard) => a.rank - b.rank || a.id.localeCompare(b.id);

/** The initiative's ready cards, by rank. */
export function readyCards(cards: readonly PilotCard[]): PilotCard[] {
	return cards.filter((card) => unready(card) === null).sort(byRank);
}

const over = ({ count, limit }: PilotCount) => limit > 0 && count > limit;

/**
 * What holds autopilot back: Review past its limit first, then Needs you (a limit of 0 is none), then a
 * container without an orchestrator to wake; `null` when nothing does.
 */
export function pauseOf(wip: PilotWip, orchestrator: boolean): AutopilotPause | null {
	for (const [kind, key] of [
		["review", "review"],
		["needs_you", "needsYou"],
	] as const) {
		const figure = wip[key];
		if (over(figure)) return { kind, count: figure.count, limit: figure.limit };
	}
	return orchestrator ? null : { kind: "orchestrator" };
}

/** How many more agents the cap allows now; a cap of 0 is none. */
export function freeSlots(agents: PilotCount): number {
	return agents.limit > 0 ? Math.max(0, agents.limit - agents.count) : Number.POSITIVE_INFINITY;
}

export interface Selection {
	/** Every ready card, by rank, whatever the limits. */
	ready: PilotCard[];
	/** The ready cards the limits allow now, held-back ones aside: none while paused, at most the free agent slots. */
	selected: PilotCard[];
	pause: AutopilotPause | null;
	running: number;
	cap: number;
}

/**
 * The host decides *when*: which of the initiative's cards may start now. The `held` cards (flagged: the
 * orchestrator didn't start them) take no slot, so the next ready cards get it.
 */
export function select(
	cards: readonly PilotCard[],
	wip: PilotWip,
	{ orchestrator, held = new Set() }: { orchestrator: boolean; held?: ReadonlySet<string> },
): Selection {
	const ready = readyCards(cards);
	const pause = pauseOf(wip, orchestrator);
	const slots = pause ? 0 : freeSlots(wip.agents);
	const candidates = ready.filter((card) => !held.has(card.id));
	return {
		ready,
		selected: candidates.slice(0, Number.isFinite(slots) ? slots : candidates.length),
		pause,
		running: wip.agents.count,
		cap: wip.agents.limit,
	};
}

/** A card offered to the orchestrator: when it was last offered, and how often. */
export interface Offer {
	at: number;
	times: 1 | 2;
}

export interface OfferPlan {
	/** The cards to offer now: never offered, or offered once more than `retryMs` ago. */
	offer: string[];
	/** Offered twice and still not started after `retryMs`: the orchestrator didn't start them. */
	stale: string[];
	/** The offers to keep: a card that is no longer ready is forgotten. */
	offers: Map<string, Offer>;
	/** Every offer the orchestrator may act on now, by rank: offered, still selected and not flagged. */
	outstanding: string[];
	/** When an offer next falls due (a re-offer or a flag), after `now`; else `null`. */
	dueAt: number | null;
}

const flaggedAt = (offer: Offer, now: number, retryMs: number) =>
	offer.times === 2 && now >= offer.at + retryMs;

/** The offered cards the orchestrator didn't start: offered twice, the second time `retryMs` ago or more. */
export function flagged(
	offers: ReadonlyMap<string, Offer>,
	now: number,
	retryMs: number = OFFER_RETRY_MS,
): Set<string> {
	return new Set(
		[...offers].filter(([, offer]) => flaggedAt(offer, now, retryMs)).map(([id]) => id),
	);
}

/** No flood: each selected card is offered once, again once after `retryMs`, then flagged. */
export function planOffers(
	selected: readonly string[],
	ready: readonly string[],
	previous: ReadonlyMap<string, Offer>,
	now: number,
	retryMs: number = OFFER_RETRY_MS,
): OfferPlan {
	const stillReady = new Set(ready);
	const offers = new Map<string, Offer>();
	for (const [id, offer] of previous) if (stillReady.has(id)) offers.set(id, offer);
	const offer: string[] = [];
	for (const id of selected) {
		const last = offers.get(id);
		if (!last) {
			offers.set(id, { at: now, times: 1 });
			offer.push(id);
		} else if (last.times === 1 && now - last.at >= retryMs) {
			offers.set(id, { at: now, times: 2 });
			offer.push(id);
		}
	}
	const stale: string[] = [];
	let dueAt: number | null = null;
	for (const [id, last] of offers) {
		const due = last.at + retryMs;
		if (flaggedAt(last, now, retryMs)) stale.push(id);
		else if (due > now) dueAt = dueAt === null ? due : Math.min(dueAt, due);
	}
	const outstanding = selected.filter((id) => offers.has(id) && !stale.includes(id));
	return { offer, stale, offers, outstanding, dueAt };
}
