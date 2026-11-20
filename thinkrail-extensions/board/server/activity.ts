import type { Actor, AttemptNote, Card, Category, Transition } from "./model";

/** One logged move of a member card inside the window. */
export interface ActivityMove {
	cardId: string;
	from: Category | null;
	to: Category | null;
	at: number;
	actor: Actor;
	reason: string;
}

/** What happened to an initiative's cards between `since` and `until`, from the transition log. */
export interface Activity {
	since: number;
	until: number;
	/** Cards that reached each state inside the window (their last such move), by id. */
	completed: string[];
	started: string[];
	review: string[];
	filed: string[];
	canceled: string[];
	/** Every category change inside the window, oldest first. */
	moves: ActivityMove[];
	/** Progress notes the cards' attempts took inside the window, oldest first. */
	notes: (AttemptNote & { cardId: string })[];
	/** Active cards (neither completed nor canceled) with no move inside the window, and since when. */
	still: { cardId: string; category: Category; since: number | null }[];
}

const ACTIVE = (category: Category) => category !== "completed" && category !== "canceled";

/**
 * The window's activity of `cards`: their category changes (a move within a category is no activity),
 * which reached completed, started, review, Triage or Backlog (filed) and canceled, their attempts'
 * notes, and the active cards that did not move.
 */
export function initiativeActivity(
	cards: readonly Pick<Card, "id" | "category" | "attempts">[],
	transitions: readonly Transition[],
	since: number,
	until: number,
): Activity {
	const ids = new Set(cards.map((card) => card.id));
	const own = transitions
		.filter((transition) => ids.has(transition.cardId))
		.sort((a, b) => a.at - b.at);
	const moves: ActivityMove[] = [];
	const lastMove = new Map<string, number>();
	const reached: Record<"completed" | "started" | "review" | "filed" | "canceled", Set<string>> = {
		completed: new Set(),
		started: new Set(),
		review: new Set(),
		filed: new Set(),
		canceled: new Set(),
	};
	for (const transition of own) {
		const from = transition.from?.category ?? null;
		const to = transition.to?.category ?? null;
		if (from === to) continue;
		lastMove.set(transition.cardId, transition.at);
		if (transition.at < since || transition.at > until) continue;
		moves.push({
			cardId: transition.cardId,
			from,
			to,
			at: transition.at,
			actor: transition.actor,
			reason: transition.reason,
		});
		if (from === null && to !== null) reached.filed.add(transition.cardId);
		if (to === "completed" || to === "started" || to === "review" || to === "canceled")
			reached[to].add(transition.cardId);
	}
	const notes = cards
		.flatMap((card) =>
			card.attempts.flatMap((attempt) =>
				attempt.notes
					.filter((note) => note.at >= since && note.at <= until)
					.map((note) => ({ ...note, cardId: card.id })),
			),
		)
		.sort((a, b) => a.at - b.at || a.cardId.localeCompare(b.cardId));
	const moved = new Set(moves.map((move) => move.cardId));
	const still = cards
		.filter((card) => ACTIVE(card.category) && !moved.has(card.id))
		.map((card) => ({
			cardId: card.id,
			category: card.category,
			since: lastMove.get(card.id) ?? null,
		}));
	const sorted = (set: Set<string>) => [...set].sort();
	return {
		since,
		until,
		completed: sorted(reached.completed),
		started: sorted(reached.started),
		review: sorted(reached.review),
		filed: sorted(reached.filed),
		canceled: sorted(reached.canceled),
		moves,
		notes,
		still,
	};
}
