import type { PanelHost } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import type { BoardView } from "./api";
import { dayText } from "./labels";
import { linkCards, pinCard, shiftChain, unlinkCards, unpinCard } from "./roadmapApi";
import { type GraphEdgeLayout, type GraphNodeLayout, isoOfDay } from "./roadmapGraph";

type Querying = Pick<PanelHost, "query">;

/** What an edit says in the graph's status line. */
export interface GraphNotice {
	tone: "info" | "error";
	key: MessageKey;
	values: Record<string, string | number>;
}

export type DragCommit =
	| { kind: "none" }
	| { kind: "pin"; start: string }
	| { kind: "shift"; days: number };

/**
 * A node dropped at `x` (snapped to whole days): pin its planned start there, or with Shift move it and
 * its pinned chain by the days moved, counted from the start the host counts from. Back on its own day
 * is no edit.
 */
export function dragCommit(
	node: Pick<GraphNodeLayout, "start">,
	drop: { today: number; px: number; x: number; shift: boolean },
): DragCommit {
	const day = drop.today + Math.round(drop.x / drop.px);
	if (day === drop.today + Math.round(node.start - drop.today)) return { kind: "none" };
	if (drop.shift) return { kind: "shift", days: day - Math.floor(node.start) };
	return { kind: "pin", start: isoOfDay(day) };
}

export async function applyDrag(
	host: Querying,
	node: Pick<GraphNodeLayout, "id">,
	commit: DragCommit,
): Promise<GraphNotice | null> {
	if (commit.kind === "none") return null;
	if (commit.kind === "shift") {
		await shiftChain(host, node.id, commit.days);
		return {
			tone: "info",
			key: "board.roadmap.graph.notice.shifted",
			values: { id: node.id, days: commit.days > 0 ? `+${commit.days}` : String(commit.days) },
		};
	}
	await pinCard(host, node.id, commit.start);
	return {
		tone: "info",
		key: "board.roadmap.graph.notice.pinned",
		values: { id: node.id, date: dayText(commit.start) },
	};
}

/** Every card `id` blocks, transitively, on the board. */
function dependents(board: Pick<BoardView, "cards">, id: string): Set<string> {
	const blocks = new Map(board.cards.map((card) => [card.id, card.blocks]));
	const seen = new Set<string>();
	const stack = [...(blocks.get(id) ?? [])];
	for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
		if (seen.has(next)) continue;
		seen.add(next);
		stack.push(...(blocks.get(next) ?? []));
	}
	return seen;
}

export type LinkRefusal = "self" | "cycle" | "present" | "not-card";

/** Why "`from` blocks `to`" can't be drawn: a node that is no card, itself, a link already there, a cycle. */
export function linkRefusal(
	board: Pick<BoardView, "cards">,
	from: string,
	to: string,
): LinkRefusal | null {
	const source = board.cards.find((card) => card.id === from);
	if (!source || !board.cards.some((card) => card.id === to)) return "not-card";
	if (from === to) return "self";
	if (source.blocks.includes(to)) return "present";
	return dependents(board, to).has(from) ? "cycle" : null;
}

/** A connection drawn from `from`'s right handle to `to`'s left one: `card.link`, unless it is refused. */
export async function linkFromGraph(
	host: Querying,
	board: Pick<BoardView, "cards">,
	from: string,
	to: string,
): Promise<GraphNotice | null> {
	const refusal = linkRefusal(board, from, to);
	if (refusal === "cycle")
		return { tone: "error", key: "board.roadmap.graph.notice.cycle", values: { from, to } };
	if (refusal) return null;
	await linkCards(host, from, to);
	return { tone: "info", key: "board.roadmap.graph.notice.linked", values: { from, to } };
}

/** Deleted edges: `card.unlink` for each `blocks` link; a card's edge to its milestone stays. */
export async function unlinkFromGraph(
	host: Querying,
	edges: readonly Pick<GraphEdgeLayout, "from" | "to" | "deletable">[],
): Promise<GraphNotice | null> {
	const links = edges.filter((edge) => edge.deletable);
	for (const edge of links) await unlinkCards(host, edge.from, edge.to);
	const [first] = links;
	if (!first) return null;
	return {
		tone: "info",
		key: "board.roadmap.graph.notice.unlinked",
		values: { from: first.from, to: first.to },
	};
}

export async function unpinFromGraph(host: Querying, id: string): Promise<GraphNotice> {
	await unpinCard(host, id);
	return { tone: "info", key: "board.roadmap.graph.notice.unpinned", values: { id } };
}
