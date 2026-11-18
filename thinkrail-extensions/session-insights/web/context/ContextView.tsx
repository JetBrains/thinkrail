import { RiErrorWarningLine, RiFlowChart, RiGitPullRequestLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, useT } from "@thinkrail/locales/react";
import type { ContextCall, Origin, SessionContext } from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { FigureBadge, FigureDetails, type Sources } from "../FigureCell";
import {
	formatClock,
	formatCount,
	formatDateTime,
	formatDuration,
	formatShare,
	formatTokens,
} from "../format";
import { StatFigure } from "../StatFigure";
import { Swatch } from "../trace/Legend";
import type { TraceModel } from "../trace/model";
import { ContextChart } from "./ContextChart";
import { causeText } from "./causes";
import { CACHE_SWATCH, CATEGORIES, CATEGORY_LABEL, CATEGORY_SWATCH } from "./look";
import { RequestDiffView } from "./RequestDiffView";

type Mode = "chart" | "diff";
const MISSES_SHOWN = 40;
const GREW_SHOWN = 7;

export function CauseChips({ call }: { call: ContextCall }) {
	const t = useT();
	const causes = call.miss?.causes ?? [];
	if (causes.length === 0)
		return (
			<span
				data-testid="context-cause"
				data-cause="unexplained"
				className="rounded-sm border border-border-default border-dashed px-4 tr-text-caption text-text-subtle"
			>
				{t("sessionInsights.context.cause.unexplained")}
			</span>
		);
	return (
		<>
			{causes.map((cause) => (
				<span
					key={cause}
					data-testid="context-cause"
					data-cause={cause}
					className={cn(
						"rounded-sm border px-4 tr-text-caption",
						cause === "pause"
							? "border-feedback-warning-muted text-feedback-warning"
							: cause === "compaction"
								? "border-series-7 text-series-7"
								: "border-border-default text-text-muted",
					)}
				>
					{causeText(t, cause, call.gapMs)}
				</span>
			))}
		</>
	);
}

/** One cell per percent of the window (or of the context when it exceeds the known window). */
function Waffle({ call, window }: { call: ContextCall; window: number | null }) {
	const t = useT();
	const locale = localeOf(t);
	const base = window !== null && call.total <= window ? window : call.total;
	const raw = call.parts.map((part) => (part / Math.max(1, base)) * 100);
	const cells = raw.map(Math.floor);
	let left = Math.round((call.total / Math.max(1, base)) * 100) - cells.reduce((a, b) => a + b, 0);
	for (const { at } of raw
		.map((value, at) => ({ at, rest: value - Math.floor(value) }))
		.sort((a, b) => b.rest - a.rest || a.at - b.at)) {
		if (left <= 0) break;
		cells[at] = (cells[at] ?? 0) + 1;
		left -= 1;
	}
	const squares: { key: string; category: number | null }[] = [];
	cells.forEach((n, category) => {
		for (let k = 0; k < n && squares.length < 100; k++)
			squares.push({ key: `${category}:${k}`, category });
	});
	while (squares.length < 100) squares.push({ key: `free:${squares.length}`, category: null });
	return (
		<div className="flex flex-col gap-4">
			<span className="tr-text-caption text-text-subtle">
				{base === window
					? t("sessionInsights.context.waffleWindow")
					: t("sessionInsights.context.waffleContext")}
			</span>
			<div
				data-testid="context-waffle"
				role="img"
				aria-label={t("sessionInsights.context.waffleLabel", {
					share: formatShare(locale, call.total, base) ?? "",
				})}
				className="grid w-fit grid-cols-10 gap-2"
			>
				{squares.map((square) => {
					const category = square.category === null ? null : CATEGORIES[square.category];
					return (
						<span
							key={square.key}
							className={cn(
								"size-12 rounded-sm",
								category ? CATEGORY_SWATCH[category] : "bg-control-bg",
							)}
						/>
					);
				})}
			</div>
		</div>
	);
}

function Grew({ call }: { call: ContextCall }) {
	const t = useT();
	const locale = localeOf(t);
	if (!call.delta)
		return (
			<span className="tr-text-caption text-text-muted">
				{t("sessionInsights.context.firstCall")}
			</span>
		);
	const rows = CATEGORIES.map((category, at) => ({ category, value: call.delta?.[at] ?? 0 }))
		.filter((row) => row.value !== 0)
		.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
		.slice(0, GREW_SHOWN);
	return (
		<ul data-testid="context-grew" className="flex flex-col gap-2">
			{rows.length === 0 ? (
				<li className="tr-text-caption text-text-muted">{t("sessionInsights.context.noGrowth")}</li>
			) : null}
			{rows.map((row) => (
				<li key={row.category} className="flex items-center gap-6 tr-text-metadata">
					<span className={cn("size-8 shrink-0 rounded-sm", CATEGORY_SWATCH[row.category])} />
					<span className="min-w-0 flex-1 truncate text-text-muted">
						{t(CATEGORY_LABEL[row.category])}
					</span>
					<span
						className={cn(
							"tabular-nums",
							row.value < 0 ? "text-feedback-success" : "text-text-default",
						)}
					>
						{`${row.value < 0 ? "−" : "+"}≈${formatTokens(locale, Math.abs(row.value))}`}
					</span>
				</li>
			))}
		</ul>
	);
}

function CallCard({
	call,
	data,
	sources,
	onDiff,
	onShowInTrace,
}: {
	call: ContextCall;
	data: SessionContext;
	sources: Sources;
	onDiff: () => void;
	onShowInTrace: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const limit = data.limits.find((item) => item.model === call.model) ?? null;
	const rows: [string, string][] = [
		[t("sessionInsights.context.when"), formatDateTime(locale, call.t)],
		[
			t("sessionInsights.context.total"),
			limit
				? t("sessionInsights.context.ofWindow", {
						tokens: formatCount(locale, call.total),
						share: formatShare(locale, call.total, limit.value) ?? "",
					})
				: formatCount(locale, call.total),
		],
		[t("sessionInsights.context.read"), formatCount(locale, call.cacheRead)],
		[t("sessionInsights.context.written"), formatCount(locale, call.cacheWrite)],
		[t("sessionInsights.context.uncached"), formatCount(locale, call.input)],
		[
			t("sessionInsights.context.pause"),
			call.gapMs === null ? "—" : formatDuration(t, call.gapMs, true),
		],
	];
	return (
		<section
			data-testid="context-call"
			data-call-id={call.id}
			aria-label={t("sessionInsights.context.callTitle", { n: call.n, model: call.model ?? "—" })}
			className="flex min-w-0 flex-col gap-8 rounded-md border border-border-default p-8"
		>
			<header className="flex min-w-0 items-center gap-6">
				<span className="truncate tr-text-emphasis text-text-default">
					{t("sessionInsights.context.callTitle", { n: call.n, model: call.model ?? "—" })}
				</span>
				{call.turn !== null ? (
					<span className="shrink-0 tr-text-caption text-text-subtle">
						{t("sessionInsights.trace.turn", { n: call.turn })}
					</span>
				) : null}
			</header>
			<dl className="grid grid-cols-[auto_1fr] gap-x-12 gap-y-2 tr-text-metadata">
				{rows.map(([label, value]) => (
					<div key={label} className="contents">
						<dt className="text-text-muted">{label}</dt>
						<dd className="text-right text-text-default tabular-nums">{value}</dd>
					</div>
				))}
			</dl>
			{call.miss ? (
				<div
					data-testid="context-call-miss"
					className="flex flex-col gap-4 rounded-md border border-feedback-error-muted p-6"
				>
					<span className="flex items-center gap-4 tr-text-metadata text-feedback-error">
						<RiErrorWarningLine aria-hidden className="size-14 shrink-0" />
						{t("sessionInsights.context.missTitle")}
						<FigureBadge origin="approximated" />
					</span>
					<span className="flex flex-wrap gap-4">
						<CauseChips call={call} />
					</span>
				</div>
			) : null}
			<div className="flex flex-wrap items-start gap-16">
				<Waffle call={call} window={limit?.value ?? null} />
				<div className="flex min-w-160 flex-1 flex-col gap-4">
					<span className="flex items-center gap-4 tr-text-caption text-text-subtle">
						{t("sessionInsights.context.grewTitle")}
						<IconTooltip
							label={
								<FigureDetails
									figures={[
										{
											metric: "contextComposition",
											origin: "approximated",
											exact: formatCount(locale, call.total),
										},
									]}
									sources={sources}
								/>
							}
						>
							<button type="button" className="rounded-sm focus-visible:focus-ring">
								<FigureBadge origin="approximated" />
							</button>
						</IconTooltip>
					</span>
					<Grew call={call} />
				</div>
			</div>
			<div className="flex flex-wrap gap-4">
				<Button
					variant="outline"
					size="s"
					iconLeft={RiGitPullRequestLine}
					data-testid="context-open-diff"
					onClick={onDiff}
				>
					{t("sessionInsights.context.openDiff")}
				</Button>
				<Button variant="ghost" size="s" iconLeft={RiFlowChart} onClick={onShowInTrace}>
					{t("sessionInsights.context.showInTrace")}
				</Button>
			</div>
		</section>
	);
}

function MissesTable({
	data,
	selected,
	onSelect,
}: {
	data: SessionContext;
	selected: number | null;
	onSelect: (index: number) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [shown, setShown] = useState(MISSES_SHOWN);
	const misses = data.calls.flatMap((call, index) => (call.miss ? [{ call, index }] : []));
	if (misses.length === 0)
		return (
			<p data-testid="context-no-misses" className="tr-text-metadata text-text-muted">
				{t("sessionInsights.context.noMisses")}
			</p>
		);
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<span className="flex items-center gap-6 tr-text-metadata text-text-default">
				<RiErrorWarningLine aria-hidden className="size-14 shrink-0 text-feedback-error" />
				{t("sessionInsights.context.missesTitle")}
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.context.missesHeuristic")}
				</span>
			</span>
			<table data-testid="context-misses" className="w-full table-fixed tr-text-metadata">
				<thead>
					<tr className="text-left tr-text-caption text-text-subtle">
						<th className="w-64 py-2 font-normal">{t("sessionInsights.context.column.call")}</th>
						<th className="w-80 py-2 font-normal">{t("sessionInsights.context.column.when")}</th>
						<th className="w-80 py-2 text-right font-normal">
							{t("sessionInsights.context.column.written")}
						</th>
						<th className="w-80 py-2 text-right font-normal">
							{t("sessionInsights.context.column.read")}
						</th>
						<th className="py-2 pl-12 font-normal">{t("sessionInsights.context.column.cause")}</th>
					</tr>
				</thead>
				<tbody>
					{misses.slice(0, shown).map(({ call, index }) => (
						<tr
							key={call.id}
							data-testid="context-miss"
							data-call-id={call.id}
							className={cn(
								"border-border-default border-t",
								index === selected && "bg-control-bg-selected",
							)}
						>
							<td className="py-2">
								<button
									type="button"
									aria-pressed={index === selected}
									onClick={() => onSelect(index)}
									className="rounded-sm text-text-default tabular-nums hover:underline focus-visible:focus-ring"
								>
									{t("sessionInsights.context.callShort", { n: call.n })}
								</button>
							</td>
							<td className="py-2 text-text-muted tabular-nums">
								{formatClock(locale, call.t, true)}
							</td>
							<td className="py-2 text-right tabular-nums">
								{formatTokens(locale, call.cacheWrite)}
							</td>
							<td className="py-2 text-right tabular-nums">
								{formatShare(locale, call.cacheRead, call.total) ?? "—"}
							</td>
							<td className="py-2 pl-12">
								<span className="flex flex-wrap gap-4">
									<CauseChips call={call} />
								</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{misses.length > shown ? (
				<Button variant="ghost" size="s" onClick={() => setShown(shown + MISSES_SHOWN)}>
					{t("sessionInsights.more", { count: Math.min(MISSES_SHOWN, misses.length - shown) })}
				</Button>
			) : null}
		</div>
	);
}

function ChartLegend() {
	const t = useT();
	return (
		<div
			data-testid="context-legend"
			className="flex flex-wrap items-center gap-x-12 gap-y-4 tr-text-caption text-text-muted"
		>
			{CATEGORIES.map((category) => (
				<Swatch key={category} className={CATEGORY_SWATCH[category]}>
					{t(CATEGORY_LABEL[category])}
				</Swatch>
			))}
			<span
				data-testid="context-legend-cache"
				className="inline-flex flex-wrap items-center gap-x-12 gap-y-4 border-border-default border-l pl-12"
			>
				<span className="text-text-subtle">{t("sessionInsights.context.legend.cache")}</span>
				<Swatch className={CACHE_SWATCH.read}>{t("sessionInsights.context.legend.read")}</Swatch>
				<Swatch className={CACHE_SWATCH.write}>{t("sessionInsights.context.legend.write")}</Swatch>
				<Swatch className={CACHE_SWATCH.input}>{t("sessionInsights.context.legend.input")}</Swatch>
			</span>
			<span>{t("sessionInsights.context.legend.readLine")}</span>
			<span>{t("sessionInsights.context.legend.miss")}</span>
			<span>{t("sessionInsights.context.legend.limit")}</span>
		</div>
	);
}

/** The call a selection points at: the call itself or the model call that issued a selected tool. */
function selectedCall(
	data: SessionContext,
	model: TraceModel,
	selectedId: string | null,
): number | null {
	if (selectedId === null) return null;
	const direct = data.calls.findIndex((call) => call.id === selectedId);
	if (direct !== -1) return direct;
	const event = model.at(model.indexOf(selectedId));
	if (event?.kind !== "tool" || !event.parent) return null;
	const parent = data.calls.findIndex((call) => call.id === event.parent);
	return parent === -1 ? null : parent;
}

function defaultCall(data: SessionContext): number | null {
	const indexOf = new Map(data.calls.map((call, at) => [call.id, at]));
	const cliff = data.compactions.find((item) => item.after !== null);
	if (cliff?.after) return indexOf.get(cliff.after) ?? null;
	const miss = data.calls.findIndex((call) => call.miss);
	if (miss !== -1) return miss;
	return data.calls.length > 0 ? data.calls.length - 1 : null;
}

/**
 * Context and cache per model call: composition bars (estimates scaled to pi's exact totals) with the
 * window line, compaction drops and model switches, the cache strip with heuristic misses and their
 * causes, the selected call's waffle and growth — or, switched, the reconstructed diff of its request.
 */
export function ContextView({
	host,
	sessionId,
	data,
	sources,
	model,
	selectedId,
	onSelectId,
	onShowInTrace,
}: {
	host: PanelHost;
	sessionId: string;
	data: SessionContext;
	sources: Sources;
	model: TraceModel;
	selectedId: string | null;
	onSelectId: (id: string) => void;
	onShowInTrace: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [mode, setMode] = useState<Mode>("chart");
	const picked = selectedCall(data, model, selectedId);
	const selected = picked ?? defaultCall(data);
	const call = selected === null ? undefined : data.calls[selected];
	const select = (index: number) => {
		const target = data.calls[index];
		if (target) onSelectId(target.id);
	};
	let peakCall: ContextCall | undefined;
	for (const item of data.calls) if (!peakCall || item.total > peakCall.total) peakCall = item;
	const peakLimit = data.limits.find((item) => item.model === peakCall?.model) ?? null;
	const window = peakLimit?.value ?? null;
	const limitOrigin: Origin = peakLimit?.origin ?? "host";
	if (data.calls.length === 0)
		return (
			<p data-testid="context-empty" className="p-16 text-center tr-text-ui text-text-muted">
				{t("sessionInsights.context.empty")}
			</p>
		);
	return (
		<div data-testid="context-view" className="flex h-full min-h-0 flex-col">
			<div
				role="toolbar"
				aria-label={t("sessionInsights.context.toolbar")}
				className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-b px-12 py-4"
			>
				<fieldset
					aria-label={t("sessionInsights.context.view")}
					className="flex items-center gap-4"
				>
					<ToggleSegment
						testid="context-mode-chart"
						label={t("sessionInsights.context.modeChart")}
						active={mode === "chart"}
						onClick={() => setMode("chart")}
					/>
					<ToggleSegment
						testid="context-mode-diff"
						label={t("sessionInsights.context.modeDiff")}
						active={mode === "diff"}
						onClick={() => setMode("diff")}
					/>
				</fieldset>
				<span className="ml-auto tr-text-caption text-text-subtle">
					{t("sessionInsights.context.counts", {
						calls: formatCount(locale, data.calls.length),
						misses: formatCount(locale, data.misses.value ?? 0),
						compactions: formatCount(locale, data.compactions.length),
					})}
				</span>
			</div>
			{mode === "diff" && call ? (
				<RequestDiffView
					host={host}
					sessionId={sessionId}
					data={data}
					selected={selected ?? 0}
					onSelect={select}
					onShowInTrace={onShowInTrace}
				/>
			) : (
				<div className="@container flex min-h-0 flex-1 flex-col gap-12 overflow-y-auto p-12">
					<div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-8">
						<StatFigure
							testId="context-peak"
							label={t("sessionInsights.context.peak")}
							sources={sources}
							figures={[
								{
									metric: "contextTokens",
									origin: data.peak.origin,
									exact: data.peak.value === null ? null : formatCount(locale, data.peak.value),
								},
								...(window !== null
									? [
											{
												metric: "contextWindow" as const,
												origin: limitOrigin,
												exact: formatCount(locale, window),
											},
										]
									: []),
							]}
							sub={
								window !== null && data.peak.value !== null
									? t("sessionInsights.context.ofWindowShort", {
											share: formatShare(locale, data.peak.value, window) ?? "",
											window: formatTokens(locale, window),
										})
									: undefined
							}
						>
							{data.peak.value === null ? "—" : formatTokens(locale, data.peak.value)}
						</StatFigure>
						<StatFigure
							testId="context-average"
							label={t("sessionInsights.context.average")}
							sources={sources}
							figures={[
								{
									metric: "contextTokens",
									origin: data.average.origin,
									exact:
										data.average.value === null ? null : formatCount(locale, data.average.value),
								},
							]}
						>
							{data.average.value === null ? "—" : formatTokens(locale, data.average.value)}
						</StatFigure>
						<StatFigure
							testId="context-cache-share"
							label={t("sessionInsights.context.cacheShare")}
							sources={sources}
							figures={[
								{
									metric: "cacheShare",
									origin: data.cacheShare.origin,
									exact:
										data.cacheShare.value === null
											? null
											: (formatShare(locale, data.cacheShare.value, 1) ?? null),
								},
							]}
							sub={t("sessionInsights.context.cacheShareSub")}
						>
							{data.cacheShare.value === null
								? "—"
								: (formatShare(locale, data.cacheShare.value, 1) ?? "—")}
						</StatFigure>
						<StatFigure
							testId="context-misses-figure"
							label={t("sessionInsights.context.misses")}
							sources={sources}
							{...((data.misses.value ?? 0) > 0 ? { tone: "warning" as const } : {})}
							figures={[
								{
									metric: "cacheMisses",
									origin: data.misses.origin,
									exact: formatCount(locale, data.misses.value ?? 0),
								},
								{
									metric: "missCause",
									origin: data.rewritten.origin,
									exact: formatCount(locale, data.rewritten.value ?? 0),
								},
							]}
							sub={t("sessionInsights.context.rewritten", {
								tokens: formatTokens(locale, data.rewritten.value ?? 0),
							})}
						>
							{formatCount(locale, data.misses.value ?? 0)}
						</StatFigure>
						<StatFigure
							testId="context-compactions"
							label={t("sessionInsights.context.compactions")}
							sources={sources}
							figures={[
								{
									metric: "contextTokens",
									origin: "counted",
									exact: formatCount(locale, data.compactions.length),
								},
							]}
						>
							{formatCount(locale, data.compactions.length)}
						</StatFigure>
					</div>
					<span
						data-testid="context-estimate-note"
						className="flex flex-wrap items-center gap-4 tr-text-metadata text-text-muted"
					>
						<FigureBadge origin="approximated" />
						{t("sessionInsights.context.estimateNote")}
						{data.calls.some((item) => item.unpersisted) ? (
							<span className="text-feedback-warning">
								{t("sessionInsights.context.unpersisted")}
							</span>
						) : null}
					</span>
					<ContextChart sessionId={sessionId} data={data} selected={selected} onSelect={select} />
					<ChartLegend />
					<div className="grid grid-cols-1 gap-12 @min-[52rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
						<MissesTable data={data} selected={selected} onSelect={select} />
						{call ? (
							<CallCard
								call={call}
								data={data}
								sources={sources}
								onDiff={() => setMode("diff")}
								onShowInTrace={() => onShowInTrace(call.id)}
							/>
						) : null}
					</div>
				</div>
			)}
		</div>
	);
}
