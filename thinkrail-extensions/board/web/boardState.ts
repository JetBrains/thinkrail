import { useSyncExternalStore } from "react";
import {
	agentBadge,
	type BoardView,
	type Card,
	type CardSize,
	type CardType,
	type WipCount,
} from "./api";
import type { Initiative } from "./roadmapApi";

/** What Board view's center shows. */
export type CenterView =
	| "board"
	| "list"
	| "roadmap"
	| "graph"
	| "timeline"
	| "insights"
	| "discovery";

export const CENTER_VIEWS: readonly CenterView[] = [
	"board",
	"list",
	"roadmap",
	"graph",
	"timeline",
	"insights",
	"discovery",
];

/** A queue of the navigation: the cards waiting on something. */
export type Queue = "needsYou" | "triage" | "review" | "failed";

export const QUEUES: readonly Queue[] = ["needsYou", "triage", "review", "failed"];

export interface CardFilters {
	types: readonly CardType[];
	sizes: readonly CardSize[];
	/** Only the cards a human created. */
	mine: boolean;
}

/** Board view's selection, shared by its navigation and its center; one per window, never stored. */
export interface BoardSelection {
	/** The project picked in the navigation; `null` follows the active workspace's. */
	projectId: string | null;
	view: CenterView;
	initiativeId: string | null;
	queue: Queue | null;
	filters: CardFilters;
}

const NO_FILTERS: CardFilters = { types: [], sizes: [], mine: false };

const INITIAL: BoardSelection = {
	projectId: null,
	view: "board",
	initiativeId: null,
	queue: null,
	filters: NO_FILTERS,
};

let selection = INITIAL;
const listeners = new Set<() => void>();

function update(next: (current: BoardSelection) => BoardSelection): void {
	selection = next(selection);
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const current = () => selection;

export function useBoardSelection(): BoardSelection {
	return useSyncExternalStore(subscribe, current, current);
}

function toggled<T>(values: readonly T[], value: T): T[] {
	return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/** Another project: its own initiatives and queues, so the card filters that name them are cleared. */
export function selectProject(projectId: string): void {
	update((current) => ({ ...current, projectId, initiativeId: null, queue: null }));
}

export function selectCenterView(view: CenterView): void {
	update((current) => ({ ...current, view }));
}

/** An initiative to narrow the cards to (`null`: all cards); a card view replaces a roadmap one. */
export function selectInitiative(initiativeId: string | null): void {
	update((current) => ({
		...current,
		initiativeId,
		view: current.view === "board" || current.view === "list" ? current.view : "board",
	}));
}

/** Toggles a queue, the cards' view shown. */
export function toggleQueue(queue: Queue): void {
	update((current) => ({
		...current,
		queue: current.queue === queue ? null : queue,
		view: current.view === "board" || current.view === "list" ? current.view : "board",
	}));
}

export function toggleType(type: CardType): void {
	update((current) => ({
		...current,
		filters: { ...current.filters, types: toggled(current.filters.types, type) },
	}));
}

export function toggleSize(size: CardSize): void {
	update((current) => ({
		...current,
		filters: { ...current.filters, sizes: toggled(current.filters.sizes, size) },
	}));
}

export function toggleMine(): void {
	update((current) => ({
		...current,
		filters: { ...current.filters, mine: !current.filters.mine },
	}));
}

export function clearFilters(): void {
	update((current) => ({ ...current, initiativeId: null, queue: null, filters: NO_FILTERS }));
}

/** Back to the first selection: a test's isolation. */
export function resetBoardSelection(): void {
	update(() => INITIAL);
}

/** The project Board view shows: the one picked while it is still open, else the active workspace's. */
export function shownProject(
	picked: string | null,
	scopeProjectId: string,
	open: readonly { projectId: string }[] | null,
): string {
	if (picked === null) return scopeProjectId;
	if (open !== null && !open.some((project) => project.projectId === picked)) return scopeProjectId;
	return picked;
}

export function inQueue(card: Pick<Card, "category" | "live">, queue: Queue): boolean {
	switch (queue) {
		case "needsYou":
			return agentBadge(card) === "waiting";
		case "failed":
			return agentBadge(card) === "failed";
		case "triage":
			return card.category === "triage";
		case "review":
			return card.category === "review";
	}
}

/** A queue's figure: its count, Review's against the Review limit. */
export function queueCount(view: Pick<BoardView, "cards" | "wip">, queue: Queue): WipCount {
	const count = view.cards.filter((card) => inQueue(card, queue)).length;
	return { count, limit: queue === "review" ? view.wip.review.limit : 0 };
}

/** Whether any of the card filters is on. */
export function filtering(
	current: Pick<BoardSelection, "initiativeId" | "queue" | "filters">,
): boolean {
	const { filters } = current;
	return (
		current.initiativeId !== null ||
		current.queue !== null ||
		filters.types.length > 0 ||
		filters.sizes.length > 0 ||
		filters.mine
	);
}

/**
 * The cards the navigation leaves: the selected initiative's members (its nested initiatives' and roadmap
 * projects' included), the queue's and those matching every saved filter (a type, a size, created by a
 * human). An initiative the roadmap no longer has filters nothing.
 */
export function filterCards<T extends Card>(
	cards: readonly T[],
	current: Pick<BoardSelection, "initiativeId" | "queue" | "filters">,
	initiatives: readonly Pick<Initiative, "id" | "memberCardIds">[] = [],
): T[] {
	const initiative = current.initiativeId
		? initiatives.find((candidate) => candidate.id === current.initiativeId)
		: undefined;
	const members = initiative ? new Set(initiative.memberCardIds) : null;
	const { types, sizes, mine } = current.filters;
	return cards.filter(
		(card) =>
			(members === null || members.has(card.id)) &&
			(current.queue === null || inQueue(card, current.queue)) &&
			(types.length === 0 || types.includes(card.type)) &&
			(sizes.length === 0 || (card.size !== undefined && sizes.includes(card.size))) &&
			(!mine || card.createdBy === "human"),
	);
}
