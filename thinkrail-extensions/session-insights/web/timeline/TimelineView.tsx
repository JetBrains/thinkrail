import { RiZoomInLine, RiZoomOutLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	ContextLimit,
	SessionAnalysis,
	SessionOverview,
	SessionTimeline,
	TraceGap,
	WaitActor,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { isBadged } from "../copy";
import { DetailsPanel } from "../details/DetailsPanel";
import { FigureBadge, FigureDetails, type Sources } from "../FigureCell";
import {
	formatClock,
	formatCost,
	formatCount,
	formatDateTime,
	formatDay,
	formatDuration,
	formatSpan,
	formatTokens,
} from "../format";
import { keyLabels, PANEL_COMMANDS, PANEL_KEYS, PANEL_SCOPE, plainKey } from "../keys";
import { BandMenu } from "../trace/BandMenu";
import { bandLabel, PLAN_STATUS_LABEL, spendLabel } from "../trace/bandCopy";
import { type BandPick, bandSteps, pickIntervals, samePick } from "../trace/bands";
import { Legend, Swatch } from "../trace/Legend";
import { useCanvasLook } from "../trace/look";
import { isFailure, type TraceModel } from "../trace/model";
import {
	type AxisScale,
	type BrushGrip,
	brushClick,
	brushDrag,
	brushGrip,
	COMPRESS_GAPS_OVER_MS,
	fitView,
	panView,
	StepScale,
	TimeScale,
	type View,
	viewAround,
	viewContaining,
	WHEEL_ZOOM,
	zoomView,
} from "../trace/scale";
import { eventTitle, MARK_TITLE, SERIES_SWATCH } from "../trace/TraceTree";
import {
	type AxisMode,
	OVERVIEW_HEIGHT,
	TimelineEngine,
	type TimelineState,
	type TimelineText,
} from "./engine";
import {
	GUTTER,
	hitTimeline,
	type Lane,
	layoutLanes,
	plotUnit,
	plotWidth,
	plotX,
	type TimelineHit,
	TimelineItems,
	valueAt,
	WAIT_SERIES,
} from "./layout";

const ZOOM_STEP = 0.6;
const TIMELINE_KEYS = [
	PANEL_KEYS.zoomToSelection,
	PANEL_KEYS.zoomIn,
	PANEL_KEYS.zoomOut,
	PANEL_KEYS.zoomFit,
] as const;
const DRAG_PX = 4;

const ACTOR_LABEL = {
	user: "sessionInsights.timeline.actor.user",
	model: "sessionInsights.timeline.actor.model",
	tool: "sessionInsights.timeline.actor.tool",
	subagent: "sessionInsights.timeline.actor.subagent",
	background: "sessionInsights.timeline.actor.background",
	idle: "sessionInsights.timeline.actor.idle",
} as const satisfies Record<WaitActor, string>;

const ACTOR_ORDER: readonly WaitActor[] = [
	"user",
	"model",
	"tool",
	"subagent",
	"background",
	"idle",
];

const GAP_CAUSE_LABEL = {
	user: "sessionInsights.timeline.gap.user",
	background: "sessionInsights.timeline.gap.background",
	idle: "sessionInsights.timeline.gap.idle",
} as const;

const LANE_LABEL = {
	band: "sessionInsights.timeline.lane.band",
	user: "sessionInsights.timeline.lane.user",
	model: "sessionInsights.timeline.lane.model",
	tools: "sessionInsights.timeline.lane.tools",
	subagents: "sessionInsights.timeline.lane.subagents",
	context: "sessionInsights.timeline.lane.context",
	spend: "sessionInsights.timeline.lane.spend",
	skills: "sessionInsights.timeline.lane.skills",
	plan: "sessionInsights.timeline.lane.plan",
} as const;

const LANE_HINT = {
	band: "sessionInsights.timeline.hint.band",
	user: "sessionInsights.timeline.hint.user",
	model: "sessionInsights.timeline.hint.model",
	tools: "sessionInsights.timeline.hint.tools",
	subagents: "sessionInsights.timeline.hint.subagents",
	context: "sessionInsights.timeline.hint.context",
	spend: "sessionInsights.timeline.hint.spend",
	skills: "sessionInsights.timeline.hint.skills",
	plan: "sessionInsights.timeline.hint.plan",
} as const;

const ACTOR_SWATCH = {
	user: SERIES_SWATCH.primary,
	model: SERIES_SWATCH[WAIT_SERIES.model],
	tool: SERIES_SWATCH[WAIT_SERIES.tool],
	subagent: SERIES_SWATCH[WAIT_SERIES.subagent],
	background: SERIES_SWATCH[WAIT_SERIES.background],
	idle: "bg-border-default",
} as const satisfies Record<WaitActor, string>;

interface TimeWindow {
	t0: number;
	t1: number;
}

function spendValue(
	t: Translator,
	locale: string,
	timeline: SessionTimeline,
	cost: number,
	tokens: number,
) {
	return timeline.headline === "tokens"
		? t("sessionInsights.turns.tokens", { tokens: formatTokens(locale, tokens) })
		: formatCost(locale, cost);
}

function limitText(t: Translator, locale: string, limit: ContextLimit): string {
	return limit.origin === "host"
		? t("sessionInsights.timeline.limit", { tokens: formatTokens(locale, limit.value) })
		: t("sessionInsights.timeline.limitObserved", { tokens: formatTokens(locale, limit.value) });
}

/** The tooltip lines of whatever is under the pointer; the first line is the title. */
export function describeHit(
	t: Translator,
	locale: string,
	model: TraceModel,
	timeline: SessionTimeline,
	hit: TimelineHit,
	analysis: SessionAnalysis | null = null,
): string[] {
	const span = (ms: number, approximate: boolean) =>
		`${approximate ? "≈ " : ""}${formatSpan(t, locale, ms)}`;
	switch (hit.kind) {
		case "lane": {
			const step = hit.lane === "plan" ? analysis?.plan?.steps[hit.step] : undefined;
			return step
				? [`${hit.step + 1}. ${step.title}`, t(PLAN_STATUS_LABEL[step.status]), t(LANE_HINT.plan)]
				: [t(LANE_LABEL[hit.lane]), t(LANE_HINT[hit.lane])];
		}
		case "step": {
			const step = analysis?.plan?.steps[hit.step];
			if (!step) return [];
			return [
				bandLabel(t, locale, analysis, { kind: "step", id: step.id }),
				t("sessionInsights.timeline.tip.stepCalls", {
					count: step.toolCalls.value ?? 0,
					calls: formatCount(locale, step.toolCalls.value ?? 0),
					errors: formatCount(locale, step.errors.value ?? 0),
				}),
				...(step.listedOnly ? [t("sessionInsights.timeline.tip.listedOnly")] : []),
				t("sessionInsights.timeline.tip.pick"),
			];
		}
		case "skill":
			return [
				bandLabel(t, locale, analysis, { kind: "skill", index: hit.index }),
				t("sessionInsights.timeline.tip.pick"),
			];
		case "band":
			return [
				t(ACTOR_LABEL[hit.band.actor]),
				t("sessionInsights.timeline.tip.during", {
					duration: formatDuration(t, hit.band.t1 - hit.band.t0, true),
					from: formatClock(locale, hit.band.t0, true),
				}),
				t("sessionInsights.timeline.tip.heuristic"),
			];
		case "pause":
			return [
				t("sessionInsights.timeline.tip.gap", {
					duration: formatDuration(t, hit.stretch.t1 - hit.stretch.t0),
				}),
				t(GAP_CAUSE_LABEL[hit.stretch.cause]),
				`${formatDateTime(locale, hit.stretch.t0)} → ${formatClock(locale, hit.stretch.t1, true)}`,
			];
		case "context": {
			const lines = [
				t("sessionInsights.timeline.tip.context", {
					tokens: formatCount(locale, hit.point.tokens),
				}),
			];
			if (hit.point.miss) lines.push(t("sessionInsights.timeline.tip.miss"));
			const event = model.at(hit.index);
			const limit = timeline.limits.find(
				(candidate) => event?.kind === "llm" && candidate.model === event.model,
			);
			if (limit) lines.push(limitText(t, locale, limit));
			return lines;
		}
		case "spend": {
			const own = valueAt(timeline.spend, hit.t);
			const lines = [
				t("sessionInsights.timeline.tip.spend", { time: formatClock(locale, hit.t, true) }),
				t("sessionInsights.timeline.tip.recorded", {
					value: spendValue(t, locale, timeline, own?.cost ?? 0, own?.tokens ?? 0),
				}),
			];
			if (timeline.withSubagents) {
				const all = valueAt(timeline.withSubagents, hit.t);
				lines.push(
					t("sessionInsights.timeline.tip.withSubagents", {
						value: spendValue(t, locale, timeline, all?.cost ?? 0, all?.tokens ?? 0),
					}),
				);
			}
			return lines;
		}
		case "item": {
			const event = model.at(hit.item.index);
			if (!event) return [];
			const title = eventTitle(t, event);
			const approximate = event.timing === "approximated";
			switch (event.kind) {
				case "turn":
					return [`${title} · ${formatClock(locale, event.t0, true)}`, event.label].filter(Boolean);
				case "llm":
					return [
						`${title} · ${span(event.t1 - event.t0, approximate)}`,
						t("sessionInsights.timeline.tip.tokens", {
							size: formatTokens(
								locale,
								timeline.context.find((point) => point.id === event.id)?.tokens ?? 0,
							),
							output: formatTokens(locale, event.tokens.output),
						}),
						...(event.label ? [event.label] : []),
					];
				case "tool":
					return [
						`${event.family === "ask" ? t("sessionInsights.turns.legend.wait") : title} · ${span(event.t1 - event.t0, approximate)}`,
						...(event.label ? [event.label] : []),
						...(event.error ? [t("sessionInsights.trace.failed")] : []),
					];
				case "subagent":
					return [
						`${title} · ${span(event.t1 - event.t0, approximate)}`,
						...(event.status ? [event.status] : []),
						...(event.label ? [event.label] : []),
					];
				case "mark":
					return [t(MARK_TITLE[event.mark])];
			}
		}
	}
}

/** Who-blocks totals, context windows and spend: the figures beside the canvas, each with its origin. */
function Summary({ timeline, sources }: { timeline: SessionTimeline; sources: Sources }) {
	const t = useT();
	const locale = localeOf(t);
	const { waitsTotal, peak, llmCalls } = timeline;
	const own = timeline.spend.at(-1);
	const all = timeline.withSubagents?.at(-1);
	return (
		<div
			data-testid="timeline-summary"
			className="flex shrink-0 flex-wrap items-center gap-x-16 gap-y-4 border-border-default border-b px-12 py-4 tr-text-caption text-text-muted"
		>
			<IconTooltip
				label={
					<FigureDetails
						figures={[
							{
								metric: "waits",
								origin: waitsTotal.origin,
								exact: waitsTotal.value === null ? null : formatDuration(t, waitsTotal.value, true),
								detail: ACTOR_ORDER.filter((actor) => timeline.waits[actor] > 0)
									.map(
										(actor) =>
											`${t(ACTOR_LABEL[actor])}: ${formatDuration(t, timeline.waits[actor], true)}`,
									)
									.join(" · "),
							},
						]}
						sources={sources}
					/>
				}
				align="start"
			>
				<button
					type="button"
					data-testid="timeline-waits"
					className="flex min-w-0 flex-wrap items-center gap-x-8 rounded-sm text-left tabular-nums focus-visible:focus-ring"
				>
					<span className="text-text-subtle">{t("sessionInsights.timeline.waits")}</span>
					{ACTOR_ORDER.filter((actor) => timeline.waits[actor] > 0).map((actor) => (
						<Swatch key={actor} className={ACTOR_SWATCH[actor]}>
							{`${t(ACTOR_LABEL[actor])} ${formatDuration(t, timeline.waits[actor])}`}
						</Swatch>
					))}
					{isBadged(waitsTotal.origin) ? <FigureBadge origin={waitsTotal.origin} /> : null}
				</button>
			</IconTooltip>
			{timeline.limits.map((limit) => (
				<IconTooltip
					key={limit.model}
					label={
						<FigureDetails
							figures={[
								{
									metric: "contextWindow",
									origin: limit.origin,
									exact: formatCount(locale, limit.value),
									detail: t("sessionInsights.timeline.limitDetail", {
										model: limit.model,
										observed: formatCount(locale, limit.observed),
										host: limit.host === null ? "—" : formatCount(locale, limit.host),
									}),
								},
								{
									metric: "contextTokens",
									origin: peak.origin,
									exact: peak.value === null ? null : formatCount(locale, peak.value),
								},
							]}
							sources={sources}
						/>
					}
					align="start"
				>
					<button
						type="button"
						data-testid="timeline-limit"
						data-origin={limit.origin}
						className="flex min-w-0 items-center gap-4 rounded-sm tabular-nums focus-visible:focus-ring"
					>
						<span className="text-text-subtle">{limit.model.split("/").pop()}</span>
						<span>{limitText(t, locale, limit)}</span>
						{isBadged(limit.origin) ? <FigureBadge origin={limit.origin} /> : null}
					</button>
				</IconTooltip>
			))}
			{own ? (
				<span data-testid="timeline-spend" className="tabular-nums">
					{t("sessionInsights.timeline.spendTotal", {
						value: spendValue(t, locale, timeline, own.cost, own.tokens),
					})}
					{all
						? ` · ${t("sessionInsights.timeline.spendWithSubagents", {
								value: spendValue(t, locale, timeline, all.cost, all.tokens),
							})}`
						: ""}
				</span>
			) : null}
			<span className="ml-auto text-text-subtle">
				{t("sessionInsights.timeline.calls", {
					count: llmCalls.value ?? 0,
					n: llmCalls.value === null ? "—" : formatCount(locale, llmCalls.value),
				})}
			</span>
		</div>
	);
}

/** The compressed pauses' labels, written vertically into their columns over the canvas. */
function GapLabels({
	scale,
	view,
	width,
	height,
}: {
	scale: AxisScale;
	view: View;
	width: number;
	height: number;
}) {
	const t = useT();
	return (
		<>
			{scale.breaks.map((gap) => {
				const x0 = plotX(view, width, gap.u0);
				const x1 = plotX(view, width, gap.u1);
				if (x1 < GUTTER || x0 > width || x1 - x0 < 12) return null;
				const label = `${t(GAP_CAUSE_LABEL[gap.cause])} · ${formatDuration(t, gap.t1 - gap.t0)}`;
				return (
					<text
						key={`${gap.t0}-${gap.t1}`}
						data-testid="timeline-gap-label"
						data-cause={gap.cause}
						transform={`translate(${(x0 + x1) / 2 + 4} ${height - 4}) rotate(-90)`}
						className={cn(
							"tr-text-caption",
							gap.cause === "user" ? "fill-primary" : "fill-text-muted",
						)}
					>
						{label}
					</text>
				);
			})}
		</>
	);
}

/**
 * The actor swimlanes: who blocks the session, your prompts and answers, model calls, packed tool and
 * subagent lanes, the context and spend counters, on one axis with compressed labelled pauses.
 */
export function TimelineView({
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
	/** Leads the toolbar (the trace's view modes). */
	toolbarStart?: ReactNode;
}) {
	const t = useT();
	const locale = localeOf(t);
	const local = useLocalKeys(PANEL_SCOPE, PANEL_COMMANDS);
	const keysHint = t("sessionInsights.timeline.keys", {
		zoomToSelection: keyLabels(local, PANEL_KEYS.zoomToSelection),
		zoom: keyLabels(local, PANEL_KEYS.zoomIn, PANEL_KEYS.zoomOut),
		fit: keyLabels(local, PANEL_KEYS.zoomFit),
	});
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const { palette, font } = useCanvasLook(root);
	const stacked = host.placement === "chatPane";
	const [mode, setMode] = useState<AxisMode>("time");
	const [compress, setCompress] = useState(true);
	const [showPlan, setShowPlan] = useState(true);
	const [pick, setPick] = useState<BandPick | null>(null);
	const [timeWindow, setTimeWindow] = useState<TimeWindow | null>(null);
	const [engine, setEngine] = useState<TimelineEngine | null>(null);
	const [width, setWidth] = useState(0);
	const bodyRef = useRef<HTMLCanvasElement>(null);
	const overlayRef = useRef<HTMLCanvasElement>(null);
	const headerRef = useRef<HTMLCanvasElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);
	const keysRef = useRef<HTMLButtonElement>(null);
	const items = useMemo(() => new TimelineItems(model, timeline), [model, timeline]);
	const steps = bandSteps(analysis);
	const skills = analysis?.skills ?? [];
	const planned = showPlan && (steps.length > 0 || skills.length > 0);
	const layout = useMemo(
		() =>
			layoutLanes(
				timeline.lanes.toolTracks,
				timeline.lanes.subagentTracks,
				planned ? { steps: steps.length, skills: skills.length > 0 } : undefined,
			),
		[
			planned,
			skills.length,
			steps.length,
			timeline.lanes.subagentTracks,
			timeline.lanes.toolTracks,
		],
	);
	const failures = useMemo(
		() =>
			model.events
				.filter((event) => isFailure(event))
				.map((event) => event.t0)
				.sort((a, b) => a - b),
		[model],
	);
	const highlight = useMemo(() => (pick ? pickIntervals(analysis, pick) : null), [analysis, pick]);
	const choosePick = (next: BandPick) => setPick(samePick(pick, next) ? null : next);
	const start = timeline.start ?? 0;
	const end = timeline.end ?? start;
	const scale: AxisScale = useMemo(() => {
		if (mode === "steps")
			return new StepScale(
				model.events.flatMap((event) => (event.kind === "llm" ? [event.t0] : [])),
				start,
				end,
			);
		return new TimeScale(start, end, gaps, compress ? COMPRESS_GAPS_OVER_MS : null);
	}, [compress, end, gaps, mode, model, start]);
	const view: View = timeWindow
		? { u0: scale.toUnit(timeWindow.t0), u1: scale.toUnit(timeWindow.t1) }
		: fitView(scale);
	const setView = (next: View) =>
		setTimeWindow({ t0: scale.toTime(next.u0), t1: scale.toTime(next.u1) });
	const state: TimelineState = useMemo(
		() => ({
			model,
			timeline,
			items,
			layout,
			scale,
			mode,
			view: timeWindow
				? { u0: scale.toUnit(timeWindow.t0), u1: scale.toUnit(timeWindow.t1) }
				: fitView(scale),
			selected,
			analysis,
			pick,
			highlight,
			failures,
		}),
		[
			analysis,
			failures,
			highlight,
			items,
			layout,
			mode,
			model,
			pick,
			scale,
			selected,
			timeWindow,
			timeline,
		],
	);
	const latest = useRef({ state, onSelect, setView, width, choosePick });
	useEffect(() => {
		latest.current = { state, onSelect, setView, width, choosePick };
	});
	const text: TimelineText = useMemo(
		() => ({
			font,
			time: (ms, seconds) => formatClock(locale, ms, seconds),
			date: (ms) => formatDay(locale, ms),
			step: (n) => t("sessionInsights.timeline.step", { n: formatCount(locale, n) }),
			turn: (n) => t("sessionInsights.trace.turn", { n }),
			lane: (lane: Lane): [string, string | null] => {
				const label = t(LANE_LABEL[lane.key]);
				switch (lane.key) {
					case "plan": {
						const step = analysis?.plan?.steps[lane.step];
						return [step ? `${lane.step + 1}. ${step.title}` : label, null];
					}
					case "skills":
						return [label, t("sessionInsights.timeline.heuristicScope")];
					case "tools":
						return [
							label,
							lane.tracks > 1
								? t("sessionInsights.timeline.tracks", { count: lane.tracks, n: lane.tracks })
								: null,
						];
					case "subagents":
						return [
							label,
							lane.tracks > 1
								? t("sessionInsights.timeline.tracks", { count: lane.tracks, n: lane.tracks })
								: null,
						];
					case "spend":
						return [
							t(
								timeline.headline === "tokens"
									? "sessionInsights.timeline.lane.tokens"
									: "sessionInsights.timeline.lane.spend",
							),
							t("sessionInsights.timeline.cumulative"),
						];
					default:
						return [label, null];
				}
			},
			tooltip: (hit) => describeHit(t, locale, model, timeline, hit, analysis),
			stepSpend: (step) => spendLabel(t, locale, step.cost, step.tokens),
			limit: (limit) => limitText(t, locale, limit),
			peak: (tokens) =>
				t("sessionInsights.timeline.peak", { tokens: formatTokens(locale, tokens) }),
			spend: () => {
				const own = timeline.spend.at(-1);
				const all = timeline.withSubagents?.at(-1);
				const value = spendValue(t, locale, timeline, own?.cost ?? 0, own?.tokens ?? 0);
				return all
					? `${t("sessionInsights.timeline.spendTotal", { value })} · ${t("sessionInsights.timeline.spendWithSubagents", { value: spendValue(t, locale, timeline, all.cost, all.tokens) })}`
					: t("sessionInsights.timeline.spendTotal", { value });
			},
			noSubagents: t("sessionInsights.timeline.noSubagents"),
			breakLabel: (t0, t1) =>
				t("sessionInsights.trace.gap", { duration: formatDuration(t, t1 - t0) }),
		}),
		[analysis, font, locale, model, t, timeline],
	);

	useEffect(() => {
		const body = bodyRef.current;
		const overlay = overlayRef.current;
		const header = headerRef.current;
		if (!body || !overlay || !header) return;
		const created = new TimelineEngine(body, overlay, header);
		setEngine(created);
		return () => created.dispose();
	}, []);

	useEffect(() => {
		engine?.setState(state);
	}, [engine, state]);

	useEffect(() => {
		if (engine && palette) engine.setPalette(palette, text);
	}, [engine, palette, text]);

	useEffect(() => {
		const box = boxRef.current;
		if (!box || !engine) return;
		const measure = () => {
			setWidth(box.clientWidth);
			engine.setSize(box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(box);
		return () => observer.disconnect();
	}, [engine]);

	useEffect(() => {
		const overlay = overlayRef.current;
		const header = headerRef.current;
		if (!overlay || !header || !engine) return;
		let drag: { x0: number; view: View; moved: boolean } | null = null;
		let brush: BrushGrip | null = null;
		const local = (event: { clientX: number; clientY: number }, element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			return { x: event.clientX - rect.left, y: event.clientY - rect.top };
		};
		const hitAt = (x: number, y: number) => {
			const { state: current, width: w } = latest.current;
			return hitTimeline({ ...current, width: w }, x, y);
		};
		const onWheel = (event: WheelEvent) => {
			const { state: current, setView: apply, width: w } = latest.current;
			const { x } = local(event, overlay);
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			if (event.ctrlKey || event.metaKey || event.altKey) {
				event.preventDefault();
				apply(
					zoomView(
						current.scale,
						current.view,
						plotUnit(current.view, w, x),
						Math.exp(delta * WHEEL_ZOOM),
					),
				);
			} else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
				event.preventDefault();
				const dx = event.shiftKey ? delta : event.deltaX;
				apply(
					panView(
						current.scale,
						current.view,
						(dx / plotWidth(w)) * (current.view.u1 - current.view.u0),
					),
				);
			}
		};
		const onDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			const { x } = local(event, overlay);
			drag = { x0: x, view: latest.current.state.view, moved: false };
			overlay.setPointerCapture(event.pointerId);
			keysRef.current?.focus({ preventScroll: true });
		};
		const onMove = (event: PointerEvent) => {
			const { x, y } = local(event, overlay);
			const { state: current, setView: apply, width: w } = latest.current;
			if (drag) {
				if (Math.abs(x - drag.x0) > DRAG_PX) drag.moved = true;
				if (drag.moved) {
					const units = ((x - drag.x0) / plotWidth(w)) * (drag.view.u1 - drag.view.u0);
					apply(panView(current.scale, drag.view, -units));
				}
			}
			engine.setHover({ x, y, hit: drag?.moved ? null : hitAt(x, y) });
		};
		const onUp = (event: PointerEvent) => {
			const done = drag;
			drag = null;
			if (overlay.hasPointerCapture(event.pointerId))
				overlay.releasePointerCapture(event.pointerId);
			if (!done || done.moved) return;
			const { x, y } = local(event, overlay);
			const hit = hitAt(x, y);
			if (hit?.kind === "item") latest.current.onSelect(hit.item.index);
			else if (hit?.kind === "context" && hit.index >= 0) latest.current.onSelect(hit.index);
			else if (hit?.kind === "skill")
				latest.current.choosePick({ kind: "skill", index: hit.index });
			else if (hit?.kind === "step" || (hit?.kind === "lane" && hit.lane === "plan")) {
				const step = latest.current.state.analysis?.plan?.steps[hit.step];
				if (step) latest.current.choosePick({ kind: "step", id: step.id });
			}
		};
		const onLeave = () => engine.setHover(null);
		const onDouble = (event: MouseEvent) => {
			const { x, y } = local(event, overlay);
			const hit = hitAt(x, y);
			const { state: current, setView: apply } = latest.current;
			if (hit?.kind === "item") apply(viewAround(current.scale, hit.item.t0, hit.item.t1, 0.6));
			else if (hit?.kind === "pause")
				apply(viewAround(current.scale, hit.stretch.t0, hit.stretch.t1, 0.6));
		};
		const onHeaderWheel = (event: WheelEvent) => {
			event.preventDefault();
			const { state: current, setView: apply, width: w } = latest.current;
			const { x } = local(event, header);
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			apply(
				zoomView(
					current.scale,
					current.view,
					plotUnit(current.view, w, x),
					Math.exp(delta * WHEEL_ZOOM),
				),
			);
		};
		const onHeaderDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			const { x, y } = local(event, header);
			if (y > OVERVIEW_HEIGHT || x < GUTTER) return;
			const { state: current, width: w } = latest.current;
			brush = brushGrip(current.scale, current.view, plotWidth(w), x - GUTTER);
			header.setPointerCapture(event.pointerId);
		};
		const onHeaderMove = (event: PointerEvent) => {
			if (!brush) return;
			const { x } = local(event, header);
			const { state: current, setView: apply, width: w } = latest.current;
			const next = brushDrag(current.scale, current.view, plotWidth(w), brush, x - GUTTER);
			if (next) apply(next);
		};
		const onHeaderUp = (event: PointerEvent) => {
			const done = brush;
			brush = null;
			if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
			if (!done) return;
			const { state: current, setView: apply, width: w } = latest.current;
			const next = brushClick(current.scale, current.view, plotWidth(w), done);
			if (next) apply(next);
		};
		overlay.addEventListener("wheel", onWheel, { passive: false });
		overlay.addEventListener("pointerdown", onDown);
		overlay.addEventListener("pointermove", onMove);
		overlay.addEventListener("pointerup", onUp);
		overlay.addEventListener("pointerleave", onLeave);
		overlay.addEventListener("dblclick", onDouble);
		header.addEventListener("wheel", onHeaderWheel, { passive: false });
		header.addEventListener("pointerdown", onHeaderDown);
		header.addEventListener("pointermove", onHeaderMove);
		header.addEventListener("pointerup", onHeaderUp);
		return () => {
			overlay.removeEventListener("wheel", onWheel);
			overlay.removeEventListener("pointerdown", onDown);
			overlay.removeEventListener("pointermove", onMove);
			overlay.removeEventListener("pointerup", onUp);
			overlay.removeEventListener("pointerleave", onLeave);
			overlay.removeEventListener("dblclick", onDouble);
			header.removeEventListener("wheel", onHeaderWheel);
			header.removeEventListener("pointerdown", onHeaderDown);
			header.removeEventListener("pointermove", onHeaderMove);
			header.removeEventListener("pointerup", onHeaderUp);
		};
	}, [engine]);

	const select = (index: number) => {
		const event = model.at(index);
		if (!event) return;
		onSelect(index);
		setView(viewContaining(scale, view, event.t0));
	};
	const zoom = (factor: number | "fit") => {
		if (factor === "fit") setTimeWindow(null);
		else setView(zoomView(scale, view, (view.u0 + view.u1) / 2, factor));
	};
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const commands: Record<string, () => void> = {
			[PANEL_KEYS.zoomIn]: () => zoom(ZOOM_STEP),
			[PANEL_KEYS.zoomOut]: () => zoom(1 / ZOOM_STEP),
			[PANEL_KEYS.zoomFit]: () => zoom("fit"),
			[PANEL_KEYS.zoomToSelection]: () => {
				const item = items.byIndex.get(selected);
				if (item) setView(viewAround(scale, item.t0, item.t1, 0.6));
			},
		};
		const navigation: Record<string, () => void> = {
			ArrowRight: () => {
				const next = items.step(selected, 1);
				if (next !== null) select(next);
			},
			ArrowLeft: () => {
				const next = items.step(selected, -1);
				if (next !== null) select(next);
			},
			Home: () => {
				const first = items.ordered[0];
				if (first !== undefined) select(first);
			},
			End: () => {
				const last = items.ordered.at(-1);
				if (last !== undefined) select(last);
			},
			Enter: () =>
				tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
		};
		const command = local.match(event.nativeEvent);
		const action =
			command === null ? (plainKey(event) ? navigation[event.key] : undefined) : commands[command];
		if (!action) return;
		event.preventDefault();
		action();
	};
	const current = model.at(selected);
	const announce = current ? eventTitle(t, current) : "";

	return (
		<div ref={setRoot} data-testid="timeline-view" className="h-full min-h-0">
			<ResizablePanelGroup
				direction={stacked ? "vertical" : "horizontal"}
				className="h-full min-h-0"
			>
				<ResizablePanel defaultSize={stacked ? 60 : 68} minSize={stacked ? 25 : 40}>
					<div className="flex h-full min-h-0 flex-col">
						<div
							role="toolbar"
							aria-label={t("sessionInsights.timeline.toolbar")}
							className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-b px-12 py-4"
						>
							{toolbarStart}
							<fieldset
								aria-label={t("sessionInsights.timeline.axis")}
								className="flex items-center gap-4"
							>
								<ToggleSegment
									testid="timeline-axis-time"
									label={t("sessionInsights.timeline.byTime")}
									active={mode === "time"}
									onClick={() => {
										setMode("time");
										setTimeWindow(null);
									}}
								/>
								<ToggleSegment
									testid="timeline-axis-steps"
									label={t("sessionInsights.timeline.bySteps")}
									active={mode === "steps"}
									onClick={() => {
										setMode("steps");
										setTimeWindow(null);
									}}
								/>
							</fieldset>
							<ToggleSegment
								testid="timeline-compress"
								label={t("sessionInsights.trace.compress")}
								active={compress && mode === "time"}
								disabled={mode === "steps"}
								onClick={() => setCompress(!compress)}
							/>
							{steps.length > 0 || skills.length > 0 ? (
								<ToggleSegment
									testid="timeline-plan"
									label={t("sessionInsights.trace.bands")}
									active={showPlan}
									onClick={() => setShowPlan(!showPlan)}
								/>
							) : null}
							{planned ? (
								<BandMenu
									testId="timeline-plan-pick"
									label={
										pick
											? bandLabel(t, locale, analysis, pick)
											: t("sessionInsights.timeline.pickStep")
									}
									items={[
										...steps.map((step, at) => ({
											key: step.id,
											label: `${at + 1}. ${step.title}`,
											pick: { kind: "step", id: step.id } as const,
										})),
										...skills.map((skill, at) => ({
											key: `${skill.eventId}:${at}`,
											label: skill.name,
											pick: { kind: "skill", index: at } as const,
										})),
									]}
									current={pick}
									onPick={choosePick}
								/>
							) : null}
							<div className="ml-auto flex items-center gap-4">
								<IconButton
									icon={RiZoomOutLine}
									size="s"
									label={t("sessionInsights.trace.zoomOut")}
									tooltipShortcut={local.caps(PANEL_KEYS.zoomOut)}
									onClick={() => zoom(1 / ZOOM_STEP)}
								/>
								<IconButton
									icon={RiZoomInLine}
									size="s"
									label={t("sessionInsights.trace.zoomIn")}
									tooltipShortcut={local.caps(PANEL_KEYS.zoomIn)}
									onClick={() => zoom(ZOOM_STEP)}
								/>
								<Button
									variant="ghost"
									size="s"
									data-testid="timeline-fit"
									onClick={() => zoom("fit")}
								>
									{t("sessionInsights.trace.fit")}
								</Button>
							</div>
						</div>
						<Summary timeline={timeline} sources={sources} />
						<div
							className="relative h-52 shrink-0 border-border-default border-b bg-container-header-bg"
							aria-hidden="true"
						>
							<canvas
								ref={headerRef}
								data-testid="timeline-axis"
								className="absolute inset-0 size-full cursor-crosshair"
							/>
						</div>
						<div
							data-testid="timeline-lanes"
							className="relative min-h-0 flex-1 overflow-y-auto has-[:focus-visible]:focus-ring-inset"
						>
							<button
								ref={keysRef}
								type="button"
								data-testid="timeline-keys"
								data-key-scope={PANEL_SCOPE}
								aria-describedby={`${sessionId}-timeline-keys`}
								aria-keyshortcuts={local.aria(...TIMELINE_KEYS)}
								onKeyDown={onKeyDown}
								className="sr-only"
							>
								{t("sessionInsights.timeline.canvasLabel")}
							</button>
							<div ref={boxRef} aria-hidden="true" className="relative">
								<svg
									aria-hidden="true"
									width="100%"
									height={layout.height}
									className="pointer-events-none relative z-10 block"
								>
									<GapLabels scale={scale} view={view} width={width} height={layout.height} />
								</svg>
								<canvas
									ref={bodyRef}
									data-testid="timeline-canvas"
									className="absolute inset-0 size-full"
								/>
								<canvas ref={overlayRef} className="absolute inset-0 size-full" />
							</div>
							<span id={`${sessionId}-timeline-keys`} className="sr-only">
								{keysHint}
							</span>
							<span aria-live="polite" className="sr-only">
								{announce}
							</span>
						</div>
						<Legend model={model} testId="timeline-legend" hint={keysHint}>
							{ACTOR_ORDER.map((actor) => (
								<Swatch key={actor} className={ACTOR_SWATCH[actor]}>
									{t(ACTOR_LABEL[actor])}
								</Swatch>
							))}
						</Legend>
					</div>
				</ResizablePanel>
				<ResizableHandle direction={stacked ? "vertical" : "horizontal"} />
				<ResizablePanel defaultSize={stacked ? 40 : 32} minSize={stacked ? 20 : 22}>
					<div
						className={cn(
							"h-full min-h-0 border-border-default",
							stacked ? "border-t" : "border-l",
						)}
					>
						<DetailsPanel
							host={host}
							sessionId={sessionId}
							model={model}
							index={selected}
							overview={overview}
							query=""
							onSelect={select}
							onZoom={(index) => {
								const event = model.at(index);
								if (event) setView(viewAround(scale, event.t0, event.t1, 0.6));
							}}
							tabsRef={tabsRef}
						/>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
