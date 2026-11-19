import { RiCheckLine, RiErrorWarningLine, RiLoader4Line, RiPushpinFill } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
	isContextMenuKey,
} from "@thinkrail/ui/context-menu";
import { cn } from "@thinkrail/ui/utils";
import {
	BaseEdge,
	type Connection,
	Controls,
	type Edge,
	type EdgeChange,
	type EdgeProps,
	getBezierPath,
	Handle,
	MiniMap,
	type Node,
	type NodeChange,
	type NodeHandle,
	type NodeProps,
	Position,
	ReactFlow,
} from "@xyflow/react";
import { createContext, type KeyboardEvent, use, useId, useRef, useState } from "react";
import { type BoardView, cardPeekEntry, enterCard, openAttempt } from "./api";
import {
	ariaLabels,
	FLOW_CONTROLS,
	FlowFrame,
	Hatch,
	shortDay,
	TimeGrid,
	useColorMode,
} from "./flowParts";
import {
	applyDrag,
	dragCommit,
	type GraphNotice,
	linkFromGraph,
	unlinkFromGraph,
	unpinFromGraph,
} from "./graphEdits";
import { initiativePeekEntry, type RoadmapView } from "./roadmapApi";
import {
	edgeLook,
	GRAPH,
	type GraphEdgeLayout,
	type GraphLayout,
	type GraphNodeLayout,
	type NodeStatus,
	nodeLook,
} from "./roadmapGraph";

type CardFlowNode = Node<{ layout: GraphNodeLayout }, "card">;
type MilestoneFlowNode = Node<{ layout: GraphNodeLayout }, "milestone">;
type GraphFlowNode = CardFlowNode | MilestoneFlowNode;
type DependencyFlowEdge = Edge<{ layout: GraphEdgeLayout }, "dependency">;

interface GraphActions {
	open: (layout: GraphNodeLayout) => void;
	enter: (layout: GraphNodeLayout) => void;
	unpin: (id: string) => void;
}

const Actions = createContext<GraphActions | null>(null);

const HANDLE = "size-8 rounded-full border border-container-elevated-bg";

const STATUS_LABELS = {
	done: "board.roadmap.graph.status.done",
	working: "board.roadmap.graph.status.working",
	waiting: "board.roadmap.graph.status.waiting",
	failed: "board.roadmap.graph.status.failed",
	started: "board.roadmap.graph.status.started",
	triage: "board.roadmap.graph.status.triage",
	ready: "board.roadmap.graph.status.ready",
	backlog: "board.roadmap.graph.status.backlog",
} as const;

function StatusIcon({ status }: { status: NodeStatus }) {
	if (status === "working")
		return (
			<RiLoader4Line
				aria-hidden
				className="size-12 shrink-0 text-primary motion-safe:animate-spin"
			/>
		);
	if (status === "done")
		return <RiCheckLine aria-hidden className="size-12 shrink-0 text-feedback-success" />;
	if (status === "failed")
		return <RiErrorWarningLine aria-hidden className="size-12 shrink-0 text-feedback-error" />;
	return (
		<span
			aria-hidden
			className={cn(
				"size-8 shrink-0 rounded-full",
				status === "waiting"
					? "bg-feedback-warning"
					: status === "triage"
						? "bg-series-3"
						: status === "started"
							? "bg-primary"
							: "bg-text-subtle",
			)}
		/>
	);
}

function CardNodeView({ data, selected }: NodeProps<CardFlowNode>) {
	const t = useT();
	const actions = use(Actions);
	const hatch = useId();
	const { layout } = data;
	const slack = layout.slack;
	const days =
		slack === null
			? ""
			: new Intl.NumberFormat(localeOf(t), { maximumFractionDigits: 1 }).format(slack);
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					data-testid="board-graph-node"
					data-card-id={layout.id}
					data-status={layout.status}
					data-critical={layout.critical || undefined}
					data-conflict={layout.conflict || undefined}
					data-pinned={layout.pinned || undefined}
					data-draggable={layout.draggable || undefined}
					className={cn(
						"relative flex size-full flex-col justify-center gap-2 rounded-sm border bg-container-elevated-bg px-6",
						nodeLook(layout, selected),
					)}
				>
					<Handle type="target" position={Position.Left} className={HANDLE} />
					{layout.wait > 0 ? (
						<svg
							data-testid="board-graph-wait"
							width={layout.wait}
							height={GRAPH.node - 2}
							className="absolute top-0 right-0 overflow-hidden rounded-r-sm"
						>
							<title>{t("board.roadmap.graph.waitTitle")}</title>
							<Hatch id={hatch} tone="warning" />
							<rect width="100%" height="100%" fill={`url(#${hatch})`} />
							<line
								x1={0}
								x2={0}
								y1={0}
								y2="100%"
								strokeDasharray="3 3"
								className="stroke-feedback-warning"
							/>
						</svg>
					) : null}
					<span className="relative flex min-w-0 items-center gap-4">
						<StatusIcon status={layout.status} />
						<span className="shrink-0 tr-code-text-small text-text-subtle">{layout.id}</span>
						{layout.pinned ? (
							<RiPushpinFill
								data-testid="board-graph-pin"
								aria-label={t("board.roadmap.graph.pinnedIcon")}
								className="size-12 shrink-0 text-text-muted"
							/>
						) : null}
						{slack !== null ? (
							<span
								data-testid="board-graph-slack"
								title={t("board.roadmap.graph.slackTitle", { days })}
								className="ml-auto shrink-0 tabular-nums tr-text-caption text-feedback-success"
							>
								{t("board.roadmap.graph.slack", { days })}
							</span>
						) : null}
					</span>
					<span className="relative min-w-0 truncate tr-text-metadata text-text-default">
						{layout.title}
					</span>
					<Handle type="source" position={Position.Right} className={HANDLE} />
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => actions?.open(layout)}>
					{t("board.roadmap.graph.menu.open")}
				</ContextMenuItem>
				{layout.card && openAttempt(layout.card) ? (
					<ContextMenuItem onSelect={() => actions?.enter(layout)}>
						{t("board.roadmap.graph.menu.enter")}
					</ContextMenuItem>
				) : null}
				{layout.pinned ? (
					<ContextMenuItem
						data-testid="board-graph-unpin"
						onSelect={() => actions?.unpin(layout.id)}
					>
						{t("board.roadmap.graph.unpin")}
					</ContextMenuItem>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MilestoneNodeView({ data, selected }: NodeProps<MilestoneFlowNode>) {
	const t = useT();
	const { layout } = data;
	return (
		<div
			data-testid="board-graph-milestone"
			data-milestone-id={layout.id}
			data-critical={layout.critical || undefined}
			data-late={layout.late || undefined}
			className="relative size-full"
		>
			<Handle type="target" position={Position.Left} isConnectable={false} className="invisible" />
			<span
				aria-hidden
				className={cn(
					"absolute inset-3 rotate-45 rounded-xs",
					layout.late
						? "bg-feedback-error"
						: layout.critical
							? "bg-feedback-warning"
							: "bg-feedback-info",
					selected && "ring-2 ring-primary",
				)}
			/>
			<span className="pointer-events-none absolute top-1/2 left-full ml-6 flex -translate-y-1/2 flex-col whitespace-nowrap">
				<span className="tr-text-metadata text-text-default">{layout.title}</span>
				<span
					className={cn("tr-text-caption", layout.late ? "text-feedback-error" : "text-text-muted")}
				>
					{shortDay(t, layout.end)}
				</span>
			</span>
		</div>
	);
}

/** The arrow head at a target's left handle, pointing right. */
function arrowHead(x: number, y: number): string {
	return `M${x},${y} L${x - 8},${y - 4} L${x - 8},${y + 4} Z`;
}

function DependencyEdgeView({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	source,
	target,
	data,
	selected,
}: EdgeProps<DependencyFlowEdge>) {
	const [path] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
	});
	const look = edgeLook(data?.layout ?? { critical: false, conflict: false }, !!selected);
	return (
		<g
			data-testid="board-graph-edge"
			data-from={source}
			data-to={target}
			data-critical={data?.layout.critical || undefined}
			data-conflict={data?.layout.conflict || undefined}
			data-selected={selected || undefined}
		>
			<BaseEdge
				id={id}
				path={path}
				interactionWidth={16}
				className={look.stroke}
				{...(data?.layout.conflict ? { strokeDasharray: "5 4" } : {})}
			/>
			<path d={arrowHead(targetX, targetY)} className={look.fill} />
		</g>
	);
}

const NODE_TYPES = { card: CardNodeView, milestone: MilestoneNodeView };
const EDGE_TYPES = { dependency: DependencyEdgeView };

function handlesOf(layout: GraphNodeLayout): NodeHandle[] {
	const middle = layout.height / 2 - 4;
	const target: NodeHandle = {
		type: "target",
		position: Position.Left,
		x: -4,
		y: middle,
		width: 8,
		height: 8,
	};
	if (layout.kind === "milestone") return [target];
	return [
		target,
		{
			type: "source",
			position: Position.Right,
			x: layout.width - 4,
			y: middle,
			width: 8,
			height: 8,
		},
	];
}

/** Where a drag or a key move holds a node until the next answer replaces the view it moved in. */
interface Held {
	view: RoadmapView;
	id: string;
	x: number;
}

/**
 * The step graph: cards and milestones over time in their projects' lanes, `blocks` links with the critical
 * path and conflicts. A card drags along its row to pin its start (Shift: its pinned chain too), a right
 * handle draws a link to another card's left one, Delete removes a selected or focused link; a click peeks
 * a card, a double click enters its workspace.
 */
export function StepGraph({
	host,
	view,
	board,
	layout,
	compact,
	onWrite,
}: {
	host: PanelHost;
	view: RoadmapView;
	board: BoardView;
	layout: GraphLayout;
	/** A narrow pane: no minimap over the canvas. */
	compact: boolean;
	onWrite: (run: () => Promise<GraphNotice | null>) => void;
}) {
	const t = useT();
	const colorMode = useColorMode();
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [held, setHeld] = useState<Held | null>(null);
	const [removed, setRemoved] = useState<{ view: RoadmapView; ids: string[] } | null>(null);
	const dragging = useRef(false);
	const { today, px } = layout;
	const byId = new Map(layout.nodes.map((node) => [node.id, node]));
	const hidden = removed?.view === view ? new Set(removed.ids) : new Set<string>();
	const cardIds = new Set(
		layout.nodes.filter((node) => node.kind === "card").map((node) => node.id),
	);

	const nodes: GraphFlowNode[] = layout.nodes.map((node) => {
		const x = held?.view === view && held.id === node.id ? held.x : node.x;
		const base = {
			id: node.id,
			position: { x, y: node.y },
			width: node.width,
			height: node.height,
			handles: handlesOf(node),
			data: { layout: node },
			draggable: node.draggable,
			connectable: node.kind === "card",
			deletable: false,
			selected: selected.has(node.id),
			ariaLabel:
				node.kind === "card"
					? t("board.roadmap.graph.nodeAria", {
							id: node.id,
							title: node.title,
							status: t(STATUS_LABELS[node.status]),
							start: shortDay(t, node.start),
							end: shortDay(t, node.end),
						})
					: t("board.roadmap.graph.milestoneAria", {
							title: node.title,
							date: shortDay(t, node.end),
						}),
		};
		return node.kind === "card" ? { ...base, type: "card" } : { ...base, type: "milestone" };
	});
	const edges: DependencyFlowEdge[] = layout.edges
		.filter((edge) => !hidden.has(edge.id))
		.map((edge) => ({
			id: edge.id,
			type: "dependency",
			source: edge.from,
			target: edge.to,
			data: { layout: edge },
			deletable: edge.deletable,
			selected: selected.has(edge.id),
			animated: edge.critical && !edge.conflict,
			zIndex: edge.critical || edge.conflict ? 1 : 0,
			ariaLabel: t("board.roadmap.graph.edgeAria", { from: edge.from, to: edge.to }),
		}));

	const select = (
		changes: readonly (NodeChange<GraphFlowNode> | EdgeChange<DependencyFlowEdge>)[],
	) => {
		const picks = changes.flatMap((change) => (change.type === "select" ? [change] : []));
		if (picks.length === 0) return;
		setSelected((current) => {
			const next = new Set(current);
			for (const change of picks) {
				if (change.selected) next.add(change.id);
				else next.delete(change.id);
			}
			return next;
		});
	};

	const commitMove = (id: string, x: number, shift: boolean) => {
		const node = byId.get(id);
		if (!node) return;
		const commit = dragCommit(node, { today, px, x, shift });
		if (commit.kind === "none") {
			setHeld(null);
			return;
		}
		setHeld({ view, id, x });
		onWrite(() => applyDrag(host, node, commit));
	};

	const onNodesChange = (changes: NodeChange<GraphFlowNode>[]) => {
		select(changes);
		for (const change of changes) {
			if (change.type !== "position" || !change.position) continue;
			const x = Math.round(change.position.x / px) * px;
			if (!dragging.current && !change.dragging) commitMove(change.id, x, false);
			else setHeld({ view, id: change.id, x });
		}
	};

	const removeEdges = (ids: readonly string[]) => {
		const gone = layout.edges.filter((edge) => ids.includes(edge.id) && edge.deletable);
		if (gone.length === 0) return;
		setRemoved({ view, ids: gone.map((edge) => edge.id) });
		onWrite(() => unlinkFromGraph(host, gone));
	};

	const onEdgesChange = (changes: EdgeChange<DependencyFlowEdge>[]) => {
		select(changes);
		removeEdges(changes.flatMap((change) => (change.type === "remove" ? [change.id] : [])));
	};

	const onConnect = (connection: Connection) =>
		onWrite(() => linkFromGraph(host, board, connection.source, connection.target));

	const actions: GraphActions = {
		open: (node) => {
			if (node.card) host.peek(cardPeekEntry(view.projectId, node.card));
			else if (node.initiativeId) {
				const initiative = view.initiatives.find((entry) => entry.id === node.initiativeId);
				if (initiative) host.peek(initiativePeekEntry(view.projectId, initiative));
			}
		},
		enter: (node) => {
			if (node.card) enterCard(host, view.projectId, node.card);
		},
		unpin: (id) => onWrite(() => unpinFromGraph(host, id)),
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const target = event.target instanceof Element ? event.target : null;
		if (event.key === "Delete" || event.key === "Backspace") {
			const edge = target?.closest(".react-flow__edge")?.getAttribute("data-id");
			if (!edge) return;
			event.stopPropagation();
			removeEdges([edge]);
			return;
		}
		if (!isContextMenuKey(event.nativeEvent)) return;
		const node = target?.closest(".react-flow__node");
		const trigger = node?.firstElementChild;
		if (!node || !trigger) return;
		event.preventDefault();
		const rect = node.getBoundingClientRect();
		trigger.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left, clientY: rect.bottom }),
		);
	};

	return (
		<Actions value={actions}>
			<FlowFrame
				testId="board-graph"
				label={t("board.roadmap.graph.label")}
				data-nodes={nodes.length}
				data-edges={edges.length}
				data-px={px}
				onKeyDown={onKeyDown}
			>
				<ReactFlow<GraphFlowNode, DependencyFlowEdge>
					key={px}
					nodes={nodes}
					edges={edges}
					nodeTypes={NODE_TYPES}
					edgeTypes={EDGE_TYPES}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					isValidConnection={(connection) =>
						connection.source !== connection.target &&
						cardIds.has(connection.source) &&
						cardIds.has(connection.target)
					}
					onNodeDragStart={() => {
						dragging.current = true;
					}}
					onNodeDragStop={(event, node) => {
						dragging.current = false;
						commitMove(node.id, Math.round(node.position.x / px) * px, event.shiftKey);
					}}
					onNodeClick={(_, node) => actions.open(node.data.layout)}
					onNodeDoubleClick={(_, node) => actions.enter(node.data.layout)}
					snapToGrid
					snapGrid={[px, 1]}
					deleteKeyCode={["Delete", "Backspace"]}
					selectionKeyCode={null}
					zoomOnDoubleClick={false}
					elevateEdgesOnSelect
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
						bands={layout.lanes.map((lane) => ({
							key: lane.id ?? "",
							top: lane.top,
							height: lane.height,
							label: lane.title ?? t("board.roadmap.graph.noProject"),
						}))}
					/>
					{compact ? null : (
						<MiniMap<GraphFlowNode>
							pannable
							zoomable
							className="rounded-sm border border-border-default"
							nodeClassName={(node) => MINIMAP_LOOKS[node.data.layout.status]}
						/>
					)}
					<Controls showInteractive={false} className={FLOW_CONTROLS} />
				</ReactFlow>
			</FlowFrame>
		</Actions>
	);
}

const MINIMAP_LOOKS: Readonly<Record<NodeStatus, string>> = {
	done: "fill-feedback-success",
	working: "fill-primary",
	waiting: "fill-feedback-warning",
	failed: "fill-feedback-error",
	started: "fill-primary-muted",
	triage: "fill-series-3",
	ready: "fill-text-muted",
	backlog: "fill-text-subtle",
};
