import {
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiBookOpenLine,
	RiErrorWarningLine,
	RiHourglassLine,
	RiListCheck2,
	RiRobot2Line,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	MetricId,
	SessionAnalysis,
	SessionOverview,
	SessionTimeline,
	TraceGap,
	TurnBadges,
	TurnSummary,
} from "@thinkrail/pi-session-insights/core";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { isBadged } from "../copy";
import { DetailsSplit } from "../DetailsSplit";
import { DetailsPanel } from "../details/DetailsPanel";
import { FigureBadge, FigureDetails, type FigureView, type Sources } from "../FigureCell";
import {
	formatClock,
	formatCost,
	formatCostExact,
	formatCount,
	formatDay,
	formatDuration,
	formatSpan,
	formatTokens,
} from "../format";
import { Legend } from "../trace/Legend";
import { useCanvasLook } from "../trace/look";
import type { TraceModel } from "../trace/model";
import type { Palette } from "../trace/palette";
import { StripCanvas } from "../trace/StripCanvas";
import { eventIcon, eventTitle, eventTone, TRIGGER_ICON } from "../trace/TraceTree";
import { keepTurn, locateInTurn, type TurnFilter, type TurnStep, turnSteps } from "./steps";
import { drawActivity, drawPlace, turnScale } from "./strip";

/** Steps an open card lists before *Show N more*, so a huge turn keeps the DOM bounded. */
const STEP_PAGE = 40;
/** Tool chips per step before "+N". */
const CHIPS = 12;

const TRIGGER_LABEL = {
	background: "sessionInsights.turns.trigger.background",
	subagent: "sessionInsights.turns.trigger.subagent",
} as const;

function count(figure: { value: number | null }): number {
	return figure.value ?? 0;
}

/** Tokens where the turn's recorded cost is $0, else cost. */
function spendText(t: Translator, locale: string, turn: TurnSummary): string {
	const tokens = turn.tokens.value?.total ?? 0;
	if (turn.cost.origin === "notRecorded" || turn.cost.value === null)
		return t("sessionInsights.turns.tokens", { tokens: formatTokens(locale, tokens) });
	return formatCost(locale, turn.cost.value);
}

function turnFigures(t: Translator, locale: string, turn: TurnSummary): FigureView[] {
	const exactCount = (metric: MetricId, value: number | null): FigureView => ({
		metric,
		origin: "counted",
		exact: value === null ? null : formatCount(locale, value),
	});
	const tokens = turn.tokens.value;
	return [
		{
			metric: "turnDuration",
			origin: turn.duration.origin,
			exact: turn.duration.value === null ? null : formatDuration(t, turn.duration.value, true),
		},
		{
			metric: "userWait",
			origin: turn.userWait.origin,
			exact: turn.userWait.value === null ? null : formatDuration(t, turn.userWait.value, true),
		},
		exactCount("llmCalls", turn.llmCalls.value),
		exactCount("toolCalls", turn.toolCalls.value),
		exactCount("errors", turn.errors.value),
		{
			metric: "tokens",
			origin: turn.tokens.origin,
			exact: tokens === null ? null : formatCount(locale, tokens.total),
			detail:
				tokens === null
					? undefined
					: t("sessionInsights.figure.tokenBreakdown", {
							input: formatCount(locale, tokens.input),
							output: formatCount(locale, tokens.output),
							cacheRead: formatCount(locale, tokens.cacheRead),
							cacheWrite: formatCount(locale, tokens.cacheWrite),
						}),
		},
		{
			metric: "cost",
			origin: turn.cost.origin,
			exact: turn.cost.value === null ? null : formatCostExact(locale, turn.cost.value),
		},
		exactCount("subagents", turn.subagents.value),
	];
}

function StepRow({
	model,
	step,
	selected,
	scale,
	palette,
	onSelect,
}: {
	model: TraceModel;
	step: TurnStep;
	selected: number;
	scale: ReturnType<typeof turnScale>;
	palette: Palette | null;
	onSelect: (index: number) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const event = model.at(step.index);
	if (!event) return null;
	const Icon = eventIcon(event);
	const last = step.tools.reduce((end, at) => Math.max(end, model.at(at)?.t1 ?? end), event.t1);
	const failed = step.tools.some((at) => model.at(at)?.error) || event.error === true;
	const duration = last > event.t0 ? last - event.t0 : null;
	const shown = step.tools.slice(0, CHIPS);
	return (
		<li
			data-testid="turn-step"
			data-event-id={event.id}
			className="flex min-w-0 flex-col gap-2 border-border-muted border-t py-4"
		>
			<div className="flex min-w-0 items-center gap-8">
				<button
					type="button"
					data-testid="turn-step-select"
					aria-pressed={selected === step.index}
					onClick={() => onSelect(step.index)}
					className={cn(
						"flex min-w-0 flex-1 items-center gap-4 rounded-sm px-4 text-left tr-text-metadata focus-visible:focus-ring",
						selected === step.index ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
					)}
				>
					<Icon aria-hidden className={cn("size-14 shrink-0", eventTone(event))} />
					<span className="shrink-0 text-text-default">{eventTitle(t, event)}</span>
					{event.label ? (
						<span className="min-w-0 truncate text-text-muted">{event.label}</span>
					) : null}
					{failed ? (
						<RiErrorWarningLine aria-hidden className="size-12 shrink-0 text-feedback-error" />
					) : null}
				</button>
				<StripCanvas
					className="h-12 w-160 shrink-0"
					draw={
						palette
							? (context, width, height) =>
									drawPlace(
										context,
										width,
										height,
										scale,
										{ t0: event.t0, t1: last, error: failed },
										palette,
									)
							: null
					}
				/>
				<span className="w-64 shrink-0 text-right tr-text-caption text-text-subtle tabular-nums">
					{duration === null ? "" : formatSpan(t, locale, duration)}
				</span>
			</div>
			{shown.length > 0 ? (
				<div className="flex min-w-0 flex-wrap items-center gap-4 pl-24">
					{shown.map((at) => {
						const tool = model.at(at);
						if (tool?.kind !== "tool") return null;
						const ToolIcon = eventIcon(tool);
						return (
							<button
								key={tool.id}
								type="button"
								data-testid="turn-step-tool"
								data-event-id={tool.id}
								aria-pressed={selected === at}
								title={tool.label || tool.tool}
								onClick={() => onSelect(at)}
								className={cn(
									"inline-flex max-w-240 items-center gap-4 rounded-sm border px-4 tr-code-text-small focus-visible:focus-ring",
									tool.error
										? "border-feedback-error-muted text-feedback-error"
										: "border-border-default text-text-muted",
									selected === at
										? "bg-control-bg-selected text-text-default"
										: "hover:bg-control-bg-hovered",
								)}
							>
								<ToolIcon aria-hidden className={cn("size-12 shrink-0", eventTone(tool))} />
								<span className="truncate">{tool.head ?? tool.tool}</span>
							</button>
						);
					})}
					{step.tools.length > shown.length ? (
						<span className="tr-text-caption text-text-subtle">
							{t("sessionInsights.turns.moreTools", {
								n: formatCount(locale, step.tools.length - shown.length),
							})}
						</span>
					) : null}
				</div>
			) : null}
		</li>
	);
}

export function TurnCard({
	model,
	index,
	turn,
	gaps,
	sources,
	expanded,
	selected,
	palette,
	badges,
	onToggle,
	onSelect,
}: {
	model: TraceModel;
	index: number;
	turn: TurnSummary;
	gaps: readonly TraceGap[];
	sources: Sources;
	expanded: boolean;
	selected: number;
	palette: Palette | null;
	badges?: TurnBadges | undefined;
	onToggle: () => void;
	onSelect: (index: number) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const event = model.at(index);
	const [limit, setLimit] = useState(STEP_PAGE);
	const scale = useMemo(() => turnScale(turn.t0, turn.t1, gaps), [gaps, turn.t0, turn.t1]);
	const steps = useMemo(() => (expanded ? turnSteps(model, index) : []), [expanded, index, model]);
	if (event?.kind !== "turn") return null;
	const Chevron = expanded ? RiArrowDownSLine : RiArrowRightSLine;
	const TriggerIcon = TRIGGER_ICON[turn.trigger];
	const errors = count(turn.errors);
	const subagents = count(turn.subagents);
	const waited = count(turn.userWait);
	const located = locateInTurn(model, selected);
	const holdsSelection = located?.turn === index;
	const figures = turnFigures(t, locale, turn);
	const badged = figures.find(
		(figure) => isBadged(figure.origin) && figure.metric === "turnDuration",
	);
	return (
		<section
			data-testid="turn-card"
			data-turn={turn.n}
			data-event-id={turn.id}
			data-trigger={turn.trigger}
			data-expanded={expanded ? "true" : undefined}
			data-selected={holdsSelection ? "true" : undefined}
			aria-label={t("sessionInsights.turns.cardLabel", { n: turn.n })}
			className={cn(
				"flex min-w-0 flex-col gap-4 rounded-md border px-8 py-6",
				holdsSelection ? "border-primary-muted bg-container-elevated-bg" : "border-border-default",
				errors > 0 && "border-l-2 border-l-feedback-error",
			)}
		>
			<button
				type="button"
				data-testid="turn-card-toggle"
				aria-expanded={expanded}
				aria-pressed={selected === index}
				onClick={() => {
					onToggle();
					onSelect(index);
				}}
				className="flex min-w-0 items-center gap-4 rounded-sm text-left focus-visible:focus-ring"
			>
				<Chevron aria-hidden className="size-14 shrink-0 text-text-muted" />
				<span className="shrink-0 tr-text-emphasis text-primary tabular-nums">
					{t("sessionInsights.trace.turn", { n: turn.n })}
				</span>
				{turn.trigger !== "prompt" ? (
					<span
						data-testid="turn-trigger"
						className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-border-default px-4 tr-text-caption text-text-muted"
					>
						<TriggerIcon aria-hidden className="size-12" />
						{t(TRIGGER_LABEL[turn.trigger])}
					</span>
				) : null}
				<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">
					{event.label || t("sessionInsights.turns.noPrompt")}
				</span>
				<span className="shrink-0 tr-text-caption text-text-subtle tabular-nums">
					{`${formatDay(locale, turn.t0)} ${formatClock(locale, turn.t0, false)}`}
				</span>
			</button>
			<div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 pl-16">
				<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="start">
					<button
						type="button"
						data-testid="turn-figures"
						className="flex min-w-0 flex-wrap items-center gap-x-8 rounded-sm text-left tr-text-metadata text-text-muted tabular-nums focus-visible:focus-ring"
					>
						<span className="tr-text-emphasis text-text-default">
							{turn.duration.value === null ? "—" : formatDuration(t, turn.duration.value)}
						</span>
						{badged && isBadged(badged.origin) ? <FigureBadge origin={badged.origin} /> : null}
						{waited > 0 ? (
							<span className="inline-flex items-center gap-2 text-primary">
								<RiHourglassLine aria-hidden className="size-12" />
								{t("sessionInsights.turns.waited", { duration: formatDuration(t, waited) })}
							</span>
						) : null}
						<span>
							{t("sessionInsights.turns.llmCalls", {
								count: count(turn.llmCalls),
								n: formatCount(locale, count(turn.llmCalls)),
							})}
						</span>
						<span>
							{t("sessionInsights.turns.toolCalls", {
								count: count(turn.toolCalls),
								n: formatCount(locale, count(turn.toolCalls)),
							})}
						</span>
						<span className={errors > 0 ? "text-feedback-error" : "text-text-subtle"}>
							{t("sessionInsights.turns.errors", { count: errors, n: formatCount(locale, errors) })}
						</span>
						<span>{spendText(t, locale, turn)}</span>
						{turn.cost.origin !== "recorded" && isBadged(turn.cost.origin) ? (
							<FigureBadge origin={turn.cost.origin} />
						) : null}
					</button>
				</IconTooltip>
				<span
					data-testid="turn-badges"
					className="ml-auto flex shrink-0 flex-wrap items-center gap-4"
				>
					{badges && badges.steps > 0 ? (
						<span
							data-testid="turn-plan-badge"
							title={t("sessionInsights.turns.planTitle")}
							className="inline-flex items-center gap-2 rounded-full border border-border-default px-4 tr-text-caption text-series-7"
						>
							<RiListCheck2 aria-hidden className="size-12" />
							{t("sessionInsights.turns.plan", {
								count: badges.steps,
								n: formatCount(locale, badges.steps),
								done: formatCount(locale, badges.done),
							})}
						</span>
					) : null}
					{badges?.skills.map((skill) => (
						<span
							key={skill}
							data-testid="turn-skill-badge"
							title={t("sessionInsights.turns.skillTitle")}
							className="inline-flex max-w-160 items-center gap-2 rounded-full border border-border-default px-4 tr-text-caption text-series-5"
						>
							<RiBookOpenLine aria-hidden className="size-12 shrink-0" />
							<span className="truncate">{skill}</span>
						</span>
					))}
					{subagents > 0 ? (
						<span className="inline-flex items-center gap-2 rounded-full border border-border-default px-4 tr-text-caption text-series-6">
							<RiRobot2Line aria-hidden className="size-12" />
							{t("sessionInsights.turns.subagents", {
								count: subagents,
								n: formatCount(locale, subagents),
							})}
						</span>
					) : null}
				</span>
			</div>
			<StripCanvas
				testId="turn-strip"
				className="ml-16 h-12 w-auto min-w-0"
				draw={
					palette
						? (context, width, height) =>
								drawActivity(
									context,
									width,
									height,
									model,
									{ from: index + 1, to: model.end[index] ?? index + 1 },
									scale,
									palette,
								)
						: null
				}
			/>
			{expanded ? (
				<ol data-testid="turn-steps" className="ml-16 flex min-w-0 flex-col">
					{steps.slice(0, limit).map((step) => (
						<StepRow
							key={step.index}
							model={model}
							step={step}
							selected={selected}
							scale={scale}
							palette={palette}
							onSelect={onSelect}
						/>
					))}
					{steps.length > limit ? (
						<li className="border-border-muted border-t py-4">
							<button
								type="button"
								onClick={() => setLimit(limit + STEP_PAGE)}
								className="rounded-sm px-4 tr-text-metadata text-text-muted hover:text-text-default focus-visible:focus-ring"
							>
								{t("sessionInsights.turns.moreSteps", {
									count: steps.length - limit,
									n: formatCount(locale, steps.length - limit),
								})}
							</button>
						</li>
					) : null}
					{steps.length === 0 ? (
						<li className="py-4 tr-text-metadata text-text-subtle">
							{t("sessionInsights.turns.noSteps")}
						</li>
					) : null}
				</ol>
			) : null}
		</section>
	);
}

/**
 * The turn cards: one per turn, prompted or started by a background completion, with its figures and
 * activity strip; a card opens into its steps, and picking one selects it in the shared details.
 */
export function TurnsView({
	host,
	sessionId,
	overview,
	model,
	gaps,
	timeline,
	analysis,
	sources,
	selected,
	onSelect,
	onShowInTrace,
	stacked = false,
	toolbarStart,
}: {
	host: PanelHost;
	sessionId: string;
	overview: SessionOverview | null;
	model: TraceModel;
	gaps: readonly TraceGap[];
	timeline: SessionTimeline;
	analysis: SessionAnalysis | null;
	sources: Sources;
	selected: number;
	onSelect: (index: number) => void;
	onShowInTrace: (index: number) => void;
	/** The panel is narrow: the call details stack under the view. */
	stacked?: boolean;
	/** Leads the toolbar (the trace's view modes). */
	toolbarStart?: ReactNode;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const { palette } = useCanvasLook(root);
	const [filter, setFilter] = useState<TurnFilter>("all");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
		const located = locateInTurn(model, selected);
		const id = located ? model.at(located.turn)?.id : (timeline.turns[0]?.id ?? undefined);
		return new Set(id ? [id] : []);
	});
	const tabsRef = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const turns = timeline.turns.filter((turn) => keepTurn(turn, filter));
	const badges = new Map((analysis?.turns ?? []).map((badge) => [badge.turnId, badge]));
	const withErrors = timeline.turns.filter((turn) => keepTurn(turn, "errors")).length;
	const withSubagents = timeline.turns.filter((turn) => keepTurn(turn, "subagents")).length;
	useEffect(() => {
		list.current
			?.querySelector('[data-testid="turn-card"][data-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, []);
	const toggle = (id: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const select = (index: number) => {
		const located = locateInTurn(model, index);
		const id = located ? model.at(located.turn)?.id : undefined;
		if (id && !expanded.has(id) && located?.step !== null) toggle(id);
		onSelect(index);
	};
	return (
		<div ref={setRoot} data-testid="turns-view" className="h-full min-h-0">
			<DetailsSplit
				stacked={stacked}
				view={
					<div className="flex h-full min-h-0 flex-col">
						<div
							role="toolbar"
							aria-label={t("sessionInsights.turns.toolbar")}
							className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-b px-12 py-4"
						>
							{toolbarStart}
							<fieldset
								aria-label={t("sessionInsights.turns.filter")}
								className="flex min-w-0 items-center gap-4"
							>
								<ToggleSegment
									testid="turns-filter-all"
									label={t("sessionInsights.turns.filterAll", {
										count: timeline.turns.length,
										n: formatCount(locale, timeline.turns.length),
									})}
									active={filter === "all"}
									onClick={() => setFilter("all")}
								/>
								<ToggleSegment
									testid="turns-filter-errors"
									label={t("sessionInsights.turns.filterErrors", {
										count: withErrors,
										n: formatCount(locale, withErrors),
									})}
									active={filter === "errors"}
									onClick={() => setFilter(filter === "errors" ? "all" : "errors")}
								/>
								<ToggleSegment
									testid="turns-filter-subagents"
									label={t("sessionInsights.turns.filterSubagents", {
										count: withSubagents,
										n: formatCount(locale, withSubagents),
									})}
									active={filter === "subagents"}
									onClick={() => setFilter(filter === "subagents" ? "all" : "subagents")}
								/>
							</fieldset>
						</div>
						<div
							ref={list}
							data-testid="turn-cards"
							className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-12"
						>
							{turns.length === 0 ? (
								<p className="p-16 text-center tr-text-ui text-text-muted">
									{t("sessionInsights.turns.empty")}
								</p>
							) : (
								turns.map((turn) => {
									const index = model.indexOf(turn.id);
									if (index < 0) return null;
									return (
										<TurnCard
											key={turn.id}
											model={model}
											index={index}
											turn={turn}
											gaps={gaps}
											sources={sources}
											expanded={expanded.has(turn.id)}
											selected={selected}
											palette={palette}
											badges={badges.get(turn.id)}
											onToggle={() => toggle(turn.id)}
											onSelect={select}
										/>
									);
								})
							)}
						</div>
						<Legend model={model} testId="turns-legend" />
					</div>
				}
				details={
					<DetailsPanel
						host={host}
						sessionId={sessionId}
						model={model}
						index={selected}
						overview={overview}
						query=""
						onSelect={select}
						onZoom={onShowInTrace}
						tabsRef={tabsRef}
					/>
				}
			/>
		</div>
	);
}
