import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import {
	BaseEdge,
	Controls,
	type Edge,
	type EdgeProps,
	getBezierPath,
	Handle,
	type Node,
	type NodeHandle,
	type NodeProps,
	Position,
	ReactFlow,
} from "@xyflow/react";
import { createContext, type KeyboardEvent, use, useId } from "react";
import {
	ariaLabels,
	FLOW_CONTROLS,
	FlowFrame,
	Hatch,
	shortDay,
	TimeGrid,
	useColorMode,
} from "./flowParts";
import { initiativePeekEntry, type RoadmapView } from "./roadmapApi";
import { TIMELINE, type TimelineLayout, type TimelineRow } from "./roadmapGraph";

type BarFlowNode = Node<{ row: TimelineRow; px: number }, "bar">;
type AfterFlowEdge = Edge<Record<string, never>, "after">;

const Toggle = createContext<((id: string) => void) | null>(null);

function diamond(x: number, y: number, r: number): string {
	return `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;
}

function BarNodeView({ data, selected }: NodeProps<BarFlowNode>) {
	const t = useT();
	const toggle = use(Toggle);
	const hatch = useId();
	const { row, px } = data;
	const x = (day: number) => (day - row.spanStart) * px;
	const middle = TIMELINE.barTop + TIMELINE.bar / 2;
	const expandable = row.projects > 0;
	return (
		<div
			data-testid="board-timeline-row"
			data-kind={row.kind}
			data-row-id={row.id}
			data-insufficient={row.insufficient || undefined}
			data-band={row.band ? "true" : undefined}
			className="relative size-full"
		>
			<Handle type="target" position={Position.Left} isConnectable={false} className="invisible" />
			<svg
				aria-hidden
				width={row.width}
				height={TIMELINE.node}
				className="absolute top-0 left-0 overflow-visible"
			>
				<Hatch id={hatch} tone="info" />
				{row.band ? (
					<rect
						data-testid="board-timeline-band"
						x={x(row.band.p50)}
						y={TIMELINE.barTop - 3}
						width={Math.max(2, x(row.band.p85) - x(row.band.p50))}
						height={TIMELINE.bar + 6}
						rx={2}
						fill={`url(#${hatch})`}
						strokeDasharray="3 2"
						className="stroke-feedback-info"
					>
						<title>
							{t("board.roadmap.timeline.forecastTitle", {
								p50: shortDay(t, row.band.p50),
								p85: shortDay(t, row.band.p85),
							})}
						</title>
					</rect>
				) : null}
				{row.bar ? (
					<g data-testid="board-timeline-bar">
						<rect
							x={x(row.bar.start)}
							y={TIMELINE.barTop}
							width={(row.bar.end - row.bar.start) * px}
							height={TIMELINE.bar}
							rx={3}
							className={row.kind === "initiative" ? "fill-text-subtle" : "fill-border-default"}
						/>
						<rect
							data-testid="board-timeline-done"
							x={x(row.bar.start)}
							y={TIMELINE.barTop}
							width={(row.bar.end - row.bar.start) * px * row.done}
							height={TIMELINE.bar}
							rx={3}
							className="fill-primary"
						/>
					</g>
				) : null}
				{row.target !== null ? (
					<path
						data-testid="board-timeline-target"
						d={diamond(x(row.target), middle, 6)}
						className="fill-text-default stroke-container-content-bg"
					>
						<title>
							{t("board.roadmap.timeline.targetTitle", { date: shortDay(t, row.target) })}
						</title>
					</path>
				) : null}
				{row.milestones.map((milestone) => (
					<path
						key={milestone.id}
						data-testid="board-timeline-milestone"
						d={diamond(x(milestone.day), middle, 5)}
						className={milestone.late ? "fill-feedback-error" : "fill-feedback-info"}
					>
						<title>
							{t("board.roadmap.timeline.milestoneTitle", {
								title: milestone.title,
								date: shortDay(t, milestone.day),
							})}
						</title>
					</path>
				))}
			</svg>
			<span
				className={cn(
					"absolute top-0 left-0 flex items-center gap-2 whitespace-nowrap",
					row.kind === "project" && "pl-12",
				)}
			>
				{expandable ? (
					<button
						type="button"
						data-testid="board-timeline-toggle"
						aria-label={t("board.roadmap.timeline.projects", { title: row.title })}
						className="nodrag nopan flex size-16 items-center justify-center rounded-xs text-text-muted hover:bg-control-bg-hovered focus-visible:focus-ring"
						onClick={(event) => {
							event.stopPropagation();
							toggle?.(row.id);
						}}
					>
						{row.expanded ? (
							<RiArrowDownSLine aria-hidden className="size-12" />
						) : (
							<RiArrowRightSLine aria-hidden className="size-12" />
						)}
					</button>
				) : null}
				<span
					className={cn(
						"tr-text-metadata",
						row.kind === "initiative" ? "text-text-default" : "text-text-muted",
						selected && "underline",
					)}
				>
					{row.title}
				</span>
			</span>
			<Handle type="source" position={Position.Right} isConnectable={false} className="invisible" />
		</div>
	);
}

function AfterEdgeView({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	source,
	target,
}: EdgeProps<AfterFlowEdge>) {
	const [path] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
	});
	return (
		<g data-testid="board-timeline-edge" data-from={source} data-to={target}>
			<BaseEdge id={id} path={path} strokeDasharray="4 3" className="stroke-text-muted stroke-1" />
			<path
				d={`M${targetX},${targetY} L${targetX - 7},${targetY - 3.5} L${targetX - 7},${targetY + 3.5} Z`}
				className="fill-text-muted"
			/>
		</g>
	);
}

const NODE_TYPES = { bar: BarNodeView };
const EDGE_TYPES = { after: AfterEdgeView };

function handlesOf(row: TimelineRow, px: number): NodeHandle[] {
	const y = TIMELINE.barTop + TIMELINE.bar / 2 - 4;
	const start = row.bar ? (row.bar.start - row.spanStart) * px : 0;
	const end = row.bar ? (row.bar.end - row.spanStart) * px : row.width;
	return [
		{ type: "target", position: Position.Left, x: start - 4, y, width: 8, height: 8 },
		{ type: "source", position: Position.Right, x: end - 4, y, width: 8, height: 8 },
	];
}

/**
 * The timeline: a row per initiative over the same time scale as the step graph, its plan bar filled as
 * done, its 50–85 % forecast hatched and its target a diamond, links where one initiative's card blocks
 * another's; an initiative's projects unfold under it. A click (or Enter on a focused row) opens the
 * initiative in Peek.
 */
export function TimelineGraph({
	host,
	view,
	layout,
	onToggle,
}: {
	host: PanelHost;
	view: RoadmapView;
	layout: TimelineLayout;
	onToggle: (id: string) => void;
}) {
	const t = useT();
	const colorMode = useColorMode();
	const { today, px } = layout;
	const open = (row: TimelineRow) => {
		const initiative = view.initiatives.find((entry) => entry.id === row.initiativeId);
		if (initiative) host.peek(initiativePeekEntry(view.projectId, initiative));
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Enter" || !(event.target instanceof Element)) return;
		const id = event.target.closest(".react-flow__node")?.getAttribute("data-id");
		const row = layout.rows.find((entry) => `${entry.kind}:${entry.id}` === id);
		if (row) open(row);
	};
	const nodes: BarFlowNode[] = layout.rows.map((row) => ({
		id: `${row.kind}:${row.id}`,
		type: "bar",
		position: { x: row.x, y: row.y },
		width: row.width,
		height: TIMELINE.node,
		handles: handlesOf(row, px),
		data: { row, px },
		draggable: false,
		connectable: false,
		deletable: false,
		ariaLabel: row.bar
			? t("board.roadmap.timeline.barAria", {
					title: row.title,
					start: shortDay(t, row.bar.start),
					end: shortDay(t, row.bar.end),
					percent: Math.round(row.done * 100),
				})
			: row.title,
	}));
	const edges: AfterFlowEdge[] = layout.edges.map((edge) => ({
		id: edge.id,
		type: "after",
		source: `initiative:${edge.from}`,
		target: `initiative:${edge.to}`,
		deletable: false,
		selectable: false,
		ariaLabel: t("board.roadmap.timeline.afterAria", {
			before: view.initiatives.find((entry) => entry.id === edge.from)?.title ?? edge.from,
			after: view.initiatives.find((entry) => entry.id === edge.to)?.title ?? edge.to,
		}),
	}));
	return (
		<Toggle value={onToggle}>
			<FlowFrame
				testId="board-timeline"
				label={t("board.roadmap.timeline.label")}
				data-rows={nodes.length}
				data-edges={edges.length}
				onKeyDown={onKeyDown}
			>
				<ReactFlow<BarFlowNode, AfterFlowEdge>
					key={px}
					nodes={nodes}
					edges={edges}
					nodeTypes={NODE_TYPES}
					edgeTypes={EDGE_TYPES}
					nodesDraggable={false}
					nodesConnectable={false}
					deleteKeyCode={null}
					selectionKeyCode={null}
					zoomOnDoubleClick={false}
					onNodeClick={(_, node) => open(node.data.row)}
					defaultViewport={{ x: 7 * px + 24, y: 0, zoom: 1 }}
					minZoom={0.25}
					maxZoom={2}
					colorMode={colorMode}
					ariaLabelConfig={ariaLabels(t)}
				>
					<TimeGrid
						today={today}
						px={px}
						day0={layout.day0}
						day1={layout.day1}
						weeks={layout.weeks}
						height={layout.height}
						bands={layout.rows.map((row) => ({
							key: `${row.kind}:${row.id}`,
							top: row.y - (TIMELINE.row - TIMELINE.node) / 2,
							height: TIMELINE.row,
							label: null,
						}))}
					/>
					<Controls showInteractive={false} className={FLOW_CONTROLS} />
				</ReactFlow>
			</FlowFrame>
		</Toggle>
	);
}
