import { RiLoader4Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { HEALTH_LABELS, HORIZON_LABELS, STACK_LABELS } from "./labels";
import {
	type Health,
	type HealthView,
	type Horizon,
	type Rollup,
	rollupBar,
	STACK_CATEGORIES,
	type StackCategory,
} from "./roadmapApi";

/** Each stacked category's fill (the bar) and swatch (its legend). */
const STACK_LOOKS: Readonly<Record<StackCategory, { fill: string; swatch: string }>> = {
	completed: { fill: "fill-feedback-success", swatch: "bg-feedback-success" },
	review: { fill: "fill-feedback-info", swatch: "bg-feedback-info" },
	started: { fill: "fill-series-3", swatch: "bg-series-3" },
	unstarted: { fill: "fill-text-muted", swatch: "bg-text-muted" },
	backlog: { fill: "fill-text-subtle", swatch: "bg-text-subtle" },
};

const HEALTH_LOOKS: Readonly<Record<Health, string>> = {
	on_track: "bg-feedback-success-subtle text-feedback-success",
	at_risk: "bg-feedback-warning-subtle text-feedback-warning",
	off_track: "bg-feedback-error-subtle text-feedback-error",
};

const HORIZON_LOOKS: Readonly<Record<Horizon, string>> = {
	now: "bg-primary-subtle text-primary",
	next: "bg-feedback-info-subtle text-feedback-info",
	later: "bg-control-bg-selected text-text-muted",
};

/** *Closed* on an initiative a human confirmed done, with the day in its tooltip; nothing otherwise. */
export function ClosedChip({ initiative }: { initiative: { closedAt?: number } }) {
	const t = useT();
	if (initiative.closedAt === undefined) return null;
	return (
		<span
			data-testid="board-initiative-closed"
			title={t("board.roadmap.closedOn", {
				date: new Date(initiative.closedAt).toLocaleDateString(),
			})}
			className="rounded-full bg-feedback-success-subtle px-8 tr-text-label-pill text-feedback-success"
		>
			{t("board.roadmap.closed")}
		</span>
	);
}

/** The rollup's cards by category as one bar: done, review, started, ready, backlog. */
export function StackBar({
	rollup,
	className,
}: {
	rollup: Rollup | undefined;
	className?: string;
}) {
	const t = useT();
	const bar = rollupBar(rollup);
	return (
		<svg
			role="img"
			aria-label={t("board.roadmap.progress.label", {
				done: bar.done,
				total: bar.total,
				percent: bar.percent,
			})}
			data-testid="board-roadmap-stack"
			viewBox="0 0 100 4"
			preserveAspectRatio="none"
			className={cn("h-4 w-full shrink-0 overflow-hidden rounded-xs bg-control-bg", className)}
		>
			{bar.segments.map((segment) => (
				<rect
					key={segment.category}
					data-category={segment.category}
					x={segment.start}
					y={0}
					width={segment.width}
					height={4}
					className={STACK_LOOKS[segment.category].fill}
				/>
			))}
		</svg>
	);
}

/** "x/y cards · n %" with the Triage count beside it, or that nothing is broken down yet. */
export function ProgressFigures({ rollup }: { rollup: Rollup | undefined }) {
	const t = useT();
	const bar = rollupBar(rollup);
	return (
		<span
			data-testid="board-roadmap-progress"
			className="flex flex-wrap items-center gap-4 tr-text-metadata tabular-nums text-text-muted"
		>
			{bar.total > 0 ? (
				<span>
					{t("board.roadmap.progress.cards", {
						done: bar.done,
						total: bar.total,
						percent: bar.percent,
					})}
				</span>
			) : (
				<span className="text-text-subtle">{t("board.roadmap.progress.none")}</span>
			)}
			{bar.triage > 0 ? (
				<span data-testid="board-roadmap-triage" className="text-series-3">
					{t("board.roadmap.progress.triage", { count: bar.triage })}
				</span>
			) : null}
		</span>
	);
}

/** The legend under the drawer's bar: each category's count, Triage aside. */
export function ProgressLegend({ rollup }: { rollup: Rollup | undefined }) {
	const t = useT();
	const bar = rollupBar(rollup);
	return (
		<ul
			data-testid="board-roadmap-legend"
			className="flex flex-wrap items-center gap-8 tr-text-metadata tabular-nums text-text-muted"
		>
			{STACK_CATEGORIES.map((category) => (
				<li key={category} data-category={category} className="flex items-center gap-4">
					<span aria-hidden className={cn("size-8 rounded-xs", STACK_LOOKS[category].swatch)} />
					{t(STACK_LABELS[category], { count: rollup?.byCategory[category] ?? 0 })}
				</li>
			))}
			{bar.triage > 0 ? (
				<li className="text-series-3">
					{t("board.roadmap.progress.triage", { count: bar.triage })}
				</li>
			) : null}
		</ul>
	);
}

/** The effective health; a suggestion says so, a human's override does not. */
export function HealthChip({ health }: { health: HealthView | undefined }) {
	const t = useT();
	if (!health) return null;
	const suggested = !health.override;
	return (
		<span
			data-testid="board-roadmap-health"
			data-health={health.effective}
			data-suggested={suggested || undefined}
			className={cn(
				"inline-flex shrink-0 items-center gap-4 rounded-full px-8 tr-text-metadata",
				HEALTH_LOOKS[health.effective],
			)}
		>
			{t(HEALTH_LABELS[health.effective])}
			{suggested ? <span className="italic">{t("board.roadmap.health.suggested")}</span> : null}
		</span>
	);
}

export function HorizonChip({ horizon }: { horizon: Horizon }) {
	const t = useT();
	return (
		<span
			data-testid="board-roadmap-horizon"
			data-horizon={horizon}
			className={cn(
				"inline-flex shrink-0 rounded-full px-8 tr-text-label-pill",
				HORIZON_LOOKS[horizon],
			)}
		>
			{t(HORIZON_LABELS[horizon])}
		</span>
	);
}

/** A dot per active card's agent: spinning while it works, amber waiting for you, red failed. */
export function AgentDots({ rollup }: { rollup: Rollup | undefined }) {
	const t = useT();
	const agents = rollup?.agents;
	if (!agents || agents.working + agents.waiting + agents.failed === 0) return null;
	const dots = (count: number) => Array.from({ length: Math.min(count, 5) }, (_, index) => index);
	return (
		<span
			data-testid="board-roadmap-agents"
			className="flex min-w-0 flex-wrap items-center gap-4 tr-text-metadata text-text-muted"
		>
			<span aria-hidden className="flex items-center gap-2">
				{dots(agents.working).map((index) => (
					<RiLoader4Line
						key={`w${index}`}
						className="size-12 text-primary motion-safe:animate-spin"
					/>
				))}
				{dots(agents.waiting).map((index) => (
					<span key={`q${index}`} className="size-8 rounded-full bg-feedback-warning" />
				))}
				{dots(agents.failed).map((index) => (
					<span key={`f${index}`} className="size-8 rounded-full bg-feedback-error" />
				))}
			</span>
			{agents.working > 0 ? (
				<span>{t("board.roadmap.agents.working", { count: agents.working })}</span>
			) : null}
			{agents.waiting > 0 ? (
				<span className="text-feedback-warning">
					{t("board.roadmap.agents.waiting", { count: agents.waiting })}
				</span>
			) : null}
			{agents.failed > 0 ? (
				<span className="text-feedback-error">
					{t("board.roadmap.agents.failed", { count: agents.failed })}
				</span>
			) : null}
		</span>
	);
}
