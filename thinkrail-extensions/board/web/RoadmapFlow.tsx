import "./roadmapFlow.css";
import { RiPushpinFill } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useId, useState } from "react";
import type { BoardLayout, BoardView } from "./api";
import { FIELD } from "./CardParts";
import { shortDay } from "./flowParts";
import type { GraphNotice } from "./graphEdits";
import type { RoadmapView } from "./roadmapApi";
import {
	GRAPH_SCALES,
	type GraphLayout,
	type GraphScale,
	SCALE_PX,
	stepGraphLayout,
	timelineLayout,
} from "./roadmapGraph";
import { StepGraph } from "./StepGraph";
import { TimelineGraph } from "./TimelineGraph";

export type RoadmapFlowKind = "graph" | "timeline";

const SCALE_LABELS = {
	weeks: "board.roadmap.graph.scale.weeks",
	days: "board.roadmap.graph.scale.days",
} as const satisfies Record<GraphScale, string>;

function Swatch({ className, children }: { className: string; children: ReactNode }) {
	return (
		<li className="flex items-center gap-4">
			<span aria-hidden className={cn("inline-block shrink-0", className)} />
			{children}
		</li>
	);
}

function GraphLegend() {
	const t = useT();
	return (
		<ul
			data-testid="board-graph-legend"
			className="flex shrink-0 flex-wrap items-center gap-12 border-border-muted border-t px-8 py-4 tr-text-metadata text-text-muted"
		>
			<Swatch className="h-8 w-16 rounded-xs border border-feedback-success-muted opacity-60">
				{t("board.roadmap.graph.legend.done")}
			</Swatch>
			<Swatch className="h-8 w-16 rounded-xs border border-primary">
				{t("board.roadmap.graph.legend.working")}
			</Swatch>
			<Swatch className="h-8 w-16 rounded-xs border border-feedback-warning bg-feedback-warning-muted">
				{t("board.roadmap.graph.legend.waiting")}
			</Swatch>
			<Swatch className="h-8 w-16 rounded-xs border border-dashed border-series-3">
				{t("board.roadmap.graph.legend.triage")}
			</Swatch>
			<Swatch className="h-2 w-16 bg-feedback-warning">
				{t("board.roadmap.graph.legend.critical")}
			</Swatch>
			<Swatch className="h-2 w-16 border-t-2 border-dashed border-feedback-error">
				{t("board.roadmap.graph.legend.conflict")}
			</Swatch>
			<li className="flex items-center gap-4">
				<RiPushpinFill aria-hidden className="size-12 text-text-muted" />
				{t("board.roadmap.graph.legend.pinned")}
			</li>
			<li className="flex items-center gap-4">
				<span className="text-feedback-success">
					{t("board.roadmap.graph.slack", { days: "N" })}
				</span>
				{t("board.roadmap.graph.legend.slack")}
			</li>
			<li>{t("board.roadmap.graph.legend.edit")}</li>
		</ul>
	);
}

function TimelineLegend() {
	const t = useT();
	return (
		<ul
			data-testid="board-timeline-legend"
			className="flex shrink-0 flex-wrap items-center gap-12 border-border-muted border-t px-8 py-4 tr-text-metadata text-text-muted"
		>
			<li className="flex items-center gap-4">
				<span aria-hidden className="flex h-8 w-16 overflow-hidden rounded-xs bg-text-subtle">
					<span className="w-6 bg-primary" />
				</span>
				{t("board.roadmap.timeline.legend.plan")}
			</li>
			<Swatch className="h-8 w-16 rounded-xs border border-dashed border-feedback-info bg-feedback-info-muted">
				{t("board.roadmap.timeline.legend.forecast")}
			</Swatch>
			<Swatch className="size-8 rotate-45 bg-text-default">
				{t("board.roadmap.timeline.legend.target")}
			</Swatch>
			<Swatch className="size-8 rotate-45 bg-feedback-info">
				{t("board.roadmap.timeline.legend.milestone")}
			</Swatch>
			<Swatch className="h-2 w-16 border-t border-dashed border-text-muted">
				{t("board.roadmap.timeline.legend.after")}
			</Swatch>
		</ul>
	);
}

function GraphKpis({ layout }: { layout: GraphLayout }) {
	const t = useT();
	const finish = layout.nodes.length > 0 ? Math.max(...layout.nodes.map((node) => node.end)) : null;
	return (
		<ul className="flex min-w-0 flex-wrap items-center gap-8 tr-text-metadata">
			{finish !== null ? (
				<li data-testid="board-graph-finish" className="text-text-muted">
					{t("board.roadmap.graph.finish", { date: shortDay(t, finish) })}
				</li>
			) : null}
			{layout.milestones.map((milestone) => (
				<li
					key={milestone.id}
					data-testid="board-graph-kpi"
					data-milestone-id={milestone.id}
					data-late={milestone.late || undefined}
					className={cn(
						"flex items-center gap-4 rounded-full px-8",
						milestone.late
							? "bg-feedback-error-subtle text-feedback-error"
							: "bg-control-bg-selected text-text-default",
					)}
				>
					<span aria-hidden className="size-6 rotate-45 bg-current" />
					{t("board.roadmap.graph.kpi", {
						title: milestone.title,
						date: shortDay(t, milestone.end),
					})}
				</li>
			))}
			{layout.criticalPath.length > 0 ? (
				<li data-testid="board-graph-critical" className="min-w-0 truncate text-feedback-warning">
					{t("board.roadmap.graph.criticalPath", { ids: layout.criticalPath.join(" → ") })}
				</li>
			) : null}
		</ul>
	);
}

function Empty({ testId, children }: { testId: string; children: ReactNode }) {
	return (
		<div
			data-testid={testId}
			className="flex flex-1 items-center justify-center p-16 text-center tr-text-ui text-text-muted"
		>
			{children}
		</div>
	);
}

/**
 * The Roadmap view's step graph and timeline, `@xyflow/react` in their own lazy chunk: the toolbar (the
 * graph's initiative scope, the day / week scale, the milestones' forecast dates), the flow, the status
 * line an edit reports to and the legend.
 */
export default function RoadmapFlow({
	host,
	view,
	board,
	kind,
	layout,
	onError,
	onReload,
}: {
	host: PanelHost;
	view: RoadmapView;
	board: BoardView | null;
	kind: RoadmapFlowKind;
	layout: BoardLayout;
	onError: (error: unknown) => void;
	onReload: () => void;
}) {
	const t = useT();
	const id = useId();
	const [scale, setScale] = useState<GraphScale>("days");
	const [scope, setScope] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [said, setSaid] = useState<{ kind: RoadmapFlowKind; notice: GraphNotice } | null>(null);
	useEffect(() => {
		if (!said) return;
		const timer = setTimeout(() => setSaid(null), 5000);
		return () => clearTimeout(timer);
	}, [said]);
	const notice = said?.kind === kind ? said.notice : null;
	const px = SCALE_PX[scale];
	const shownScope =
		scope !== null && view.initiatives.some((initiative) => initiative.id === scope) ? scope : null;
	const graph = kind === "graph" ? stepGraphLayout(view, board, shownScope, px) : null;
	const timeline = kind === "timeline" ? timelineLayout(view, px, expanded) : null;
	const write = (run: () => Promise<GraphNotice | null>) => {
		run().then(
			(next) => {
				if (next) setSaid({ kind, notice: next });
				onReload();
			},
			(error: unknown) => {
				onError(error);
				onReload();
			},
		);
	};
	const toggle = (initiativeId: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(initiativeId)) next.delete(initiativeId);
			else next.add(initiativeId);
			return next;
		});
	return (
		<div data-testid="board-roadmap-flow" data-kind={kind} className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-8 border-border-muted border-b px-8 py-4">
				{kind === "graph" ? (
					<label htmlFor={`${id}-scope`} className="flex items-center gap-4">
						<span className="tr-text-metadata text-text-muted">
							{t("board.roadmap.graph.scope")}
						</span>
						<select
							id={`${id}-scope`}
							data-testid="board-graph-scope"
							value={shownScope ?? ""}
							onChange={(event) => setScope(event.currentTarget.value || null)}
							className={FIELD}
						>
							<option value="">{t("board.roadmap.graph.scopeAll")}</option>
							{view.initiatives.map((initiative) => (
								<option key={initiative.id} value={initiative.id}>
									{t("board.roadmap.card.option", {
										indent: "\u2002".repeat(initiative.depth),
										id: initiative.id,
										title: initiative.title,
									})}
								</option>
							))}
						</select>
					</label>
				) : null}
				<fieldset
					className="flex items-center gap-2"
					aria-label={t("board.roadmap.graph.scaleLabel")}
				>
					{GRAPH_SCALES.map((option) => (
						<ToggleSegment
							key={option}
							testid={`board-graph-scale-${option}`}
							label={t(SCALE_LABELS[option])}
							active={scale === option}
							onClick={() => setScale(option)}
						/>
					))}
				</fieldset>
				{graph ? <GraphKpis layout={graph} /> : null}
				{timeline && view.insufficientData.throughput ? (
					<span
						data-testid="board-timeline-insufficient"
						className="tr-text-metadata text-text-subtle"
					>
						{t("board.roadmap.timeline.insufficient")}
					</span>
				) : null}
			</div>
			<div className="relative flex min-h-0 flex-1 flex-col">
				<div
					role="status"
					className="pointer-events-none absolute top-8 left-1/2 z-10 -translate-x-1/2"
				>
					{notice ? (
						<span
							data-testid="board-graph-notice"
							data-tone={notice.tone}
							className={cn(
								"block rounded-sm border bg-container-elevated-bg px-12 py-4 tr-text-metadata shadow-lg",
								notice.tone === "error"
									? "border-feedback-error text-feedback-error"
									: "border-primary text-text-default",
							)}
						>
							{t(notice.key, notice.values)}
						</span>
					) : null}
				</div>
				{graph ? (
					!board ? (
						<LoadingRegion
							rows={6}
							label={t("board.loading")}
							testId="board-graph-loading"
							className="min-h-0 flex-1 overflow-hidden p-8"
						/>
					) : graph.nodes.length === 0 ? (
						<Empty testId="board-graph-empty">{t("board.roadmap.graph.empty")}</Empty>
					) : (
						<StepGraph
							host={host}
							view={view}
							board={board}
							layout={graph}
							compact={layout === "stacked"}
							onWrite={write}
						/>
					)
				) : timeline ? (
					timeline.rows.length === 0 ? (
						<Empty testId="board-timeline-empty">{t("board.roadmap.timeline.empty")}</Empty>
					) : (
						<TimelineGraph host={host} view={view} layout={timeline} onToggle={toggle} />
					)
				) : null}
			</div>
			{kind === "graph" ? <GraphLegend /> : <TimelineLegend />}
		</div>
	);
}
