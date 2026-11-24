import {
	RiArrowLeftSLine,
	RiArrowRightSLine,
	RiCalendarLine,
	RiRobot2Line,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	DaySession,
	DayTimelineResult,
	Figure,
	MetricId,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { isBadged, sessionName } from "../copy";
import { FigureBadge, FigureDetails, type FigureView, type Sources } from "../FigureCell";
import {
	formatClock,
	formatCost,
	formatCostExact,
	formatCount,
	formatDuration,
	formatTokens,
} from "../format";
import { listScope, type ScopeKind } from "../load";
import { FAMILY_LABEL, Swatch } from "../trace/Legend";
import { useCanvasLook } from "../trace/look";
import { FAMILY_SERIES } from "../trace/model";
import { SERIES_SWATCH } from "../trace/TraceTree";
import { usePolled } from "../usePolled";
import { loadDay, neighbours } from "./api";
import { DayEngine, type DayText } from "./engine";
import { type DayHit, dayScale, hitDay } from "./layout";

/** One day of the scope, re-asked with the polls' backoff while the host's index is still being built. */
function useDay(host: PanelHost, scopeKind: ScopeKind, day: string | null, attempt: number) {
	return usePolled(
		`${scopeKind}:${host.scope.projectId}:${day}:${attempt}`,
		true,
		(signal) => loadDay(host, listScope(host, scopeKind), day, signal),
		(value) => value.state.phase !== "ready",
	);
}

/** `YYYY-MM-DD` as a readable date; the key is the host's calendar day, so it is read as a local date. */
export function dayTitle(locale: string, day: string): string {
	const [year, month, date] = day.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
		new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1),
	);
}

function spend(
	t: Translator,
	locale: string,
	session: { cost: DaySession["cost"]; tokens: DaySession["tokens"] },
) {
	const tokens = session.tokens.value?.total ?? 0;
	return session.cost.origin === "notRecorded" || session.cost.value === null
		? t("sessionInsights.turns.tokens", { tokens: formatTokens(locale, tokens) })
		: formatCost(locale, session.cost.value);
}

/** A server count in a tooltip, with the server's origin; `null` stays unknown. */
function countFigure(locale: string, metric: MetricId, figure: Figure): FigureView {
	return {
		metric,
		origin: figure.origin,
		exact: figure.value === null ? null : formatCount(locale, figure.value),
	};
}

/** A server count in text: "—" when the server has none. */
function countText(locale: string, figure: Figure): string {
	return figure.value === null ? "—" : formatCount(locale, figure.value);
}

function rowFigures(locale: string, session: DaySession): FigureView[] {
	const tokens = session.tokens.value;
	return [
		{
			metric: "tokens",
			origin: session.tokens.origin,
			exact: tokens === null ? null : formatCount(locale, tokens.total),
		},
		{
			metric: "cost",
			origin: session.cost.origin,
			exact: session.cost.value === null ? null : formatCostExact(locale, session.cost.value),
		},
		countFigure(locale, "llmCalls", session.llmCalls),
		countFigure(locale, "toolCalls", session.toolCalls),
		countFigure(locale, "toolErrors", session.toolErrors),
		countFigure(locale, "cacheMisses", session.cacheMisses),
	];
}

function describe(t: Translator, locale: string, day: DayTimelineResult, hit: DayHit): string[] {
	if (hit.kind === "warm")
		return [
			t("sessionInsights.day.warmAt", {
				count: hit.count,
				n: formatCount(locale, hit.count),
				time: formatClock(locale, hit.t, false),
			}),
			t("sessionInsights.day.warmRule", { duration: formatDuration(t, day.cacheTtlMs) }),
		];
	const lines = [sessionName(t, hit.session)];
	if (hit.turn)
		lines.push(
			t("sessionInsights.day.turnAt", {
				n: hit.turn.n,
				from: formatClock(locale, hit.turn.t0, false),
				to: formatClock(locale, hit.turn.t1, false),
				duration: formatDuration(t, hit.turn.t1 - hit.turn.t0),
			}),
		);
	if (hit.session.warm.some((warm) => hit.t >= warm.t0 && hit.t < warm.t1))
		lines.push(t("sessionInsights.day.warmHere"));
	lines.push(t("sessionInsights.day.openHint"));
	return lines;
}

export function DayStrip({
	day,
	onOpen,
}: {
	day: DayTimelineResult;
	onOpen: (session: DaySession) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const { palette, font } = useCanvasLook(root);
	const headerRef = useRef<HTMLCanvasElement>(null);
	const bodyRef = useRef<HTMLCanvasElement>(null);
	const overlayRef = useRef<HTMLCanvasElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [engine, setEngine] = useState<DayEngine | null>(null);
	const scale = useMemo(() => dayScale(day), [day]);
	const latest = useRef({ day, scale, onOpen, width: 0 });
	useEffect(() => {
		latest.current = { ...latest.current, day, scale, onOpen };
	});
	const text: DayText = useMemo(
		() => ({
			font,
			hour: (hour) => `${String(hour).padStart(2, "0")}:00`,
			empty: (ms) => t("sessionInsights.day.empty", { duration: formatDuration(t, ms) }),
			continues: t("sessionInsights.day.continues"),
			tooltip: (hit) => describe(t, locale, latest.current.day, hit),
		}),
		[font, locale, t],
	);
	useEffect(() => {
		const header = headerRef.current;
		const body = bodyRef.current;
		const overlay = overlayRef.current;
		if (!header || !body || !overlay) return;
		const created = new DayEngine(header, body, overlay);
		setEngine(created);
		return () => created.dispose();
	}, []);
	useEffect(() => {
		engine?.setDay(day, scale);
	}, [day, engine, scale]);
	useEffect(() => {
		if (engine && palette) engine.setLook(palette, text);
	}, [engine, palette, text]);
	useEffect(() => {
		const box = boxRef.current;
		if (!box || !engine) return;
		const measure = () => {
			latest.current.width = box.clientWidth;
			engine.setSize(box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(box);
		return () => observer.disconnect();
	}, [engine]);
	useEffect(() => {
		const overlay = overlayRef.current;
		if (!overlay || !engine) return;
		const at = (event: MouseEvent) => {
			const rect = overlay.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const { day: current, scale: axis, width } = latest.current;
			return { x, y, hit: axis ? hitDay(current, axis, width, x, y) : null };
		};
		const onMove = (event: MouseEvent) => engine.setHover(at(event));
		const onLeave = () => engine.setHover(null);
		const onClick = (event: MouseEvent) => {
			const { hit } = at(event);
			if (hit?.kind === "row") latest.current.onOpen(hit.session);
		};
		overlay.addEventListener("mousemove", onMove);
		overlay.addEventListener("mouseleave", onLeave);
		overlay.addEventListener("click", onClick);
		return () => {
			overlay.removeEventListener("mousemove", onMove);
			overlay.removeEventListener("mouseleave", onLeave);
			overlay.removeEventListener("click", onClick);
		};
	}, [engine]);
	return (
		<div
			ref={setRoot}
			data-testid="day-strip"
			className="flex min-h-0 flex-1 flex-col overflow-y-auto"
		>
			<div className="sticky top-0 z-10 flex h-26 shrink-0 border-border-default border-b bg-container-header-bg">
				<div className="flex w-240 shrink-0 items-center px-12 tr-text-caption text-text-subtle">
					{t("sessionInsights.day.compressed")}
				</div>
				<div className="relative min-w-0 flex-1" aria-hidden="true">
					<canvas ref={headerRef} data-testid="day-axis" className="absolute inset-0 size-full" />
				</div>
				<div className="flex w-128 shrink-0 items-center justify-end px-12 tr-text-caption text-text-subtle">
					{t("sessionInsights.day.figures")}
				</div>
			</div>
			<div className="flex shrink-0">
				<ol aria-label={t("sessionInsights.day.rows")} className="flex w-240 shrink-0 flex-col">
					<li className="flex h-30 flex-col justify-center border-border-default border-b px-12">
						<span className="truncate tr-text-metadata text-text-default">
							{t("sessionInsights.day.warm")}
						</span>
					</li>
					{day.sessions.map((session) => (
						<li key={session.sessionId} className="h-40 border-border-muted border-b">
							<button
								type="button"
								data-testid="day-row"
								data-session-id={session.sessionId}
								onClick={() => onOpen(session)}
								className="flex size-full min-w-0 flex-col justify-center px-12 text-left hover:bg-control-bg-hovered focus-visible:focus-ring-inset"
							>
								<span
									className="truncate tr-text-metadata text-text-default"
									title={sessionName(t, session)}
								>
									{sessionName(t, session)}
								</span>
								<span className="flex min-w-0 items-center gap-4 tr-text-caption text-text-subtle tabular-nums">
									<span className="truncate">
										{t("sessionInsights.day.rowMeta", {
											from: formatClock(locale, session.start, false),
											to: formatClock(locale, session.end, false),
											count: session.turns.length,
											n: formatCount(locale, session.turns.length),
										})}
									</span>
									{session.subagents.value !== null && session.subagents.value > 0 ? (
										<span className="inline-flex shrink-0 items-center gap-2 text-series-6">
											<RiRobot2Line aria-hidden className="size-12" />
											{formatCount(locale, session.subagents.value)}
										</span>
									) : null}
								</span>
							</button>
						</li>
					))}
				</ol>
				<div ref={boxRef} className="relative min-w-0 flex-1" aria-hidden="true">
					<canvas ref={bodyRef} data-testid="day-canvas" className="absolute inset-0 size-full" />
					<canvas ref={overlayRef} className="absolute inset-0 size-full cursor-pointer" />
				</div>
				<ol aria-label={t("sessionInsights.day.figures")} className="flex w-128 shrink-0 flex-col">
					<li className="h-30 border-border-default border-b" />
					{day.sessions.map((session) => (
						<li key={session.sessionId} className="h-40 border-border-muted border-b">
							<IconTooltip
								label={
									<FigureDetails figures={rowFigures(locale, session)} sources={day.sources} />
								}
								align="end"
							>
								<button
									type="button"
									data-testid="day-row-figures"
									onClick={() => onOpen(session)}
									className="flex size-full flex-col items-end justify-center px-12 tr-text-caption tabular-nums hover:bg-control-bg-hovered focus-visible:focus-ring-inset"
								>
									<span className="text-text-default">{spend(t, locale, session)}</span>
									<span className="text-text-subtle">
										{t("sessionInsights.day.calls", {
											count: session.toolCalls.value ?? 0,
											n: countText(locale, session.toolCalls),
										})}
										{session.toolErrors.value !== null && session.toolErrors.value > 0 ? (
											<span className="text-feedback-error">
												{` ×${formatCount(locale, session.toolErrors.value)}`}
											</span>
										) : null}
									</span>
								</button>
							</IconTooltip>
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}

function Totals({ day, sources }: { day: DayTimelineResult; sources: Sources }) {
	const t = useT();
	const locale = localeOf(t);
	const totals = day.totals;
	if (!totals) return null;
	const tokens = totals.tokens.value;
	const figures: FigureView[] = [
		countFigure(locale, "llmCalls", totals.llmCalls),
		countFigure(locale, "toolCalls", totals.toolCalls),
		countFigure(locale, "toolErrors", totals.toolErrors),
		{
			metric: "tokens",
			origin: totals.tokens.origin,
			exact: tokens ? formatCount(locale, tokens.total) : null,
		},
		{
			metric: "cost",
			origin: totals.cost.origin,
			exact: totals.cost.value === null ? null : formatCostExact(locale, totals.cost.value),
		},
		countFigure(locale, "cacheMisses", totals.cacheMisses),
		{ metric: "warmCaches", origin: "approximated", exact: formatDuration(t, day.cacheTtlMs) },
	];
	return (
		<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="start">
			<button
				type="button"
				data-testid="day-totals"
				className="flex min-w-0 flex-wrap items-center gap-x-8 rounded-sm text-left tr-text-metadata text-text-muted tabular-nums focus-visible:focus-ring"
			>
				<span>
					{t("sessionInsights.turns.llmCalls", {
						count: totals.llmCalls.value ?? 0,
						n: countText(locale, totals.llmCalls),
					})}
				</span>
				<span>
					{t("sessionInsights.turns.toolCalls", {
						count: totals.toolCalls.value ?? 0,
						n: countText(locale, totals.toolCalls),
					})}
				</span>
				<span
					className={
						totals.toolErrors.value !== null && totals.toolErrors.value > 0
							? "text-feedback-error"
							: undefined
					}
				>
					{t("sessionInsights.turns.errors", {
						count: totals.toolErrors.value ?? 0,
						n: countText(locale, totals.toolErrors),
					})}
				</span>
				<span>
					{t("sessionInsights.turns.tokens", { tokens: formatTokens(locale, tokens?.total ?? 0) })}
				</span>
				<span>{spend(t, locale, totals)}</span>
				{isBadged(totals.cost.origin) && totals.cost.origin !== "notRecorded" ? (
					<FigureBadge origin={totals.cost.origin} />
				) : null}
				<span>
					{t("sessionInsights.day.misses", {
						count: totals.cacheMisses.value ?? 0,
						n: countText(locale, totals.cacheMisses),
					})}
				</span>
				{isBadged(totals.cacheMisses.origin) ? (
					<FigureBadge origin={totals.cacheMisses.origin} />
				) : null}
			</button>
		</IconTooltip>
	);
}

/**
 * The day view: every session of the scope that started on one day (the host's calendar), on one
 * shared strip with empty hours compressed; a row opens that session's analysis.
 */
export function DayView({
	host,
	scopeKind,
	attempt,
	onOpen,
}: {
	host: PanelHost;
	scopeKind: ScopeKind;
	attempt: number;
	onOpen: (session: DaySession) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [day, setDay] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const { view: state, busy } = useDay(host, scopeKind, day, attempt + retry);
	if (state.kind === "loading")
		return (
			<LoadingRegion
				rows={6}
				label={t("sessionInsights.day.loading")}
				testId="day-loading"
				className="p-16"
			/>
		);
	if (state.kind === "version")
		return (
			<div
				data-testid="session-insights-update-host"
				className="p-16 text-center tr-text-ui text-text-muted"
			>
				{t("sessionInsights.updateHost")}
			</div>
		);
	if (state.kind === "error")
		return (
			<div
				data-testid="day-error"
				role="alert"
				className="flex flex-col items-center gap-8 p-16 tr-text-ui text-text-muted"
			>
				<span>{t("sessionInsights.error.failed")}</span>
				<Button variant="outline" size="m" onClick={() => setRetry(retry + 1)}>
					{t("common.retry")}
				</Button>
			</div>
		);
	const result = state.value;
	const { previous, next } = neighbours(result.days, result.day);
	return (
		<div
			data-testid="day-view"
			data-day={result.day ?? ""}
			aria-busy={busy}
			className="flex h-full min-h-0 flex-col"
		>
			<div className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-b px-12 py-4">
				<IconButton
					icon={RiArrowLeftSLine}
					size="s"
					label={t("sessionInsights.day.previous")}
					data-testid="day-previous"
					disabled={previous === null}
					onClick={() => previous && setDay(previous)}
				/>
				<span
					data-testid="day-title"
					className="inline-flex items-center gap-4 tr-text-emphasis text-text-default"
				>
					<RiCalendarLine aria-hidden className="size-14 text-text-muted" />
					{result.day
						? t("sessionInsights.day.title", {
								day: dayTitle(locale, result.day),
								count: result.sessions.length,
								n: formatCount(locale, result.sessions.length),
							})
						: t("sessionInsights.day.none")}
				</span>
				<IconButton
					icon={RiArrowRightSLine}
					size="s"
					label={t("sessionInsights.day.next")}
					data-testid="day-next"
					disabled={next === null}
					onClick={() => next && setDay(next)}
				/>
				<Totals day={result} sources={result.sources} />
				<span className="ml-auto tr-text-caption text-text-subtle" title={result.timeZone}>
					{t("sessionInsights.day.zone", { zone: result.timeZone })}
				</span>
			</div>
			{result.sessions.length === 0 ? (
				<div data-testid="day-empty" className="p-16 text-center tr-text-ui text-text-muted">
					{t("sessionInsights.day.emptyDay")}
				</div>
			) : (
				<DayStrip day={result} onOpen={onOpen} />
			)}
			<div className="flex shrink-0 flex-wrap items-center gap-x-12 gap-y-2 border-border-default border-t px-12 py-4 tr-text-caption text-text-muted">
				<Swatch className="border border-primary bg-primary-subtle">
					{t("sessionInsights.day.legend.turn")}
				</Swatch>
				<Swatch className="bg-feedback-success">
					{t("sessionInsights.day.legend.warm", { duration: formatDuration(t, result.cacheTtlMs) })}
				</Swatch>
				<Swatch className={SERIES_SWATCH["series-1"]}>
					{t("sessionInsights.day.legend.miss")}
				</Swatch>
				<Swatch className="bg-feedback-error">{t("sessionInsights.trace.legend.error")}</Swatch>
				<Swatch className="bg-primary-muted">{t("sessionInsights.turns.legend.wait")}</Swatch>
				{(["discovery", "reading", "writing", "execution", "planning", "subagent"] as const).map(
					(family) => (
						<Swatch key={family} className={SERIES_SWATCH[FAMILY_SERIES[family]]}>
							{t(FAMILY_LABEL[family])}
						</Swatch>
					),
				)}
			</div>
		</div>
	);
}
