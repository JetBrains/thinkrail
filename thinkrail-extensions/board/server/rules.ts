import type { Actor, Card, Placement, Preset, Transition, Workflow } from "./model";
import { columnFor, placeInColumn } from "./presets";

/** What the host reported about a workspace bound to one of the card's attempts. */
export type BoardEvent =
	| { kind: "started"; workspaceId: string; workflow: Workflow }
	| { kind: "settled"; workspaceId: string; planDone: boolean; diffNonEmpty: boolean }
	| { kind: "merged"; workspaceId: string }
	| { kind: "removed"; workspaceId: string };

export interface RuleResult {
	card: Card;
	transition?: Transition;
}

function moved(
	card: Card,
	to: Placement,
	at: number,
	actor: Actor,
	reason: string,
	changes: Partial<Card> = {},
): RuleResult {
	const from: Placement = { category: card.category, column: card.column };
	const { cancelPending: _cleared, ...rest } = card;
	return {
		card: { ...rest, ...changes, category: to.category, column: to.column, updatedAt: at },
		transition: { cardId: card.id, from, to, at, actor, reason },
	};
}

const samePlace = (card: Card, to: Placement) =>
	card.category === to.category && card.column === to.column;

/**
 * How a host event moves a card: Start → started; a settle with the plan done or a non-empty diff →
 * review; a merged PR → completed, once per attempt; a workspace removed unmerged → ask to cancel.
 * `null` when nothing changes, so re-applying an event is a no-op.
 */
export function applyEvent(
	card: Card,
	event: BoardEvent,
	preset: Preset,
	at: number,
): RuleResult | null {
	const index = card.attempts.findIndex((attempt) => attempt.workspaceId === event.workspaceId);
	const attempt = card.attempts[index];
	if (!attempt) return null;
	switch (event.kind) {
		case "started": {
			const to = {
				category: "started",
				column: columnFor(preset, "started", event.workflow),
			} as const;
			if (samePlace(card, to) && !card.cancelPending) return null;
			return moved(card, to, at, "automation", "an attempt started");
		}
		case "settled": {
			if (attempt.removedAt !== undefined || card.category !== "started") return null;
			if (!event.planDone && !event.diffNonEmpty) return null;
			return moved(
				card,
				{ category: "review", column: columnFor(preset, "review") },
				at,
				"automation",
				event.planDone ? "the agent settled with its plan done" : "the agent settled with changes",
			);
		}
		case "merged": {
			if (attempt.merged) return null;
			const attempts = card.attempts.map((candidate, position) =>
				position === index ? { ...candidate, merged: true as const } : candidate,
			);
			if (card.category === "completed") return { card: { ...card, attempts, updatedAt: at } };
			return moved(
				card,
				{ category: "completed", column: columnFor(preset, "completed") },
				at,
				"git",
				"its PR was merged",
				{ attempts },
			);
		}
		case "removed": {
			if (attempt.removedAt !== undefined) return null;
			const attempts = card.attempts.map((candidate, position) =>
				position === index ? { ...candidate, removedAt: at } : candidate,
			);
			const openElsewhere = attempts.some((candidate) => candidate.removedAt === undefined);
			const settledCard =
				card.category === "completed" || card.category === "canceled" || attempt.merged;
			return {
				card: {
					...card,
					attempts,
					updatedAt: at,
					...(settledCard || openElsewhere
						? {}
						: { cancelPending: { workspaceId: event.workspaceId, at } }),
				},
			};
		}
	}
}

/** A human's move: an override that lands where the column says and is logged; `null` for an unknown column. */
export function moveByHand(
	card: Card,
	columnId: string,
	preset: Preset,
	at: number,
	rank?: number,
): RuleResult | null {
	const to = placeInColumn(preset, card, columnId);
	if (!to) return null;
	const ranked = rank === undefined ? {} : { rank };
	if (samePlace(card, to)) {
		const { cancelPending: _cleared, ...rest } = card;
		return { card: { ...rest, ...ranked, updatedAt: at } };
	}
	return moved(card, to, at, "human", "moved by hand", ranked);
}
