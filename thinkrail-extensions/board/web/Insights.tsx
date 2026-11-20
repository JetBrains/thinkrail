import type { PanelHost } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useId, useState } from "react";
import type { BoardLayout } from "./api";
import {
	bandPath,
	chartData,
	FLOW_CATEGORIES,
	type FlowCategory,
	flowBands,
	flowMax,
	INSIGHT_WINDOWS,
	type Insights,
	type InsightWindow,
	linePath,
	loadInsights,
	niceMax,
	scale,
	spread,
	ticks,
	timeSplit,
} from "./insightsApi";
import { CATEGORY_LABELS } from "./labels";
import { useBoardChanged, useHostQuery } from "./useHostQuery";
import { useWidth } from "./useWidth";

const HEIGHT = 160;
const PAD = { left: 32, right: 12, top: 10, bottom: 20 };
const DAY_MS = 24 * 60 * 60 * 1000;

const FLOW_LOOKS: Readonly<Record<FlowCategory, { fill: string; swatch: string }>> = {
	completed: { fill: "fill-series-7", swatch: "bg-series-7" },
	review: { fill: "fill-series-1", swatch: "bg-series-1" },
	started: { fill: "fill-series-3", swatch: "bg-series-3" },
	unstarted: { fill: "fill-ramp-2", swatch: "bg-ramp-2" },
	backlog: { fill: "fill-series-8", swatch: "bg-series-8" },
};

const TIME_LOOKS = {
	agent: { fill: "fill-series-3", swatch: "bg-series-3", label: "board.insights.time.agent" },
	waiting: { fill: "fill-primary", swatch: "bg-primary", label: "board.insights.time.waiting" },
	review: { fill: "fill-series-1", swatch: "bg-series-1", label: "board.insights.time.review" },
} as const;

const dateText = (ms: number) =>
	new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(
		ms,
	);

function Swatch({ className, label }: { className: string; label: string }) {
	return (
		<span className="flex items-center gap-4">
			<span aria-hidden className={cn("size-8 shrink-0 rounded-xs", className)} />
			{label}
		</span>
	);
}

/** One chart: its title, the SVG at the card's measured width (or its empty state) and its legend. */
function ChartCard({
	chart,
	title,
	description,
	empty,
	legend,
	initialWidth,
	children,
}: {
	initialWidth: number;
	chart: string;
	title: string;
	description: string;
	empty: boolean;
	legend?: ReactNode;
	children: (width: number) => ReactNode;
}) {
	const t = useT();
	const id = useId();
	const { width, attach } = useWidth(initialWidth);
	return (
		<section
			data-testid="board-insights-chart"
			data-chart={chart}
			data-empty={empty || undefined}
			aria-labelledby={`${id}-heading`}
			className="flex min-w-0 flex-col gap-4 rounded-sm border border-border-muted bg-container-elevated-bg p-8"
		>
			<h3 id={`${id}-heading`} className="tr-text-emphasis text-text-default">
				{title}
			</h3>
			<div ref={attach} className="min-w-0">
				{empty ? (
					<p
						data-testid="board-insights-empty"
						className="flex h-160 items-center justify-center text-center tr-text-metadata text-text-subtle"
					>
						{t("board.insights.notEnough")}
					</p>
				) : width > 0 ? (
					<svg
						role="img"
						aria-labelledby={`${id}-title ${id}-desc`}
						data-testid="board-insights-svg"
						width={width}
						height={HEIGHT}
						viewBox={`0 0 ${width} ${HEIGHT}`}
						className="block overflow-visible"
					>
						<title id={`${id}-title`}>{title}</title>
						<desc id={`${id}-desc`}>{description}</desc>
						{children(width)}
					</svg>
				) : (
					<div className="h-160" />
				)}
			</div>
			{legend && !empty ? (
				<div className="flex flex-wrap gap-x-12 gap-y-2 tr-text-metadata text-text-muted">
					{legend}
				</div>
			) : null}
		</section>
	);
}

/** The y axis: three gridlines from 0 to `max`, labelled. */
function YAxis({
	width,
	max,
	label,
}: {
	width: number;
	max: number;
	label: (v: number) => string;
}) {
	const y = scale([0, max], [HEIGHT - PAD.bottom, PAD.top]);
	return (
		<g aria-hidden>
			{ticks(max).map((tick) => (
				<g key={tick}>
					<line
						x1={PAD.left}
						x2={width - PAD.right}
						y1={y(tick)}
						y2={y(tick)}
						className="stroke-border-muted"
						strokeWidth={1}
					/>
					<text
						x={PAD.left - 4}
						y={y(tick) + 3}
						textAnchor="end"
						className="fill-text-subtle tr-code-text-small"
					>
						{label(tick)}
					</text>
				</g>
			))}
		</g>
	);
}

/** The x axis's first and last dates, under the plot. */
function DateAxis({ width, from, to }: { width: number; from: number; to: number }) {
	return (
		<g aria-hidden className="fill-text-subtle tr-text-caption">
			<text x={PAD.left} y={HEIGHT - 4}>
				{dateText(from)}
			</text>
			<text x={width - PAD.right} y={HEIGHT - 4} textAnchor="end">
				{dateText(to)}
			</text>
		</g>
	);
}

const count = (value: number) => String(Math.round(value * 10) / 10);

interface ChartProps {
	insights: Insights;
	/** The width drawn before the card is measured (a server render's). */
	initialWidth: number;
}

function xOfTime(insights: Insights, width: number) {
	return scale([insights.from, insights.to], [PAD.left, width - PAD.right]);
}

function WipChart({ insights, initialWidth }: ChartProps) {
	const t = useT();
	const max = niceMax(Math.max(...insights.days.map((day) => day.wip)));
	const now = insights.days.at(-1)?.wip ?? 0;
	const peak = Math.max(0, ...insights.days.map((day) => day.wip));
	return (
		<ChartCard
			initialWidth={initialWidth}
			chart="wip"
			title={t("board.insights.wip.title")}
			description={t("board.insights.wip.desc", { now, peak, weeks: insights.weeks })}
			empty={!chartData(insights).wip}
		>
			{(width) => {
				const x = xOfTime(insights, width);
				const y = scale([0, max], [HEIGHT - PAD.bottom, PAD.top]);
				return (
					<>
						<YAxis width={width} max={max} label={count} />
						<path
							data-testid="board-insights-wip-line"
							d={linePath(
								insights.days.map((day) => ({
									x: x(Math.min(day.day + DAY_MS, insights.to)),
									y: y(day.wip),
								})),
							)}
							fill="none"
							strokeWidth={2}
							strokeLinejoin="round"
							className="stroke-series-1"
						/>
						<DateAxis width={width} from={insights.from} to={insights.to} />
					</>
				);
			}}
		</ChartCard>
	);
}

function ThroughputChart({ insights, initialWidth }: ChartProps) {
	const t = useT();
	const weeks = insights.throughput;
	const max = niceMax(Math.max(...weeks.map((week) => week.cards)));
	const total = weeks.reduce((sum, week) => sum + week.cards, 0);
	return (
		<ChartCard
			initialWidth={initialWidth}
			chart="throughput"
			title={t("board.insights.throughput.title")}
			description={t("board.insights.throughput.desc", { total, weeks: weeks.length })}
			empty={!chartData(insights).throughput}
			legend={
				<>
					<Swatch className="bg-series-7" label={t("board.insights.throughput.done")} />
					<Swatch
						className="border border-dashed border-series-7"
						label={t("board.insights.throughput.partial")}
					/>
				</>
			}
		>
			{(width) => {
				const slot = (width - PAD.left - PAD.right) / Math.max(1, weeks.length);
				const y = scale([0, max], [HEIGHT - PAD.bottom, PAD.top]);
				return (
					<>
						<YAxis width={width} max={max} label={count} />
						{weeks.map((week, index) => (
							<rect
								key={week.start}
								data-testid="board-insights-bar"
								data-cards={week.cards}
								data-partial={week.partial || undefined}
								x={PAD.left + index * slot + slot * 0.15}
								y={y(week.cards)}
								width={slot * 0.7}
								height={Math.max(0, HEIGHT - PAD.bottom - y(week.cards))}
								strokeWidth={1}
								strokeDasharray={week.partial ? "3 2" : undefined}
								className={week.partial ? "fill-none stroke-series-7" : "fill-series-7"}
							>
								<title>
									{t("board.insights.throughput.bar", {
										date: dateText(week.start),
										count: week.cards,
									})}
								</title>
							</rect>
						))}
						<DateAxis width={width} from={insights.from} to={insights.to} />
					</>
				);
			}}
		</ChartCard>
	);
}

/** A dashed horizontal line across the plot with its label at the right end. */
function LevelLine({
	width,
	y,
	label,
	className,
	testId,
}: {
	width: number;
	y: number;
	label: string;
	className: string;
	testId: string;
}) {
	return (
		<g data-testid={testId}>
			<line
				x1={PAD.left}
				x2={width - PAD.right}
				y1={y}
				y2={y}
				strokeWidth={1.5}
				strokeDasharray="4 3"
				className={className}
			/>
			<text
				x={width - PAD.right}
				y={y - 3}
				textAnchor="end"
				className="fill-text-muted tr-code-text-small"
			>
				{label}
			</text>
		</g>
	);
}

function CycleChart({ insights, initialWidth }: ChartProps) {
	const t = useT();
	const { p50, p85 } = insights.cycle;
	const max = niceMax(Math.max(...insights.cycleTimes.map((entry) => entry.days), p85 ?? 0));
	return (
		<ChartCard
			initialWidth={initialWidth}
			chart="cycle"
			title={t("board.insights.cycle.title")}
			description={
				p50 !== null && p85 !== null
					? t("board.insights.cycle.desc", { count: insights.cycleTimes.length, p50, p85 })
					: t("board.insights.cycle.descFew", { count: insights.cycleTimes.length })
			}
			empty={!chartData(insights).cycle}
			legend={
				<>
					<Swatch className="rounded-full bg-series-7" label={t("board.insights.cycle.card")} />
					{p50 !== null ? (
						<Swatch className="bg-series-3" label={t("board.insights.cycle.p50", { days: p50 })} />
					) : null}
					{p85 !== null ? (
						<Swatch className="bg-series-4" label={t("board.insights.cycle.p85", { days: p85 })} />
					) : (
						<span>{t("board.insights.cycle.few")}</span>
					)}
				</>
			}
		>
			{(width) => {
				const x = xOfTime(insights, width);
				const y = scale([0, max], [HEIGHT - PAD.bottom, PAD.top]);
				return (
					<>
						<YAxis
							width={width}
							max={max}
							label={(v) => t("board.insights.days", { days: count(v) })}
						/>
						{p50 !== null ? (
							<LevelLine
								width={width}
								y={y(p50)}
								label={t("board.insights.cycle.p50Short")}
								className="stroke-series-3"
								testId="board-insights-p50"
							/>
						) : null}
						{p85 !== null ? (
							<LevelLine
								width={width}
								y={y(p85)}
								label={t("board.insights.cycle.p85Short")}
								className="stroke-series-4"
								testId="board-insights-p85"
							/>
						) : null}
						{insights.cycleTimes.map((entry) => (
							<circle
								key={entry.cardId}
								data-testid="board-insights-cycle-dot"
								cx={x(entry.completedAt)}
								cy={y(entry.days)}
								r={4}
								className="fill-series-7"
							>
								<title>
									{t("board.insights.cycle.dot", { id: entry.cardId, days: entry.days })}
								</title>
							</circle>
						))}
						<DateAxis width={width} from={insights.from} to={insights.to} />
					</>
				);
			}}
		</ChartCard>
	);
}

function AgingChart({ insights, initialWidth }: ChartProps) {
	const t = useT();
	const { sle } = insights;
	const max = niceMax(Math.max(...insights.aging.map((entry) => entry.days), sle ?? 0));
	const columns = ["started", "review"] as const;
	const over = insights.aging.filter((entry) => sle !== null && entry.days > sle).length;
	return (
		<ChartCard
			initialWidth={initialWidth}
			chart="aging"
			title={t("board.insights.aging.title")}
			description={
				sle !== null
					? t("board.insights.aging.desc", { count: insights.aging.length, sle, over })
					: t("board.insights.aging.descNoSle", { count: insights.aging.length })
			}
			empty={!chartData(insights).aging}
			legend={
				<>
					<Swatch className="rounded-full bg-series-3" label={t(CATEGORY_LABELS.started)} />
					<Swatch className="rounded-full bg-series-1" label={t(CATEGORY_LABELS.review)} />
					<Swatch
						className="rounded-full bg-feedback-warning"
						label={t("board.insights.aging.over")}
					/>
					{sle !== null ? (
						<Swatch className="bg-series-4" label={t("board.insights.aging.sle", { days: sle })} />
					) : (
						<span>{t("board.insights.aging.noSle")}</span>
					)}
				</>
			}
		>
			{(width) => {
				const y = scale([0, max], [HEIGHT - PAD.bottom, PAD.top]);
				const band = (width - PAD.left - PAD.right) / columns.length;
				return (
					<>
						<YAxis
							width={width}
							max={max}
							label={(v) => t("board.insights.days", { days: count(v) })}
						/>
						{sle !== null ? (
							<LevelLine
								width={width}
								y={y(sle)}
								label={t("board.insights.aging.sleShort")}
								className="stroke-series-4"
								testId="board-insights-sle"
							/>
						) : null}
						{columns.map((column, columnIndex) => {
							const entries = insights.aging.filter((entry) => entry.category === column);
							const center = PAD.left + band * columnIndex + band / 2;
							return (
								<g key={column}>
									<text
										x={center}
										y={HEIGHT - 4}
										textAnchor="middle"
										className="fill-text-subtle tr-text-caption"
									>
										{t(CATEGORY_LABELS[column])}
									</text>
									{entries.map((entry, index) => (
										<circle
											key={entry.cardId}
											data-testid="board-insights-age-dot"
											data-over={(sle !== null && entry.days > sle) || undefined}
											cx={center + spread(index, entries.length, band * 0.5)}
											cy={y(entry.days)}
											r={4}
											className={
												sle !== null && entry.days > sle
													? "fill-feedback-warning"
													: column === "started"
														? "fill-series-3"
														: "fill-series-1"
											}
										>
											<title>
												{t("board.insights.aging.dot", { id: entry.cardId, days: entry.days })}
											</title>
										</circle>
									))}
								</g>
							);
						})}
					</>
				);
			}}
		</ChartCard>
	);
}

function FlowChart({ insights, initialWidth }: ChartProps) {
	const t = useT();
	const max = niceMax(flowMax(insights.days));
	const last = insights.days.at(-1)?.flow;
	return (
		<ChartCard
			initialWidth={initialWidth}
			chart="flow"
			title={t("board.insights.flow.title")}
			description={t("board.insights.flow.desc", {
				done: last?.completed ?? 0,
				review: last?.review ?? 0,
				started: last?.started ?? 0,
			})}
			empty={!chartData(insights).flow}
			legend={FLOW_CATEGORIES.map((category) => (
				<Swatch
					key={category}
					className={FLOW_LOOKS[category].swatch}
					label={t(CATEGORY_LABELS[category])}
				/>
			))}
		>
			{(width) => {
				const x = xOfTime(insights, width);
				const y = scale([0, max], [HEIGHT - PAD.bottom, PAD.top]);
				const xs = insights.days.map((day) => x(Math.min(day.day + DAY_MS, insights.to)));
				return (
					<>
						<YAxis width={width} max={max} label={count} />
						{flowBands(insights.days).map((band) => (
							<path
								key={band.category}
								data-testid="board-insights-flow-band"
								data-category={band.category}
								d={bandPath(xs, band.upper.map(y), band.lower.map(y))}
								className={FLOW_LOOKS[band.category].fill}
							/>
						))}
						<DateAxis width={width} from={insights.from} to={insights.to} />
					</>
				);
			}}
		</ChartCard>
	);
}

function TimeChart({ insights, initialWidth }: ChartProps) {
	const t = useT();
	const split = timeSplit(insights.time);
	const [agent, waiting, review] = split;
	return (
		<ChartCard
			initialWidth={initialWidth}
			chart="time"
			title={t("board.insights.time.title")}
			description={t("board.insights.time.desc", {
				agent: agent?.percent ?? 0,
				waiting: waiting?.percent ?? 0,
				review: review?.percent ?? 0,
			})}
			empty={!chartData(insights).time}
			legend={
				<>
					{split.map((entry) => (
						<Swatch
							key={entry.key}
							className={TIME_LOOKS[entry.key].swatch}
							label={t("board.insights.time.share", {
								label: t(TIME_LOOKS[entry.key].label),
								hours: entry.hours,
								percent: entry.percent,
							})}
						/>
					))}
					<span className="basis-full text-text-subtle">{t("board.insights.time.hint")}</span>
				</>
			}
		>
			{(width) => {
				const x = scale([0, 100], [PAD.left, width - PAD.right]);
				return split.map((entry) =>
					entry.percent > 0 ? (
						<rect
							key={entry.key}
							data-testid="board-insights-time-segment"
							data-key={entry.key}
							x={x(entry.start)}
							y={HEIGHT / 2 - 16}
							width={Math.max(0, x(entry.start + entry.percent) - x(entry.start))}
							height={32}
							className={TIME_LOOKS[entry.key].fill}
						>
							<title>
								{t("board.insights.time.share", {
									label: t(TIME_LOOKS[entry.key].label),
									hours: entry.hours,
									percent: entry.percent,
								})}
							</title>
						</rect>
					) : null,
				);
			}}
		</ChartCard>
	);
}

/** The six charts over one `insights.get` answer, two columns when the pane is wide. */
export function InsightsCharts({
	insights,
	layout,
	initialWidth = 0,
}: {
	insights: Insights;
	layout: BoardLayout;
	initialWidth?: number;
}) {
	return (
		<div
			data-testid="board-insights-charts"
			className={cn(
				"grid min-h-0 flex-1 content-start gap-8 overflow-auto p-8",
				layout === "columns" ? "grid-cols-2" : "grid-cols-1",
			)}
		>
			<WipChart insights={insights} initialWidth={initialWidth} />
			<ThroughputChart insights={insights} initialWidth={initialWidth} />
			<CycleChart insights={insights} initialWidth={initialWidth} />
			<AgingChart insights={insights} initialWidth={initialWidth} />
			<FlowChart insights={insights} initialWidth={initialWidth} />
			<TimeChart insights={insights} initialWidth={initialWidth} />
		</div>
	);
}

function windowLabel(t: Translator, weeks: InsightWindow): string {
	return t("board.insights.weeks", { count: weeks });
}

/**
 * Board view's Insights: the board's flow from its transition log (`insights.get`), re-read on
 * `board.changed` — WIP, throughput, cycle time, work item age, cumulative flow and where time goes.
 */
export function InsightsPane({
	host,
	projectId,
	layout,
}: {
	host: PanelHost;
	projectId: string;
	layout: BoardLayout;
}) {
	const t = useT();
	const [weeks, setWeeks] = useState<InsightWindow>(12);
	const insights = useHostQuery(`insights:${projectId}:${weeks}`, (signal) =>
		loadInsights(host, projectId, weeks, signal),
	);
	useBoardChanged(host, projectId, insights.reload);
	return (
		<div data-testid="board-insights" className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-4 border-border-muted border-b px-8 py-2">
				{INSIGHT_WINDOWS.map((window) => (
					<ToggleSegment
						key={window}
						testid={`board-insights-weeks-${window}`}
						label={windowLabel(t, window)}
						active={weeks === window}
						onClick={() => setWeeks(window)}
					/>
				))}
			</div>
			{insights.state.kind === "loading" ? (
				<LoadingRegion
					rows={6}
					label={t("board.loading")}
					testId="board-insights-loading"
					className="min-h-0 flex-1 overflow-hidden p-8"
				/>
			) : insights.state.kind === "error" ? (
				<div
					data-testid="board-insights-error"
					className="flex flex-1 flex-col items-center justify-center gap-8 p-16 text-center"
				>
					<span className="tr-text-ui text-text-muted">{t("board.insights.loadError")}</span>
					<span className="tr-text-metadata text-text-subtle wrap-anywhere">
						{insights.state.message}
					</span>
					<Button variant="outline" size="m" onClick={insights.reload}>
						{t("board.retry")}
					</Button>
				</div>
			) : (
				<InsightsCharts insights={insights.state.value} layout={layout} />
			)}
		</div>
	);
}
