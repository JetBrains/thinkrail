import type { Category } from "./model";

/** A card as the step graph schedules it; days are days since 1970-01-01 UTC, fractional. */
export interface ScheduleCard {
	id: string;
	category: Category;
	blocks: readonly string[];
	estimateDays: number;
	/** A pinned planned start (day number); only a card not started yet keeps to it. */
	pinnedStart?: number;
	/** When its current started span began. */
	startedAt?: number;
	/** When it first started, for a completed card's actual span. */
	firstStartedAt?: number;
	completedAt?: number;
	/** Its roadmap project, the graph's lane. */
	lane?: string;
	milestoneId?: string;
}

export interface ScheduleMilestone {
	id: string;
	lane: string;
	target?: number;
}

export interface ScheduleNode {
	id: string;
	kind: "card" | "milestone";
	lane: string | null;
	start: number;
	end: number;
	/** Days it can slip without moving the finish; 0 on a done card. */
	slack: number;
	critical: boolean;
	/** A pinned start earlier than its blockers' end. */
	conflict: boolean;
	pinned: boolean;
	done: boolean;
	/** A milestone ending past its target day. */
	late?: true;
}

export interface ScheduleEdge {
	from: string;
	to: string;
	critical: boolean;
	conflict: boolean;
}

export interface Schedule {
	today: number;
	/** The latest end: the latest milestone or card. */
	finish: number;
	/** In topological order: every node after its blockers. */
	nodes: ScheduleNode[];
	edges: ScheduleEdge[];
	/** The critical nodes, earliest first. */
	criticalPath: string[];
	/** `blocks` links left out because they close a cycle. */
	cycles: { from: string; to: string }[];
}

const EPSILON = 0.01;
const PINNABLE: ReadonlySet<Category> = new Set(["triage", "backlog", "unstarted"]);

/** Whether a card's planned start can still be pinned: it has not started. */
export function isPinnable(category: Category): boolean {
	return PINNABLE.has(category);
}

/** Whether `from` blocking `to` would close a cycle of `blocks` links (or link a card to itself). */
export function wouldCycle(
	blocksOf: (id: string) => readonly string[] | undefined,
	from: string,
	to: string,
): boolean {
	return from === to || dependentsOf(blocksOf, to).has(from);
}

/** Every card `id` blocks, transitively. */
export function dependentsOf(
	blocksOf: (id: string) => readonly string[] | undefined,
	id: string,
): Set<string> {
	const seen = new Set<string>();
	const stack = [...(blocksOf(id) ?? [])];
	for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
		if (seen.has(next)) continue;
		seen.add(next);
		stack.push(...(blocksOf(next) ?? []));
	}
	return seen;
}

const round = (days: number) => Math.round(days * 10) / 10;

/** The latest finish of each node over `edges`, back from `finish`, visiting `order` reversed. */
function latestFinish(
	order: readonly ScheduleNode[],
	edges: readonly ScheduleEdge[],
	finish: number,
): Map<string, number> {
	const successors = new Map<string, string[]>();
	for (const edge of edges)
		successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to]);
	const byId = new Map(order.map((node) => [node.id, node]));
	const latest = new Map<string, number>();
	for (const node of [...order].reverse()) {
		const starts = (successors.get(node.id) ?? []).flatMap((id) => {
			const next = byId.get(id);
			const lf = latest.get(id);
			return next && lf !== undefined ? [lf - (next.end - next.start)] : [];
		});
		latest.set(node.id, starts.length > 0 ? Math.min(...starts) : finish);
	}
	return latest;
}

const isCritical = (node: ScheduleNode, lf: number | undefined) =>
	!node.done && lf !== undefined && lf - node.end < EPSILON;

/**
 * The step graph's schedule, the prototype's forward / backward pass: a card starts at its pinned start,
 * else when its blockers end (not before today; a started card at its actual start), and ends after its
 * estimate (a started card not before today; a done card at its completion). A milestone is a zero-length
 * node after its cards. The backward pass from the latest end gives slack and the critical path; a pinned
 * start before its blockers' end is a conflict. A link closing a cycle is left out and reported; canceled
 * cards are no nodes.
 */
export function schedule(input: {
	cards: readonly ScheduleCard[];
	milestones: readonly ScheduleMilestone[];
	today: number;
}): Schedule {
	const { today } = input;
	const cards = new Map(
		input.cards.filter((card) => card.category !== "canceled").map((card) => [card.id, card]),
	);
	const milestones = new Map(input.milestones.map((milestone) => [milestone.id, milestone]));
	const blockers = new Map<string, string[]>();
	const cycles: { from: string; to: string }[] = [];
	for (const card of cards.values())
		for (const to of card.blocks)
			if (to !== card.id && cards.has(to)) blockers.set(to, [...(blockers.get(to) ?? []), card.id]);
	for (const card of cards.values())
		if (card.milestoneId && milestones.has(card.milestoneId))
			blockers.set(card.milestoneId, [...(blockers.get(card.milestoneId) ?? []), card.id]);

	const order: string[] = [];
	const state = new Map<string, "visiting" | "done">();
	const kept = new Map<string, string[]>();
	const visit = (id: string) => {
		state.set(id, "visiting");
		const accepted: string[] = [];
		for (const from of blockers.get(id) ?? []) {
			const seen = state.get(from);
			if (seen === "visiting") {
				cycles.push({ from, to: id });
				continue;
			}
			if (seen === undefined) visit(from);
			accepted.push(from);
		}
		kept.set(id, accepted);
		state.set(id, "done");
		order.push(id);
	};
	for (const id of [...cards.keys(), ...milestones.keys()]) if (!state.has(id)) visit(id);

	const nodes = new Map<string, ScheduleNode>();
	for (const id of order) {
		const ends = (kept.get(id) ?? []).map((from) => nodes.get(from)?.end ?? today);
		const depEnd = ends.length > 0 ? Math.max(...ends) : Number.NEGATIVE_INFINITY;
		const milestone = milestones.get(id);
		if (milestone) {
			const at = ends.length > 0 ? depEnd : (milestone.target ?? today);
			const from = kept.get(id) ?? [];
			nodes.set(id, {
				id,
				kind: "milestone",
				lane: milestone.lane,
				start: at,
				end: at,
				slack: 0,
				critical: false,
				conflict: false,
				pinned: false,
				done: from.length > 0 && from.every((card) => nodes.get(card)?.done),
				...(milestone.target !== undefined && at > milestone.target + 1 ? { late: true } : {}),
			});
			continue;
		}
		const card = cards.get(id);
		if (!card) continue;
		let start: number;
		let end: number;
		let pinned = false;
		let conflict = false;
		if (card.category === "completed") {
			end = card.completedAt ?? today;
			start = Math.min(end, card.firstStartedAt ?? card.startedAt ?? end - card.estimateDays);
		} else if (!isPinnable(card.category)) {
			start = card.startedAt ?? today;
			end = Math.max(start + card.estimateDays, today);
		} else {
			pinned = card.pinnedStart !== undefined;
			start = card.pinnedStart ?? Math.max(depEnd, today);
			end = start + card.estimateDays;
			conflict = pinned && start < depEnd - EPSILON;
		}
		nodes.set(id, {
			id,
			kind: "card",
			lane: card.lane ?? null,
			start,
			end,
			slack: 0,
			critical: false,
			conflict,
			pinned,
			done: card.category === "completed",
		});
	}

	const ordered = order.flatMap((id) => nodes.get(id) ?? []);
	const edges: ScheduleEdge[] = order.flatMap((to) =>
		(kept.get(to) ?? []).map((from) => ({ from, to, critical: false, conflict: false })),
	);
	const finish = ordered.length > 0 ? Math.max(...ordered.map((node) => node.end)) : today;
	const latest = latestFinish(ordered, edges, finish);
	for (const node of ordered) {
		const lf = latest.get(node.id) ?? finish;
		node.slack = node.done ? 0 : Math.max(0, round(lf - node.end));
		node.critical = isCritical(node, lf);
	}
	for (const edge of edges) {
		const from = nodes.get(edge.from);
		const to = nodes.get(edge.to);
		if (!from || !to) continue;
		edge.critical = from.critical && to.critical && Math.abs(from.end - to.start) < EPSILON;
		edge.conflict = to.pinned && from.end > to.start + EPSILON;
	}
	return {
		today,
		finish,
		nodes: ordered,
		edges,
		criticalPath: ordered
			.filter((node) => node.critical)
			.sort((a, b) => a.start - b.start || a.end - b.end)
			.map((node) => node.id),
		cycles,
	};
}

/** The critical nodes among `members` alone: the backward pass over their links, from their latest end. */
export function criticalWithin(plan: Schedule, members: ReadonlySet<string>): Set<string> {
	const order = plan.nodes.filter((node) => members.has(node.id));
	if (order.length === 0) return new Set();
	const edges = plan.edges.filter((edge) => members.has(edge.from) && members.has(edge.to));
	const finish = Math.max(...order.map((node) => node.end));
	const latest = latestFinish(order, edges, finish);
	return new Set(
		order.filter((node) => isCritical(node, latest.get(node.id))).map((node) => node.id),
	);
}
