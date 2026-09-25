import { cn, remixicon, type SurfaceProps, ui, useAction } from "@thinkrail/ext/view";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DetailShell, EdgeDetail, FileDetail, NodeDetail } from "./detail";
import { FlowCanvas, type Mark } from "./flow";
import { parseFiles, useActionResult, useRailmap } from "./hooks";
import { layoutLevel } from "./layout";
import {
	childrenOf,
	fileLevel,
	importersOf,
	type Level,
	type LevelEdge,
	type LevelNode,
	moduleIndex,
	moduleLevel,
	subtreeOf,
} from "./levels";
import { DRIFT_KINDS, DRIFT_LABEL, type DriftKind, driftCounts, type RailmapGraph } from "./model";
import { Empty, StatusChip } from "./parts";

const { RiRefreshLine, RiArrowRightSLine } = remixicon;

type Place = { kind: "modules"; focus: string | null } | { kind: "files"; module: string };
type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

const ALL_KINDS: ReadonlySet<DriftKind> = new Set(DRIFT_KINDS);

const crumbs = (graph: RailmapGraph, place: Place) => {
	const index = moduleIndex(graph);
	const start = place.kind === "modules" ? place.focus : place.module;
	const chain: string[] = [];
	for (let at = start; at !== null && !chain.includes(at); at = index.get(at)?.parent ?? null)
		chain.unshift(at);
	return chain.map((id) => ({ id, label: index.get(id)?.label ?? id }));
};

const soleRoot = (graph: RailmapGraph) => {
	const tops = childrenOf(graph, null);
	const only = tops.length === 1 ? tops[0] : undefined;
	return only && childrenOf(graph, only.id).length > 0 ? only.id : null;
};

const filterLevel = (level: Level, filter: DriftKind | null): Level => {
	if (filter === null) return level;
	const edges = level.edges.filter((edge) =>
		filter === "bypass" ? edge.bypass > 0 : edge.state === filter,
	);
	const keep = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
	for (const node of level.nodes) if (node.drift > 0) keep.add(node.id);
	return { nodes: level.nodes.filter((node) => keep.has(node.id)), edges };
};

const GraphView = ({
	graph,
	initialFocus,
}: {
	graph: RailmapGraph;
	initialFocus: string | null;
}) => {
	const [place, setPlace] = useState<Place>({ kind: "modules", focus: initialFocus });
	const [selection, setSelection] = useState<Selection>(null);
	const [filter, setFilter] = useState<DriftKind | null>(null);
	const [positions, setPositions] = useState<ReadonlyMap<string, { x: number; y: number }>>(
		new Map(),
	);
	useEffect(() => {
		setPlace({ kind: "modules", focus: initialFocus });
		setSelection(null);
	}, [initialFocus]);

	const filesModule = place.kind === "files" ? place.module : "";
	const files = useActionResult(
		"files",
		{ module: filesModule, at: graph.builtAt },
		place.kind === "files",
		parseFiles,
	);
	const level = useMemo(() => {
		const kinds = filter ? new Set([filter]) : ALL_KINDS;
		const base =
			place.kind === "modules"
				? moduleLevel(graph, place.focus ?? soleRoot(graph), kinds)
				: fileLevel(graph, place.module, files.value ?? []);
		return filterLevel(base, filter);
	}, [graph, place, filter, files.value]);

	useEffect(() => {
		let current = true;
		void layoutLevel(level).then((next) => {
			if (current) setPositions(next);
		});
		return () => {
			current = false;
		};
	}, [level]);

	const index = useMemo(() => moduleIndex(graph), [graph]);
	const selectedNode =
		selection?.kind === "node" ? level.nodes.find((node) => node.id === selection.id) : undefined;
	const selectedEdge =
		selection?.kind === "edge" ? level.edges.find((edge) => edge.id === selection.id) : undefined;
	const affected = useMemo(() => {
		if (!selectedNode || selectedNode.kind === "file") return new Set<string>();
		const targets = new Set(
			selectedNode.kind === "self"
				? selectedNode.modules
				: selectedNode.modules.flatMap((id) => [...subtreeOf(index, id)]),
		);
		return importersOf(graph, targets);
	}, [graph, index, selectedNode]);

	const nodeMark = useCallback(
		(node: LevelNode): Mark => {
			if (!selection) return "none";
			if (selection.kind === "node" && node.id === selection.id) return "selected";
			if (node.modules.some((id) => affected.has(id))) return "affected";
			if (selectedEdge && (node.id === selectedEdge.source || node.id === selectedEdge.target))
				return "selected";
			return "dim";
		},
		[selection, affected, selectedEdge],
	);
	const edgeMark = useCallback(
		(edge: LevelEdge): Mark => {
			if (!selection) return "none";
			if (selection.kind === "edge") return edge.id === selection.id ? "selected" : "dim";
			return edge.target === selection.id || edge.source === selection.id ? "selected" : "dim";
		},
		[selection],
	);

	const drill = (node: LevelNode) => {
		if (node.kind === "file") return;
		const id = node.kind === "self" ? node.id.slice("self:".length) : node.modules[0];
		if (!id) return;
		setSelection(null);
		setPlace(
			node.kind !== "self" && childrenOf(graph, id).length > 0
				? { kind: "modules", focus: id }
				: { kind: "files", module: id },
		);
	};

	const counts = driftCounts(graph.drift);
	const trail = crumbs(graph, place);
	const selectedFile =
		selectedNode?.kind === "file"
			? files.value?.find((file) => `file:${file.path}` === selectedNode.id)
			: undefined;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-8 border-b border-border-muted px-12 py-8">
				<nav data-testid="railmap-crumbs" className="flex min-w-0 items-center gap-4 tr-text-ui">
					<button
						type="button"
						className="text-text-muted hover:text-text-default"
						onClick={() => {
							setSelection(null);
							setPlace({ kind: "modules", focus: null });
						}}
					>
						All modules
					</button>
					{trail.map((crumb) => (
						<span key={crumb.id} className="flex items-center gap-4">
							<RiArrowRightSLine className="size-14 text-text-subtle" />
							<button
								type="button"
								className="truncate text-text-muted hover:text-text-default"
								onClick={() => {
									setSelection(null);
									setPlace({ kind: "modules", focus: crumb.id });
								}}
							>
								{crumb.label}
							</button>
						</span>
					))}
					{place.kind === "files" && (
						<span className="flex items-center gap-4 text-text-default">
							<RiArrowRightSLine className="size-14 text-text-subtle" /> files
						</span>
					)}
				</nav>
				<div className="ml-auto flex flex-wrap items-center gap-4">
					{DRIFT_KINDS.map((kind) => (
						<button
							key={kind}
							type="button"
							data-testid={`railmap-chip-${kind}`}
							aria-pressed={filter === kind}
							onClick={() => setFilter(filter === kind ? null : kind)}
							className={cn(
								"rounded-sm border px-8 py-2 tr-text-metadata",
								filter === kind
									? "border-primary bg-primary-subtle text-text-default"
									: counts[kind] > 0
										? "border-feedback-error-muted text-feedback-error hover:bg-control-bg-hovered"
										: "border-border-muted text-text-muted hover:bg-control-bg-hovered",
							)}
						>
							{counts[kind]} {DRIFT_LABEL[kind].toLowerCase()}
						</button>
					))}
				</div>
			</div>
			<div className="flex min-h-0 flex-1">
				<div data-testid="railmap-canvas" className="relative min-w-0 flex-1">
					{level.nodes.length === 0 ? (
						<Empty text={files.loading ? "Loading files…" : "Nothing to show at this level."} />
					) : (
						<FlowCanvas
							level={level}
							positions={positions}
							nodeMark={nodeMark}
							edgeMark={edgeMark}
							onNode={(node) => setSelection({ kind: "node", id: node.id })}
							onDrill={drill}
							onEdge={(edge) => setSelection({ kind: "edge", id: edge.id })}
							onPane={() => setSelection(null)}
						/>
					)}
				</div>
				{selectedNode && (
					<DetailShell title={selectedNode.label} onClose={() => setSelection(null)}>
						{selectedFile ? (
							<FileDetail file={selectedFile} files={files.value ?? []} />
						) : (
							<NodeDetail
								graph={graph}
								node={selectedNode}
								affected={[...affected]}
								{...(selectedNode.drillable && selectedNode.kind !== "external"
									? { onDrill: () => drill(selectedNode) }
									: {})}
							/>
						)}
					</DetailShell>
				)}
				{selectedEdge && (
					<DetailShell
						title={`${level.nodes.find((node) => node.id === selectedEdge.source)?.label ?? ""} → ${level.nodes.find((node) => node.id === selectedEdge.target)?.label ?? ""}`}
						onClose={() => setSelection(null)}
					>
						<EdgeDetail edge={selectedEdge} at={graph.builtAt} />
					</DetailShell>
				)}
			</div>
		</div>
	);
};

const RailmapTab = ({ host, params }: SurfaceProps) => {
	const channel = useRailmap(host);
	const rebuild = useAction("rebuild");
	if (!host.workspaceId) return <Empty text="Open a workspace to map its modules." />;
	return (
		<div data-testid="railmap-graph" className="flex h-full flex-col bg-container-workspace-bg">
			<div className="flex shrink-0 items-center gap-8 border-b border-border-muted px-12 py-8">
				<span className="tr-title-compact text-text-default">Railmap</span>
				<span className="min-w-0 truncate tr-text-metadata text-text-muted">{channel?.root}</span>
				<span className="ml-auto" />
				{channel && <StatusChip channel={channel} />}
				<ui.IconTooltip label="Rebuild the graph">
					<ui.Button
						variant="ghost"
						size="icon"
						aria-label="Rebuild the graph"
						onClick={() => void rebuild()}
					>
						<RiRefreshLine className="size-14" />
					</ui.Button>
				</ui.IconTooltip>
			</div>
			{channel?.graph ? (
				<GraphView graph={channel.graph} initialFocus={params?.focus ?? null} />
			) : channel?.status.state === "error" ? (
				<Empty text={`Railmap failed: ${channel.status.error}`} />
			) : (
				<Empty text="Reading SPEC.md files and imports…" />
			)}
		</div>
	);
};

export default RailmapTab;
