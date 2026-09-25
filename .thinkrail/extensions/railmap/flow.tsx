import { cn, remixicon } from "@thinkrail/ext/view";
import {
	BaseEdge,
	type Edge,
	type EdgeProps,
	getBezierPath,
	Handle,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useMemo } from "react";
import { NODE_HEIGHT, nodeWidth } from "./layout";
import type { EdgeState, Level, LevelEdge, LevelNode } from "./levels";

const { RiArrowRightSLine } = remixicon;

export type Mark = "selected" | "affected" | "dim" | "none";

interface NodeData extends Record<string, unknown> {
	node: LevelNode;
	mark: Mark;
}

interface EdgeData extends Record<string, unknown> {
	edge: LevelEdge;
	mark: Mark;
}

type RailNode = Node<NodeData, "rail">;
type RailEdge = Edge<EdgeData, "rail">;

const HANDLE = "size-4 min-w-0 border-0 bg-transparent";

const RailNodeView = ({ data }: NodeProps<RailNode>) => {
	const { node, mark } = data;
	return (
		<div
			data-testid="railmap-node"
			data-kind={node.kind}
			data-id={node.id}
			data-mark={mark}
			className={cn(
				"flex h-full w-full cursor-pointer items-center gap-8 rounded-md border px-12 tr-text-ui",
				node.kind === "external"
					? "border-dashed border-border-muted bg-container-workspace-bg text-text-muted"
					: node.kind === "self"
						? "border-border-default bg-control-bg text-text-default"
						: "border-border-default bg-container-elevated-bg text-text-default",
				mark === "selected" && "border-primary ring-1 ring-primary",
				mark === "affected" && "border-feedback-warning bg-feedback-warning-subtle",
				mark === "dim" && "opacity-40",
			)}
		>
			<Handle type="target" position={Position.Left} className={HANDLE} isConnectable={false} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate">{node.label}</span>
				<span className="truncate tr-text-metadata text-text-subtle">{node.sublabel}</span>
			</div>
			{node.drift > 0 && (
				<span
					data-testid="railmap-node-drift"
					className="shrink-0 rounded-sm bg-feedback-error-subtle px-4 tr-text-metadata text-feedback-error"
				>
					{node.drift}
				</span>
			)}
			{node.drillable && <RiArrowRightSLine className="size-14 shrink-0 text-text-subtle" />}
			<Handle type="source" position={Position.Right} className={HANDLE} isConnectable={false} />
		</div>
	);
};

const STROKE: Record<EdgeState, string> = {
	undeclared: "stroke-feedback-error",
	declared: "stroke-text-subtle",
	structural: "stroke-border-default",
	unused: "stroke-feedback-warning [stroke-dasharray:4_4]",
};

const RailEdgeView = (props: EdgeProps<RailEdge>) => {
	const [path] = getBezierPath(props);
	const edge = props.data?.edge;
	const mark = props.data?.mark ?? "none";
	return (
		<BaseEdge
			path={path}
			interactionWidth={16}
			className={cn(
				!edge
					? "stroke-border-default"
					: edge.bypass > 0
						? "stroke-feedback-error"
						: STROKE[edge.state],
				(edge?.imports ?? 0) >= 8 || (edge?.bypass ?? 0) > 0 ? "stroke-2" : "stroke-1",
				mark === "selected" && "stroke-primary stroke-2",
				mark === "affected" && "stroke-feedback-warning",
				mark === "dim" && "opacity-20",
			)}
		/>
	);
};

const nodeTypes = { rail: RailNodeView };
const edgeTypes = { rail: RailEdgeView };

interface CanvasProps {
	level: Level;
	positions: ReadonlyMap<string, { x: number; y: number }>;
	nodeMark: (node: LevelNode) => Mark;
	edgeMark: (edge: LevelEdge) => Mark;
	onNode: (node: LevelNode) => void;
	onDrill: (node: LevelNode) => void;
	onEdge: (edge: LevelEdge) => void;
	onPane: () => void;
}

const Canvas = ({
	level,
	positions,
	nodeMark,
	edgeMark,
	onNode,
	onDrill,
	onEdge,
	onPane,
}: CanvasProps) => {
	const flow = useReactFlow();
	const nodes = useMemo<RailNode[]>(
		() =>
			level.nodes.map((node) => ({
				id: node.id,
				type: "rail",
				position: positions.get(node.id) ?? { x: 0, y: 0 },
				width: nodeWidth(node),
				height: NODE_HEIGHT,
				data: { node, mark: nodeMark(node) },
				draggable: false,
				connectable: false,
			})),
		[level, positions, nodeMark],
	);
	const edges = useMemo<RailEdge[]>(
		() =>
			level.edges.map((edge) => ({
				id: edge.id,
				type: "rail",
				source: edge.source,
				target: edge.target,
				data: { edge, mark: edgeMark(edge) },
			})),
		[level, edgeMark],
	);
	useEffect(() => {
		if (positions.size === 0) return;
		const frame = requestAnimationFrame(
			() => void flow.fitView({ padding: 0.12, duration: 0, maxZoom: 1.1 }),
		);
		return () => cancelAnimationFrame(frame);
	}, [positions, flow]);
	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			nodeTypes={nodeTypes}
			edgeTypes={edgeTypes}
			onNodeClick={(_event, node) => onNode(node.data.node)}
			onNodeDoubleClick={(_event, node) => onDrill(node.data.node)}
			onEdgeClick={(_event, edge) => {
				if (edge.data) onEdge(edge.data.edge);
			}}
			onPaneClick={onPane}
			nodesConnectable={false}
			nodesDraggable={false}
			zoomOnDoubleClick={false}
			minZoom={0.1}
			proOptions={{ hideAttribution: true }}
			fitView
		/>
	);
};

export const FlowCanvas = (props: CanvasProps) => (
	<ReactFlowProvider>
		<Canvas {...props} />
	</ReactFlowProvider>
);
