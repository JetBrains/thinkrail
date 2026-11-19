import type { ChatState } from "@thinkrail/extension-api/server";
import {
	CATEGORIES,
	type Card,
	type CardRef,
	type CardSize,
	type Category,
	type Initiative,
	pointsOf,
	type RoadmapProject,
	type Transition,
} from "./model";

/** What a card's latest attempt's agent is doing, for the rollups and the health signals. */
export type AgentState = "working" | "waiting" | "failed";

/** A card as a rollup counts it. */
export interface RollupCard {
	id: string;
	category: Category;
	size?: CardSize;
	agent?: AgentState;
	blocked: boolean;
	timeSpentMs: number;
}

export interface Rollup {
	cards: number;
	byCategory: Record<Category, number>;
	/** Size points (S 1, M 2, L 4) of the cards not canceled, and of those completed. */
	points: { total: number; completed: number };
	/** The agents of the active cards. */
	agents: Record<AgentState, number>;
	/** Active cards with a blocker not done. */
	blocked: number;
	timeSpentMs: number;
}

const finished = (category: Category) => category === "completed" || category === "canceled";

/** A chat state as an agent state; an interrupted run counts as failed, as the card's badge does. */
export function agentStateOf(state: ChatState | undefined): AgentState | undefined {
	if (state === "working") return "working";
	if (state === "needs_you") return "waiting";
	return state === "failed" || state === "interrupted" ? "failed" : undefined;
}

export function rollup(cards: readonly RollupCard[]): Rollup {
	const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<
		Category,
		number
	>;
	const agents: Record<AgentState, number> = { working: 0, waiting: 0, failed: 0 };
	const points = { total: 0, completed: 0 };
	let blocked = 0;
	let timeSpentMs = 0;
	for (const card of cards) {
		byCategory[card.category] += 1;
		timeSpentMs += card.timeSpentMs;
		if (card.category !== "canceled") points.total += pointsOf(card);
		if (card.category === "completed") points.completed += pointsOf(card);
		if (finished(card.category)) continue;
		if (card.agent) agents[card.agent] += 1;
		if (card.blocked) blocked += 1;
	}
	return { cards: cards.length, byCategory, points, agents, blocked, timeSpentMs };
}

/** The cards of a board with a blocker that is neither completed nor canceled; finished cards never are. */
export function blockedCards(
	cards: readonly Pick<Card, "id" | "category" | "blocks">[],
): Set<string> {
	const blocked = new Set<string>();
	for (const card of cards) {
		if (finished(card.category)) continue;
		for (const id of card.blocks) blocked.add(id);
	}
	return new Set(
		cards.filter((card) => blocked.has(card.id) && !finished(card.category)).map((card) => card.id),
	);
}

/**
 * Each card's time in started, from the transition log: every span from entering started to leaving it
 * (to review, completed or anywhere else), a span still open counting until `now`.
 */
export function timeSpent(transitions: readonly Transition[], now: number): Map<string, number> {
	const open = new Map<string, number>();
	const spent = new Map<string, number>();
	const add = (cardId: string, ms: number) =>
		spent.set(cardId, (spent.get(cardId) ?? 0) + Math.max(0, ms));
	for (const transition of [...transitions].sort((a, b) => a.at - b.at)) {
		const { cardId } = transition;
		const into = transition.to?.category === "started";
		const since = open.get(cardId);
		if (since !== undefined && !into) {
			add(cardId, transition.at - since);
			open.delete(cardId);
		}
		if (into && since === undefined) open.set(cardId, transition.at);
	}
	for (const [cardId, since] of open) add(cardId, now - since);
	return spent;
}

/** An initiative and the ones nested under it, at any depth. */
export function subtree(initiatives: readonly Initiative[], id: string): Set<string> {
	const ids = new Set([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const initiative of initiatives)
			if (initiative.parentId && ids.has(initiative.parentId) && !ids.has(initiative.id)) {
				ids.add(initiative.id);
				grew = true;
			}
	}
	return ids;
}

/**
 * The cards an initiative holds, nested initiatives included: this board's cards it or its projects
 * include, and other boards' cards it lists.
 */
export function initiativeCards(
	id: string,
	initiatives: readonly Initiative[],
	projects: readonly RoadmapProject[],
	cards: readonly Pick<Card, "id" | "projectId">[],
): { local: string[]; external: CardRef[] } {
	const ids = subtree(initiatives, id);
	const members = initiatives.filter((initiative) => ids.has(initiative.id));
	const projectIds = new Set(
		projects
			.filter((project) => project.initiativeId && ids.has(project.initiativeId))
			.map((project) => project.id),
	);
	const listed = new Set(members.flatMap((initiative) => initiative.cardIds));
	const local = cards
		.filter((card) => listed.has(card.id) || (card.projectId && projectIds.has(card.projectId)))
		.map((card) => card.id);
	const external = new Map<string, CardRef>();
	for (const initiative of members)
		for (const ref of initiative.externalCards) external.set(ref.cardId, ref);
	return { local, external: [...external.values()] };
}
