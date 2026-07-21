// spec_graph — a bounded slice of the graph: subtree, ancestors, or neighbors across a chosen edge.

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type GraphSlice, graphSlice, LINK_KINDS, SLICE_DIRECTIONS } from "../core/index.ts";
import { errorResult, getIndex, textResult } from "./shared.ts";

const parameters = Type.Object({
	root: Type.String({ description: "Id of the node to start from." }),
	direction: StringEnum(SLICE_DIRECTIONS, {
		description:
			"subtree = down the parent tree; ancestors = up the parent chain; neighbors = across an edge and its reverse.",
	}),
	depth: Type.Optional(Type.Number({ description: "How many hops to expand (default: 1)." })),
	edge: Type.Optional(
		StringEnum(LINK_KINDS, {
			description: "For direction=neighbors: which edge kind to traverse (default: depends-on).",
		}),
	),
});

export function registerSpecGraph(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, GraphSlice | { error: string }>({
		name: "spec_graph",
		label: "Spec Graph",
		description:
			"Return a bounded slice of the spec-graph rooted at a node: `subtree` (down the parent tree), `ancestors` (up to the tree root), or `neighbors` (across a chosen edge and its reverse). Bounded by `depth` (default 1).",
		promptSnippet:
			"spec_graph — walk a bounded slice of the spec-graph (subtree / ancestors / neighbors) from a node.",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const graph = getIndex(ctx.cwd).graph();
			if (!graph.nodes.has(params.root)) {
				return errorResult(`No spec with id "${params.root}".`);
			}
			const slice = graphSlice(graph, {
				root: params.root,
				direction: params.direction,
				...(params.depth !== undefined ? { depth: params.depth } : {}),
				...(params.edge !== undefined ? { edge: params.edge } : {}),
			});

			const nodeLines = slice.nodes.map(
				(n) => `  ${n.id} [${n.type}]${n.title ? ` — ${n.title}` : ""} (${n.path})`,
			);
			const edgeLines = slice.edges.map((e) => `  ${e.from} --${e.kind}--> ${e.to}`);
			const text = [
				`Slice of "${params.root}" (${params.direction}, depth ${params.depth ?? 1}):`,
				`nodes (${slice.nodes.length}):`,
				...nodeLines,
				`edges (${slice.edges.length}):`,
				...edgeLines,
				slice.missing.length ? `missing targets: ${slice.missing.join(", ")}` : "",
			]
				.filter(Boolean)
				.join("\n");

			return textResult(text, slice);
		},
	});
}
