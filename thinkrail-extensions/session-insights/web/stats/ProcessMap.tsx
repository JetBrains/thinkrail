import "./processMap.css";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	ActivityNode,
	SequenceCell,
	StatsSequences,
} from "@thinkrail/pi-session-insights/core";
import { cn } from "@thinkrail/ui/utils";
import {
	type Edge,
	type EdgeProps,
	Handle,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
} from "@xyflow/react";
import { formatCount, formatPercent } from "../format";
import { ACTIVITY_BORDER, ACTIVITY_LOOK } from "./activityLook";
import { ACTIVITY_LABEL } from "./copy";
import { NODE_H, NODE_W, processLayout } from "./processLayout";

type ActivityFlowNode = Node<{ view: ActivityNode }, "activity">;
type TransitionEdge = Edge<{ cell: SequenceCell; width: number; paired: boolean }, "transition">;

interface Point {
	x: number;
	y: number;
}

function border(center: Point, toward: Point, pad: number): Point {
	const dx = toward.x - center.x;
	const dy = toward.y - center.y;
	const scale =
		1 / Math.max(Math.abs(dx) / (NODE_W / 2 + pad), Math.abs(dy) / (NODE_H / 2 + pad), 1e-9);
	return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function along(p0: Point, c: Point, p1: Point, t: number): Point {
	const u = 1 - t;
	return {
		x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
		y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
	};
}

function arrow(tip: Point, from: Point, size: number): string {
	const dx = tip.x - from.x;
	const dy = tip.y - from.y;
	const length = Math.hypot(dx, dy) || 1;
	const ux = dx / length;
	const uy = dy / length;
	const bx = tip.x - ux * size;
	const by = tip.y - uy * size;
	const half = size * 0.6;
	return `M${tip.x.toFixed(1)},${tip.y.toFixed(1)} L${(bx - uy * half).toFixed(1)},${(by + ux * half).toFixed(1)} L${(bx + uy * half).toFixed(1)},${(by - ux * half).toFixed(1)} Z`;
}

function EdgeLabel({ at, cell }: { at: Point; cell: SequenceCell }) {
	const t = useT();
	const locale = localeOf(t);
	const loop = cell.source === cell.target;
	const top = `${loop ? "↻ " : ""}${formatCount(locale, cell.count)}`;
	const bottom = `${formatPercent(locale, cell.share)}${
		cell.errorMark ? ` · ✕${formatPercent(locale, cell.afterError / cell.count)}` : ""
	}`;
	const width = Math.max(top.length, bottom.length) * 7 + 12;
	return (
		<g data-testid="process-edge-label">
			<rect
				x={at.x - width / 2}
				y={at.y - 13}
				width={width}
				height={28}
				rx={3}
				className="fill-container-elevated-bg stroke-border-default"
			/>
			<text x={at.x} y={at.y} textAnchor="middle" className="fill-text-default tr-code-text-small">
				{top}
			</text>
			<text
				x={at.x}
				y={at.y + 11}
				textAnchor="middle"
				className={cn(
					"tr-text-caption",
					cell.errorMark ? "fill-feedback-error" : "fill-text-subtle",
				)}
			>
				{bottom}
			</text>
		</g>
	);
}

function TransitionEdgeView({
	sourceX,
	sourceY,
	targetX,
	targetY,
	data,
}: EdgeProps<TransitionEdge>) {
	if (!data) return null;
	const { cell, width, paired } = data;
	const stroke = ACTIVITY_LOOK[cell.source].stroke;
	const fill = ACTIVITY_LOOK[cell.source].fill;
	const source = { x: sourceX - NODE_W / 2, y: sourceY };
	if (cell.source === cell.target) {
		const top = source.y - NODE_H / 2;
		const left = { x: source.x - 26, y: top };
		const right = { x: source.x + 26, y: top - 2 };
		const lift = 44 + width;
		const d = `M${left.x},${left.y} C${left.x - 18},${top - lift} ${right.x + 18},${top - lift} ${right.x},${right.y}`;
		return (
			<g data-testid="process-edge" data-source={cell.source} data-target={cell.target} data-loop>
				<path d={d} fill="none" strokeWidth={width} strokeOpacity={0.6} className={stroke} />
				<path
					d={arrow({ x: right.x, y: top }, { x: right.x + 6, y: top - 14 }, 7 + width / 2)}
					className={fill}
				/>
				<EdgeLabel at={{ x: source.x + 70, y: top - lift * 0.7 }} cell={cell} />
			</g>
		);
	}
	const target = { x: targetX + NODE_W / 2, y: targetY };
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const length = Math.hypot(dx, dy) || 1;
	const offset = paired ? 30 : 0;
	const control = {
		x: (source.x + target.x) / 2 + (-dy / length) * offset,
		y: (source.y + target.y) / 2 + (dx / length) * offset,
	};
	const start = border(source, control, 3);
	const end = border(target, control, 4 + width / 4);
	const d = `M${start.x.toFixed(1)},${start.y.toFixed(1)} Q${control.x.toFixed(1)},${control.y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
	return (
		<g data-testid="process-edge" data-source={cell.source} data-target={cell.target}>
			<path d={d} fill="none" strokeWidth={width} strokeOpacity={0.55} className={stroke} />
			<path d={arrow(end, along(start, control, end, 0.9), 7 + width / 2)} className={fill} />
			<EdgeLabel at={along(start, control, end, 0.5)} cell={cell} />
		</g>
	);
}

function ActivityNodeView({ data }: NodeProps<ActivityFlowNode>) {
	const t = useT();
	const locale = localeOf(t);
	const { view } = data;
	return (
		<div
			data-testid="process-node"
			data-activity={view.activity}
			className={cn(
				"flex h-56 w-168 flex-col justify-center gap-2 rounded-md border bg-container-elevated-bg py-4 pr-8 pl-12",
				ACTIVITY_BORDER[view.activity],
			)}
		>
			<Handle type="target" position={Position.Left} isConnectable={false} className="invisible" />
			<span className="flex min-w-0 items-center gap-6">
				<span className="min-w-0 flex-1 truncate tr-title-compact text-text-default">
					{t(ACTIVITY_LABEL[view.activity])}
				</span>
				{view.starts > 0 ? (
					<span
						title={t("sessionInsights.sequences.map.startsTitle")}
						className="shrink-0 rounded-sm border border-border-default px-2 tr-code-text-small text-primary"
					>
						▶{formatCount(locale, view.starts)}
					</span>
				) : null}
				{view.ends > 0 ? (
					<span
						title={t("sessionInsights.sequences.map.endsTitle")}
						className="shrink-0 rounded-sm border border-border-default px-2 tr-code-text-small text-text-muted"
					>
						■{formatCount(locale, view.ends)}
					</span>
				) : null}
			</span>
			<span className="truncate tr-code-text-small text-text-muted">
				{t("sessionInsights.sequences.map.calls", { calls: formatCount(locale, view.calls) })}
				{view.failed > 0 ? (
					<span className="text-feedback-error"> · ✕{formatCount(locale, view.failed)}</span>
				) : null}
			</span>
			<Handle type="source" position={Position.Right} isConnectable={false} className="invisible" />
		</div>
	);
}

const NODE_TYPES = { activity: ActivityNodeView };
const EDGE_TYPES = { transition: TransitionEdgeView };

/** Variant B's graph: the directly-follows map at the chosen edge threshold (its own lazy chunk). */
export default function ProcessMap({
	sequences,
	share,
}: {
	sequences: StatsSequences;
	share: number;
}) {
	const t = useT();
	const locale = localeOf(t);
	const map = processLayout(sequences, share);
	const nodes: ActivityFlowNode[] = map.nodes.map((placed) => ({
		id: placed.node.activity,
		type: "activity",
		position: { x: placed.x, y: placed.y },
		data: { view: placed.node },
		width: NODE_W,
		height: NODE_H,
		ariaLabel: t("sessionInsights.sequences.map.nodeAria", {
			activity: t(ACTIVITY_LABEL[placed.node.activity]),
			calls: formatCount(locale, placed.node.calls),
			failed: formatCount(locale, placed.node.failed),
		}),
	}));
	const edges: TransitionEdge[] = map.edges.map((edge) => ({
		id: `${edge.cell.source}>${edge.cell.target}`,
		type: "transition",
		source: edge.cell.source,
		target: edge.cell.target,
		data: { cell: edge.cell, width: edge.width, paired: edge.paired },
		ariaLabel: t("sessionInsights.sequences.cellAria", {
			source: t(ACTIVITY_LABEL[edge.cell.source]),
			target: t(ACTIVITY_LABEL[edge.cell.target]),
			share: formatPercent(locale, edge.cell.share),
			count: formatCount(locale, edge.cell.count),
		}),
	}));
	return (
		<div
			data-testid="process-map"
			data-nodes={nodes.length}
			data-edges={edges.length}
			className="h-480 w-full min-w-0 rounded-md border border-border-default bg-container-content-bg [&_.react-flow\_\_attribution]:rounded-tl-sm [&_.react-flow\_\_attribution]:bg-container-elevated-bg [&_.react-flow\_\_attribution_a]:text-text-subtle"
		>
			<ReactFlow
				key={share}
				nodes={nodes}
				edges={edges}
				nodeTypes={NODE_TYPES}
				edgeTypes={EDGE_TYPES}
				fitView
				minZoom={0.3}
				maxZoom={1}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				zoomOnScroll={false}
				preventScrolling={false}
			/>
		</div>
	);
}
