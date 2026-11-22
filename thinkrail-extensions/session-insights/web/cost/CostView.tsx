import {
	RiBarChartBoxLine,
	RiFireLine,
	RiLightbulbLine,
	RiSparkling2Line,
	RiUser3Line,
} from "@remixicon/react";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type { CostMoment, CostSpike, SessionCost } from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { causeText } from "../context/causes";
import { FigureBadge, type Sources } from "../FigureCell";
import { formatClock, formatCount, formatShare, formatTokens } from "../format";
import { ShareBar } from "../ShareBar";
import { StatFigure } from "../StatFigure";
import { diagnosisText, valueText } from "./diagnosis";

const W = 1000;
const H = 80;
const RANGES = 3;

function Evidence({ cost }: { cost: SessionCost }) {
	const t = useT();
	const locale = localeOf(t);
	const d = cost.diagnosis;
	const chips: { key: string; text: string; tone?: "warning" | "error" }[] = [];
	if (d.calls > 0)
		chips.push({
			key: "read",
			text: t("sessionInsights.cost.chip.read", {
				share: formatShare(locale, d.cacheReadShare, 1) ?? "",
			}),
		});
	if (d.calls > 0)
		chips.push({
			key: "median",
			text: d.compaction
				? t("sessionInsights.cost.chip.medianCompaction", {
						median: valueText(locale, cost, d.medianCall),
						before: valueText(locale, cost, d.compaction.beforeCall),
						beforeContext: formatTokens(locale, d.compaction.beforeContext),
						after: valueText(locale, cost, d.compaction.afterCall),
						afterContext: formatTokens(locale, d.compaction.afterContext),
					})
				: t("sessionInsights.cost.chip.median", { median: valueText(locale, cost, d.medianCall) }),
		});
	const high = d.highContext;
	const [only, ...others] = high?.models ?? [];
	if (high && only)
		chips.push({
			key: "high",
			tone: "warning",
			text:
				others.length === 0
					? t("sessionInsights.cost.chip.high", {
							calls: formatCount(locale, high.calls),
							threshold: formatTokens(locale, only.threshold),
							value: valueText(locale, cost, high.value),
						})
					: t("sessionInsights.cost.chip.highModels", {
							calls: formatCount(locale, high.calls),
							models: high.models
								.map((item) =>
									t("sessionInsights.cost.chip.highModel", {
										threshold: formatTokens(locale, item.threshold),
										model: item.model,
									}),
								)
								.join(", "),
							value: valueText(locale, cost, high.value),
						}),
		});
	if (d.rewrites)
		chips.push({
			key: "rewrites",
			tone: "error",
			text: t("sessionInsights.cost.chip.rewrites", {
				calls: formatCount(locale, d.rewrites.calls),
				value: valueText(locale, cost, d.rewrites.value),
			}),
		});
	return (
		<ul data-testid="cost-evidence" className="flex flex-wrap gap-4">
			{chips.map((chip) => (
				<li
					key={chip.key}
					className={cn(
						"rounded-full border px-8 py-2 tr-text-metadata",
						chip.tone === "warning"
							? "border-feedback-warning-muted text-feedback-warning"
							: chip.tone === "error"
								? "border-feedback-error-muted text-feedback-error"
								: "border-border-default text-text-muted",
					)}
				>
					{chip.text}
				</li>
			))}
		</ul>
	);
}

/** $ (or tokens) per call as bars with the context as a line, compaction rules and the top moments. */
function CostChart({ cost }: { cost: SessionCost }) {
	const t = useT();
	const locale = localeOf(t);
	const value = (call: SessionCost["calls"][number]) =>
		cost.headline === "tokens" ? call.tokens : call.cost;
	const values = cost.calls.map(value);
	const sorted = [...values].sort((a, b) => a - b);
	const p98 = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
	const max = Math.max(...values, 0);
	const cap = max > 0 ? Math.max(p98 * 1.5, max <= p98 * 2 ? max : p98 * 1.5) || max : 1;
	const n = Math.max(1, cost.calls.length);
	const x = (at: number) => ((at + 0.5) / n) * W;
	const barWidth = Math.max(0.6, (W / n) * 0.8);
	let bars = "";
	cost.calls.forEach((call, at) => {
		const h = (Math.min(value(call), cap) / cap) * (H - 2);
		if (h > 0)
			bars += `M${(x(at) - barWidth / 2).toFixed(2)} ${H}v${(-h).toFixed(2)}h${barWidth.toFixed(2)}v${h.toFixed(2)}z`;
	});
	const contextMax = Math.max(1, ...cost.calls.map((call) => call.context));
	const line = cost.calls
		.map(
			(call, at) =>
				`${at ? "L" : "M"}${x(at).toFixed(1)} ${(H - (call.context / contextMax) * (H - 2)).toFixed(1)}`,
		)
		.join(" ");
	const indexOf = new Map(cost.calls.map((call, at) => [call.id, at]));
	const over = cost.calls
		.map((call, at) => ({ call, at }))
		.filter(({ call }) => value(call) > cap)
		.sort((a, b) => value(b.call) - value(a.call))
		.slice(0, 2);
	const percent = (at: number) => `${((x(at) / W) * 100).toFixed(2)}%`;
	return (
		<figure data-testid="cost-chart" className="flex flex-col gap-4">
			<div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4">
				<div className="flex h-96 flex-col justify-between py-2 text-right tr-text-caption text-text-subtle tabular-nums">
					<span>{valueText(locale, cost, cap)}</span>
					<span>{valueText(locale, cost, 0)}</span>
				</div>
				<div className="relative h-96 border-border-default border-b">
					<svg
						aria-hidden="true"
						viewBox={`0 0 ${W} ${H}`}
						preserveAspectRatio="none"
						className="absolute inset-x-0 bottom-0 block h-80 w-full"
					>
						{cost.moments.slice(0, RANGES).map((moment) => {
							const from = moment.topCall ? indexOf.get(moment.topCall.id) : undefined;
							const calls = cost.calls
								.map((call, at) => ({ call, at }))
								.filter(({ call }) => call.t >= moment.t0 && call.t <= moment.t1);
							const first = calls[0]?.at ?? from;
							const last = calls.at(-1)?.at ?? from;
							if (first === undefined || last === undefined) return null;
							const left = Math.max(0, x(first) - barWidth);
							const right = Math.min(W, x(last) + barWidth);
							return (
								<rect
									key={moment.rank}
									x={left}
									y={0}
									width={Math.max(2, right - left)}
									height={H}
									className="fill-primary-subtle stroke-primary-muted"
									vectorEffect="non-scaling-stroke"
								/>
							);
						})}
						<path d={bars} className="fill-series-3" />
						<path
							d={line}
							className="fill-none stroke-feedback-warning"
							strokeWidth={1.4}
							vectorEffect="non-scaling-stroke"
						/>
						{cost.compactions.map((item) => {
							const at = item.after ? indexOf.get(item.after) : undefined;
							if (at === undefined) return null;
							return (
								<line
									key={item.id}
									x1={x(at) - W / n / 2}
									x2={x(at) - W / n / 2}
									y1={0}
									y2={H}
									className="stroke-series-7"
									strokeDasharray="4 3"
									vectorEffect="non-scaling-stroke"
								/>
							);
						})}
					</svg>
					<svg
						aria-hidden="true"
						width="100%"
						height="96"
						className="absolute inset-0 block overflow-visible"
					>
						{cost.moments.slice(0, RANGES).map((moment) => {
							const calls = cost.calls
								.map((call, at) => ({ call, at }))
								.filter(({ call }) => call.t >= moment.t0 && call.t <= moment.t1);
							const first = calls[0]?.at;
							if (first === undefined) return null;
							return (
								<text
									key={moment.rank}
									x={percent(first)}
									y={12}
									className="fill-primary tr-text-caption"
								>
									{moment.rank}
								</text>
							);
						})}
						{over.map(({ call, at }) => (
							<text
								key={call.id}
								data-testid="cost-spike-label"
								x={percent(at)}
								y={24}
								textAnchor="middle"
								className="fill-feedback-error tr-text-caption"
							>
								{valueText(locale, cost, value(call))}
							</text>
						))}
						{cost.compactions.map((item) => {
							const at = item.after ? indexOf.get(item.after) : undefined;
							if (at === undefined) return null;
							return (
								<text
									key={item.id}
									x={percent(at)}
									y={36}
									className="fill-series-7 tr-text-caption"
								>
									{t("sessionInsights.cost.compaction")}
								</text>
							);
						})}
					</svg>
				</div>
				<span />
				<span className="flex justify-between tr-text-caption text-text-subtle tabular-nums">
					<span>{t("sessionInsights.context.callShort", { n: 1 })}</span>
					<span>{t("sessionInsights.context.callShort", { n: cost.calls.length })}</span>
				</span>
			</div>
			<figcaption className="flex flex-wrap items-center gap-x-12 gap-y-4 tr-text-caption text-text-muted">
				<span className="inline-flex items-center gap-4">
					<span className="size-8 rounded-sm bg-series-3" />
					{t(
						cost.headline === "tokens"
							? "sessionInsights.cost.legend.tokens"
							: "sessionInsights.cost.legend.cost",
						{ cap: valueText(locale, cost, cap) },
					)}
				</span>
				<span className="inline-flex items-center gap-4">
					<span className="h-2 w-12 rounded-sm bg-feedback-warning" />
					{t("sessionInsights.cost.legend.context", { max: formatTokens(locale, contextMax) })}
				</span>
				<span className="inline-flex items-center gap-4">
					<span className="size-8 rounded-sm border border-primary-muted bg-primary-subtle" />
					{t("sessionInsights.cost.legend.moments")}
				</span>
				<span className="inline-flex items-center gap-4">
					<span className="h-2 w-12 rounded-sm bg-series-7" />
					{t("sessionInsights.cost.legend.compaction")}
				</span>
			</figcaption>
		</figure>
	);
}

function momentTitle(t: Translator, moment: CostMoment): string {
	if (moment.stepId !== null)
		return t("sessionInsights.cost.momentStep", {
			n: moment.stepN ?? 0,
			title: moment.stepTitle ?? "",
		});
	if (moment.turnN !== null)
		return t("sessionInsights.cost.momentTurn", { n: moment.turnN, title: moment.stepTitle ?? "" });
	return t("sessionInsights.cost.momentOutside");
}

function MomentRow({
	cost,
	moment,
	maxValue,
	onOpen,
}: {
	cost: SessionCost;
	moment: CostMoment;
	maxValue: number;
	onOpen: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const value = cost.headline === "tokens" ? (moment.tokens.value ?? 0) : (moment.cost.value ?? 0);
	const tools = moment.tools.map((tool) => `${tool.name} ×${tool.n}`).join(", ");
	return (
		<li
			data-testid="cost-moment"
			data-rank={moment.rank}
			className="grid grid-cols-[1.5rem_9rem_minmax(0,1fr)_auto] items-center gap-8 border-border-default border-b px-8 py-4"
		>
			<span className="grid size-20 place-items-center rounded-full border border-primary-muted tr-text-caption text-primary tabular-nums">
				{moment.rank}
			</span>
			<span className="grid grid-cols-[4rem_minmax(0,1fr)_2.5rem] items-center gap-4">
				<span className="truncate tr-text-ui text-text-default tabular-nums">
					{valueText(locale, cost, value)}
				</span>
				<ShareBar total={maxValue} parts={[{ key: "value", value, fill: "fill-series-3" }]} />
				<span className="text-right tr-text-caption text-text-muted tabular-nums">
					{formatShare(locale, moment.share, 1) ?? ""}
				</span>
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="flex min-w-0 items-center gap-6 tr-text-metadata text-text-default">
					<span className="truncate">{momentTitle(t, moment)}</span>
					{moment.phase ? (
						<span className="shrink-0 rounded-sm border border-series-7 px-4 tr-text-caption text-series-7">
							{t(
								moment.phase === "beforeCompaction"
									? "sessionInsights.cost.beforeCompaction"
									: "sessionInsights.cost.afterCompaction",
							)}
						</span>
					) : null}
				</span>
				<span className="truncate tr-text-metadata text-text-muted tabular-nums">
					{t("sessionInsights.cost.momentMeta", {
						from: formatClock(locale, moment.t0, false),
						to: formatClock(locale, moment.t1, false),
						calls: formatCount(locale, moment.llmCalls),
						perCall: valueText(locale, cost, moment.perCall),
						min: formatTokens(locale, moment.contextMin),
						max: formatTokens(locale, moment.contextMax),
					})}
					{moment.errors > 0 ? ` · ${t("sessionInsights.cost.errors", { n: moment.errors })}` : ""}
					{tools ? ` · ${tools}` : ""}
				</span>
			</span>
			<span className="flex flex-col items-end gap-2">
				{moment.topCall ? (
					<button
						type="button"
						data-testid="cost-moment-call"
						onClick={() => moment.topCall && onOpen(moment.topCall.id)}
						className="inline-flex items-center gap-4 rounded-sm tr-text-caption text-text-default hover:underline focus-visible:focus-ring"
					>
						<RiSparkling2Line aria-hidden className="size-12 shrink-0 text-series-3" />
						{t("sessionInsights.cost.openCall", {
							n: moment.topCall.n,
							value: valueText(
								locale,
								cost,
								cost.headline === "tokens" ? moment.topCall.tokens : moment.topCall.cost,
							),
						})}
					</button>
				) : null}
				{moment.turnId && moment.turnN !== null ? (
					<button
						type="button"
						data-testid="cost-moment-prompt"
						onClick={() => moment.turnId && onOpen(moment.turnId)}
						className="inline-flex items-center gap-4 rounded-sm tr-text-caption text-primary hover:underline focus-visible:focus-ring"
					>
						<RiUser3Line aria-hidden className="size-12 shrink-0" />
						{t("sessionInsights.cost.openPrompt", { n: moment.turnN })}
					</button>
				) : null}
			</span>
		</li>
	);
}

function SpikeRow({
	cost,
	spike,
	onOpen,
}: {
	cost: SessionCost;
	spike: CostSpike;
	onOpen: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const why = spike.causes.map((cause) => causeText(t, cause, spike.gapMs));
	return (
		<li
			data-testid="cost-spike"
			className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-8 border-border-default border-b px-8 py-4"
		>
			<span className="tr-text-ui text-feedback-error tabular-nums">
				{valueText(locale, cost, cost.headline === "tokens" ? spike.tokens : spike.cost)}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate tr-text-metadata text-text-default tabular-nums">
					{t("sessionInsights.cost.spikeLine", {
						n: spike.n,
						time: formatClock(locale, spike.t, true),
						written: formatCount(locale, spike.cacheWrite),
						size: formatCount(locale, spike.context),
						read: formatCount(locale, spike.cacheRead),
					})}
				</span>
				<span className="flex min-w-0 flex-wrap items-center gap-4 tr-text-metadata text-text-muted">
					{spike.firstOfTurn && spike.turnN !== null ? (
						<span>{`${t("sessionInsights.cost.firstOfTurn", { n: spike.turnN })} ·`}</span>
					) : null}
					{why.length > 0 ? (
						<span data-testid="cost-spike-cause">{why.join(" · ")}</span>
					) : (
						<span
							data-testid="cost-spike-cause"
							data-unexplained="true"
							className="rounded-sm border border-border-default border-dashed px-4 text-text-subtle"
						>
							{t("sessionInsights.cost.notDerivable")}
						</span>
					)}
					<FigureBadge origin="approximated" />
				</span>
			</span>
			<Button variant="ghost" size="s" iconLeft={RiSparkling2Line} onClick={() => onOpen(spike.id)}>
				{t("sessionInsights.cost.openSpike")}
			</Button>
		</li>
	);
}

/**
 * Why the session cost what it did: a one-line diagnosis from a fixed template over measured figures,
 * the evidence behind it, $ (or tokens) per call with the context line, the costliest moments linked to
 * their call and prompt, and the calls that rewrote a large context to the cache. Never an LLM.
 */
export function CostView({
	cost,
	sources,
	onShowInTrace,
}: {
	cost: SessionCost;
	sources: Sources;
	onShowInTrace: (id: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [order, setOrder] = useState<"value" | "time">("value");
	const total = cost.total.value ?? 0;
	const moments =
		order === "value"
			? cost.moments
			: [...cost.moments].sort((a, b) => a.t0 - b.t0 || a.rank - b.rank);
	const maxValue = Math.max(
		1e-9,
		...cost.moments.map((moment) =>
			cost.headline === "tokens" ? (moment.tokens.value ?? 0) : (moment.cost.value ?? 0),
		),
	);
	return (
		<div data-testid="cost-view" className="flex h-full min-h-0 flex-col overflow-y-auto">
			<section className="flex flex-col gap-8 border-border-default border-b p-12">
				<p
					data-testid="cost-diagnosis"
					data-kind={cost.diagnosis.kind}
					className="flex items-start gap-8 tr-text-ui text-text-default"
				>
					<RiLightbulbLine aria-hidden className="mt-2 size-16 shrink-0 text-feedback-warning" />
					<span>{diagnosisText(t, locale, cost)}</span>
				</p>
				<span className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.cost.diagnosisNote")}
				</span>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-8">
					<StatFigure
						testId="cost-total"
						label={t(
							cost.headline === "tokens"
								? "sessionInsights.cost.totalTokens"
								: "sessionInsights.cost.total",
						)}
						sources={sources}
						figures={[
							{
								metric: cost.headline === "tokens" ? "tokens" : "cost",
								origin: cost.total.origin,
								exact: valueText(locale, cost, total),
							},
						]}
						sub={cost.headline === "tokens" ? t("sessionInsights.cost.notRecorded") : undefined}
					>
						{valueText(locale, cost, total)}
					</StatFigure>
					<StatFigure
						testId="cost-calls"
						label={t("sessionInsights.cost.calls")}
						sources={sources}
						figures={[
							{
								metric: "callCost",
								origin: "counted",
								exact: formatCount(locale, cost.calls.length),
							},
						]}
					>
						{formatCount(locale, cost.calls.length)}
					</StatFigure>
					<StatFigure
						testId="cost-summaries"
						label={t("sessionInsights.cost.summaries")}
						sources={sources}
						figures={[
							{
								metric: cost.headline === "tokens" ? "tokens" : "cost",
								origin: cost.summaries.origin,
								exact: valueText(locale, cost, cost.summaries.value ?? 0),
							},
						]}
					>
						{valueText(locale, cost, cost.summaries.value ?? 0)}
					</StatFigure>
				</div>
				<Evidence cost={cost} />
				<CostChart cost={cost} />
			</section>
			<section className="flex flex-col gap-4 p-12">
				<header className="flex flex-wrap items-center gap-8">
					<span className="flex items-center gap-6 tr-text-emphasis text-text-default">
						<RiBarChartBoxLine aria-hidden className="size-16 shrink-0" />
						{t("sessionInsights.cost.momentsTitle")}
					</span>
					<span className="tr-text-caption text-text-subtle">
						{t("sessionInsights.cost.momentsNote")}
					</span>
					<fieldset aria-label={t("sessionInsights.cost.order")} className="ml-auto flex gap-4">
						<ToggleSegment
							testid="cost-order-value"
							label={t(
								cost.headline === "tokens"
									? "sessionInsights.cost.byTokens"
									: "sessionInsights.cost.byCost",
							)}
							active={order === "value"}
							onClick={() => setOrder("value")}
						/>
						<ToggleSegment
							testid="cost-order-time"
							label={t("sessionInsights.cost.byTime")}
							active={order === "time"}
							onClick={() => setOrder("time")}
						/>
					</fieldset>
				</header>
				{moments.length === 0 ? (
					<p className="tr-text-metadata text-text-muted">{t("sessionInsights.cost.noMoments")}</p>
				) : (
					<ol data-testid="cost-moments" className="flex flex-col">
						{moments.map((moment) => (
							<MomentRow
								key={moment.rank}
								cost={cost}
								moment={moment}
								maxValue={maxValue}
								onOpen={onShowInTrace}
							/>
						))}
					</ol>
				)}
				{cost.rest.moments > 0 ? (
					<span className="px-8 tr-text-caption text-text-subtle">
						{t("sessionInsights.cost.rest", {
							count: cost.rest.moments,
							n: cost.rest.moments,
							value: valueText(locale, cost, cost.rest.value),
						})}
					</span>
				) : null}
			</section>
			{cost.spikes.length > 0 ? (
				<section className="flex flex-col gap-4 p-12 pt-0">
					<header className="flex items-center gap-6 tr-text-emphasis text-text-default">
						<RiFireLine aria-hidden className="size-16 shrink-0 text-feedback-error" />
						{t("sessionInsights.cost.spikesTitle")}
						<span className="tr-text-caption text-text-subtle">
							{t("sessionInsights.cost.spikesNote")}
						</span>
					</header>
					<ul data-testid="cost-spikes" className="flex flex-col">
						{cost.spikes.map((spike) => (
							<SpikeRow key={spike.id} cost={cost} spike={spike} onOpen={onShowInTrace} />
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
