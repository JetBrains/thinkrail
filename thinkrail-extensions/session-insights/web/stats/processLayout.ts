import { Graph, layout } from "@dagrejs/dagre";
import type {
	Activity,
	ActivityNode,
	SequenceCell,
	StatsSequences,
} from "@thinkrail/pi-session-insights/core";

export const NODE_W = 168;
export const NODE_H = 56;

export interface MapNode {
	node: ActivityNode;
	/** Top-left corner. */
	x: number;
	y: number;
}

export interface MapEdge {
	cell: SequenceCell;
	/** Stroke width by the edge's count against the largest shown edge. */
	width: number;
	/** The reverse edge is shown too, so this one bends aside. */
	paired: boolean;
}

export interface ProcessLayout {
	nodes: MapNode[];
	edges: MapEdge[];
}

/**
 * The directly-follows graph at one edge threshold: edges with at least `threshold.min` transitions,
 * the activities they touch, laid out left to right by dagre (self-loops drawn apart).
 */
export function processLayout(sequences: StatsSequences, share: number): ProcessLayout {
	const min = sequences.thresholds.find((entry) => entry.share === share)?.min ?? 1;
	const shown = sequences.cells.filter((cell) => cell.count >= min);
	const touched = new Set<Activity>();
	for (const cell of shown) {
		touched.add(cell.source);
		touched.add(cell.target);
	}
	const nodes = sequences.nodes.filter((node) => touched.has(node.activity));
	const graph = new Graph({ multigraph: false });
	graph.setGraph({ rankdir: "LR", nodesep: 72, ranksep: 180, marginx: 24, marginy: 56 });
	graph.setDefaultEdgeLabel(() => ({}));
	for (const node of nodes) graph.setNode(node.activity, { width: NODE_W, height: NODE_H });
	for (const cell of shown)
		if (cell.source !== cell.target)
			graph.setEdge(cell.source, cell.target, { weight: cell.count, minlen: 1 });
	layout(graph);
	const max = Math.max(1, ...shown.map((cell) => cell.count));
	const keys = new Set(shown.map((cell) => `${cell.source}>${cell.target}`));
	return {
		nodes: nodes.map((node) => {
			const placed = graph.node(node.activity);
			return {
				node,
				x: Math.round((placed?.x ?? 0) - NODE_W / 2),
				y: Math.round((placed?.y ?? 0) - NODE_H / 2),
			};
		}),
		edges: shown.map((cell) => ({
			cell,
			width: 1.5 + 9 * (cell.count / max),
			paired: cell.source !== cell.target && keys.has(`${cell.target}>${cell.source}`),
		})),
	};
}
