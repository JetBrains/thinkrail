import { RiChatQuoteLine, RiRobot2Line } from "@remixicon/react";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type { SessionSubagents, SpawnWave, SubagentRun } from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { isBadged } from "../copy";
import { RATIONALE_SOURCE } from "../details/SubagentTab";
import { FigureBadge, FigureDetails, type FigureView, type Sources } from "../FigureCell";
import {
	formatClock,
	formatCost,
	formatCostExact,
	formatCount,
	formatDuration,
	formatSpan,
	formatTokens,
} from "../format";
import { useCanvasLook } from "../trace/look";
import type { TraceModel } from "../trace/model";
import { roleSeries } from "../trace/roles";
import { StripCanvas } from "../trace/StripCanvas";
import { SERIES_SWATCH, SERIES_TEXT } from "../trace/TraceTree";
import { drawWave, waveRows } from "./draw";

/** Waves shown before *Show N more*. */
const WAVES_SHOWN = 4;
const ROW_CLASS = "h-24";

function failed(run: SubagentRun): boolean {
	return run.status === "failed" || run.status === "error" || run.status === "aborted";
}

function spendText(
	t: Translator,
	locale: string,
	cost: number | null,
	tokens: number | null,
): string {
	if (cost !== null && cost > 0) return formatCost(locale, cost);
	return t("sessionInsights.turns.tokens", { tokens: formatTokens(locale, tokens ?? 0) });
}

function RunTooltip({ run }: { run: SubagentRun }) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<div className="flex max-w-360 flex-col gap-4 tr-text-metadata">
			<span className="text-text-default">
				{run.role ?? t("sessionInsights.trace.subagent")} · {run.status ?? "—"} ·{" "}
				{run.duration.value === null ? "—" : formatSpan(t, locale, run.duration.value)}
			</span>
			<span>
				<span className="text-text-subtle">{t("sessionInsights.subagents.tipWhy")} </span>
				{run.title}
			</span>
			{run.rationale ? (
				<span>
					<span className="text-text-subtle">{t("sessionInsights.subagents.tipRationale")} </span>
					{run.rationale.text}
				</span>
			) : null}
			{run.result ? (
				<span>
					<span className="text-text-subtle">{t("sessionInsights.subagents.tipWhat")} </span>
					{run.result.text}
				</span>
			) : null}
			{run.readDelayMs !== null ? (
				<span className="text-text-subtle">
					{t("sessionInsights.subagents.readAfter", {
						duration: formatDuration(t, run.readDelayMs),
					})}
				</span>
			) : null}
			<span className="text-text-subtle">{t("sessionInsights.subagents.tipOpen")}</span>
		</div>
	);
}

function Wave({
	wave,
	runs,
	model,
	onOpen,
}: {
	wave: SpawnWave;
	runs: readonly SubagentRun[];
	model: TraceModel;
	onOpen: (childId: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [root, setRoot] = useState<HTMLElement | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const { palette } = useCanvasLook(root);
	const rows = waveRows(wave, runs);
	const turn = wave.turnId ? model.at(model.indexOf(wave.turnId)) : undefined;
	const reads = new Set(rows.flatMap((run) => (run.consumedBy ? [run.consumedBy] : []))).size;
	return (
		<section
			ref={setRoot}
			data-testid="subagent-wave"
			data-wave={wave.n}
			aria-label={t("sessionInsights.subagents.wave", { n: wave.n })}
			className="flex min-w-0 flex-col rounded-md border border-border-default"
		>
			<header className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 border-border-default border-b px-12 py-6">
				<span className="tr-text-emphasis text-text-default">
					{t("sessionInsights.subagents.wave", { n: wave.n })}
				</span>
				{wave.turnN !== null ? (
					<span className="tr-text-metadata text-primary tabular-nums">
						{t("sessionInsights.trace.turn", { n: wave.turnN })}
					</span>
				) : null}
				{turn?.label ? (
					<span className="min-w-0 flex-1 truncate tr-text-metadata text-text-muted">
						{t("sessionInsights.quotedPrompt", { prompt: turn.label })}
					</span>
				) : (
					<span className="flex-1" />
				)}
				<span className="inline-flex items-center gap-2 rounded-full border border-border-default px-6 tr-text-caption text-series-6">
					<RiRobot2Line aria-hidden className="size-12" />
					{t("sessionInsights.turns.subagents", {
						count: rows.length,
						n: formatCount(locale, rows.length),
					})}
				</span>
				<span className="tr-text-caption text-text-subtle tabular-nums">
					{`${formatClock(locale, wave.t0, true)} → ${formatClock(locale, wave.t1, true)} · ${formatDuration(t, wave.t1 - wave.t0)} · ${spendText(t, locale, wave.cost.value, wave.tokens.value)}`}
				</span>
			</header>
			{wave.rationale ? (
				<blockquote
					data-testid="subagent-wave-why"
					className="flex min-w-0 items-start gap-6 border-border-muted border-b bg-container-elevated-bg px-12 py-6 tr-text-metadata"
				>
					<RiChatQuoteLine aria-hidden className="mt-2 size-14 shrink-0 text-primary" />
					<span className="min-w-0 flex-1">
						<span className="text-text-subtle">{t("sessionInsights.subagents.whyLabel")} </span>
						<span className="text-text-default">{wave.rationale.text}</span>
					</span>
					<span className="shrink-0 tr-text-caption text-text-subtle">
						{t(RATIONALE_SOURCE[wave.rationale.source])}
					</span>
				</blockquote>
			) : null}
			<div className="grid min-w-0 grid-cols-[minmax(160px,34%)_minmax(0,1fr)] py-4">
				<div className="flex min-w-0 flex-col">
					<span
						className={cn(
							"flex min-w-0 items-center gap-4 px-12 tr-text-metadata text-text-muted",
							ROW_CLASS,
						)}
					>
						{t("sessionInsights.subagents.parent", { count: reads, n: formatCount(locale, reads) })}
					</span>
					{rows.map((run) => (
						<IconTooltip key={run.childId} label={<RunTooltip run={run} />} align="start">
							<button
								type="button"
								data-testid="subagent-lane"
								data-child-id={run.childId}
								onClick={() => onOpen(run.childId)}
								onPointerEnter={() => setHovered(run.childId)}
								onPointerLeave={() => setHovered(null)}
								onFocus={() => setHovered(run.childId)}
								onBlur={() => setHovered(null)}
								className={cn(
									"flex min-w-0 items-center gap-4 rounded-sm px-12 text-left tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring-inset",
									ROW_CLASS,
									hovered === run.childId && "bg-control-bg-hovered",
								)}
							>
								<span
									className={cn("shrink-0 tr-text-emphasis", SERIES_TEXT[roleSeries(run.role)])}
								>
									{run.role ?? t("sessionInsights.trace.subagent")}
								</span>
								<span
									className={cn(
										"min-w-0 truncate",
										failed(run) ? "text-feedback-error" : "text-text-muted",
									)}
								>
									{run.title}
								</span>
								{run.activity && run.activity.errors > 0 ? (
									<span className="ml-auto shrink-0 rounded-sm bg-feedback-error-subtle px-4 tr-text-caption text-feedback-error tabular-nums">
										{t("sessionInsights.subagents.errorsInside", {
											n: formatCount(locale, run.activity.errors),
										})}
									</span>
								) : null}
							</button>
						</IconTooltip>
					))}
				</div>
				<StripCanvas
					fill
					className="min-w-0"
					testId="subagent-wave-canvas"
					draw={
						palette
							? (context, width, height) =>
									drawWave(
										context,
										{ width, left: 6, t0: wave.t0, t1: wave.t1 },
										height,
										rows,
										palette,
										hovered,
									)
							: null
					}
				/>
			</div>
		</section>
	);
}

/** The subagents section: an overview and one fan-out / fan-in diagram per spawn wave. */
export function SubagentsView({
	model,
	view,
	sources,
	onOpen,
}: {
	model: TraceModel;
	view: SessionSubagents | null;
	sources: Sources;
	onOpen: (childId: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [shown, setShown] = useState(WAVES_SHOWN);
	if (!view || view.runs.length === 0)
		return (
			<div
				data-testid="subagents-empty"
				className="flex h-full items-center justify-center p-16 tr-text-ui text-text-muted"
			>
				{t("sessionInsights.subagents.none")}
			</div>
		);
	const { overview } = view;
	const figures: FigureView[] = [
		{
			metric: "tokens",
			origin: overview.tokens.origin,
			exact: overview.tokens.value === null ? null : formatCount(locale, overview.tokens.value),
		},
		{
			metric: "cost",
			origin: overview.cost.origin,
			exact: overview.cost.value === null ? null : formatCostExact(locale, overview.cost.value),
		},
		{ metric: "subagentRun", origin: "counted", exact: formatCount(locale, view.runs.length) },
	];
	const badge = figures.find((figure) => isBadged(figure.origin))?.origin;
	return (
		<div data-testid="subagents-view" className="h-full min-h-0 overflow-auto">
			<div className="flex min-w-0 flex-col gap-12 p-12">
				<div className="flex flex-wrap items-baseline gap-8">
					<h2 className="tr-title-compact text-text-default">
						{t("sessionInsights.session.section.subagents")}
					</h2>
					<span className="tr-text-metadata text-text-muted">
						{t("sessionInsights.subagents.question")}
					</span>
					<span className="ml-auto tr-text-caption text-text-subtle tabular-nums">
						{t("sessionInsights.subagents.totals", {
							runs: formatCount(locale, view.runs.length),
							waves: formatCount(locale, view.waves.length),
						})}
					</span>
				</div>
				<div
					data-testid="subagents-chips"
					className="flex flex-wrap items-center gap-4 tr-text-caption"
				>
					{overview.roles.map((role) => (
						<span
							key={role.role ?? ""}
							className={cn(
								"inline-flex items-center gap-2 rounded-full border border-border-default px-6",
								SERIES_TEXT[roleSeries(role.role)],
							)}
						>
							<RiRobot2Line aria-hidden className="size-12" />
							{`${role.role ?? t("sessionInsights.trace.subagent")} ×${formatCount(locale, role.n)}`}
						</span>
					))}
					<span className="rounded-full border border-border-default px-6 text-text-muted">
						{t("sessionInsights.subagents.maxParallel", {
							n: formatCount(locale, overview.maxParallel),
						})}
					</span>
					<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="start">
						<button
							type="button"
							data-testid="subagents-spend"
							className="inline-flex items-center gap-4 rounded-full border border-border-default px-6 text-text-muted tabular-nums focus-visible:focus-ring"
						>
							{t("sessionInsights.subagents.spend", {
								spend: spendText(t, locale, overview.cost.value, overview.tokens.value),
								tokens: formatTokens(locale, overview.tokens.value ?? 0),
							})}
							{badge && isBadged(badge) ? <FigureBadge origin={badge} /> : null}
						</button>
					</IconTooltip>
					<span
						className={cn(
							"rounded-full border px-6",
							overview.failed > 0
								? "border-feedback-error-muted text-feedback-error"
								: "border-feedback-success-muted text-feedback-success",
						)}
					>
						{overview.failed > 0
							? t("sessionInsights.subagents.failed", { n: formatCount(locale, overview.failed) })
							: t("sessionInsights.subagents.allCompleted")}
					</span>
					{overview.withErrors > 0 ? (
						<span className="rounded-full border border-border-default px-6 text-text-muted">
							{t("sessionInsights.subagents.withErrors", {
								n: formatCount(locale, overview.withErrors),
							})}
						</span>
					) : null}
					{overview.unmeasured > 0 ? (
						<span className="rounded-full border border-border-default px-6 text-text-subtle">
							{t("sessionInsights.subagents.unmeasured", {
								n: formatCount(locale, overview.unmeasured),
							})}
						</span>
					) : null}
				</div>
				<div className="flex flex-wrap items-center gap-x-12 gap-y-2 tr-text-caption text-text-muted">
					<span className="inline-flex items-center gap-4">
						<span className="size-8 rounded-full border border-series-6" />
						{t("sessionInsights.subagents.legend.spawn")}
					</span>
					<span className="inline-flex items-center gap-4">
						<span className={cn("size-8 rounded-full", SERIES_SWATCH["series-3"])} />
						{t("sessionInsights.subagents.legend.model")}
					</span>
					<span className="inline-flex items-center gap-4">
						<span className="size-8 rounded-full bg-feedback-success" />
						{t("sessionInsights.subagents.legend.read")}
					</span>
					<span>{t("sessionInsights.subagents.legend.dashed")}</span>
					<span>{t("sessionInsights.subagents.legend.heuristic")}</span>
				</div>
				{view.waves.slice(0, shown).map((wave) => (
					<Wave key={wave.n} wave={wave} runs={view.runs} model={model} onOpen={onOpen} />
				))}
				{view.waves.length > shown ? (
					<Button
						variant="ghost"
						size="s"
						data-testid="subagents-more"
						onClick={() => setShown(view.waves.length)}
					>
						{t("sessionInsights.subagents.moreWaves", {
							count: view.waves.length - shown,
							n: formatCount(locale, view.waves.length - shown),
						})}
					</Button>
				) : null}
			</div>
		</div>
	);
}
