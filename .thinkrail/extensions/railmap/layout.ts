import ELK from "elkjs/lib/elk.bundled.js";
import type { Level, LevelNode } from "./levels";

const elk = new ELK();

export const NODE_HEIGHT = 52;
const CHAR_WIDTH = 7;

export const nodeWidth = (node: Pick<LevelNode, "label" | "sublabel">) =>
	Math.min(
		280,
		Math.max(140, Math.max(node.label.length, node.sublabel.length * 0.85) * CHAR_WIDTH + 48),
	);

const OPTIONS = {
	"elk.algorithm": "layered",
	"elk.direction": "RIGHT",
	"elk.edgeRouting": "SPLINES",
	"elk.layered.spacing.nodeNodeBetweenLayers": "72",
	"elk.spacing.nodeNode": "20",
	"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
	"elk.separateConnectedComponents": "true",
	"elk.spacing.componentComponent": "40",
};

export const layoutLevel = async (level: Level) => {
	const result = await elk.layout({
		id: "root",
		layoutOptions: OPTIONS,
		children: level.nodes.map((node) => ({
			id: node.id,
			width: nodeWidth(node),
			height: NODE_HEIGHT,
		})),
		edges: level.edges.map((edge) => ({
			id: edge.id,
			sources: [edge.source],
			targets: [edge.target],
		})),
	});
	return new Map(
		(result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
	);
};
