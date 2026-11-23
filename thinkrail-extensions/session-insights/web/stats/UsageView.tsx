import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type { StatsUsageResult, UsageSeries } from "@thinkrail/pi-session-insights/core";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { useId, useState } from "react";
import { FigureBadge } from "../FigureCell";
import { formatCost, formatCostExact, formatCount, formatTokens } from "../format";
import { Tabs, tabPanel } from "../Tabs";
import { DEFAULT_STATS_VIEW, type UsageOptions } from "../viewState";
import { MARKER_NOTE } from "./copy";
import {
	dayLabel,
	seriesFill,
	swatchOf,
	type UsageBy,
	UsageChart,
	type UsageMetric,
	valueText,
} from "./UsageChart";
import {
	costText,
	FigCell,
	type ShowSessions,
	TABLE_NOTE,
	TABS,
	tokensCell,
	type UsageTab,
	UsageTable,
} from "./UsageTables";

export function seriesLabel(t: Translator, series: UsageSeries): string {
	switch (series.kind) {
		case "model":
			return series.key;
		case "project":
			return series.name ?? t("sessionInsights.group.unregistered");
		case "otherModels":
			return t("sessionInsights.usage.series.otherModels");
		case "otherProjects":
			return t("sessionInsights.usage.series.otherProjects");
		case "subagents":
			return t("sessionInsights.usage.series.subagents");
		case "other":
			return t("sessionInsights.usage.series.other");
		case "outside":
			return t("sessionInsights.usage.series.outside");
	}
}

/**
 * Usage and cost across sessions: per-day spend stacked by model or project on a calendar axis with
 * change markers (tokens where no cost is recorded), then sortable tables whose rows filter the list.
 */
export function UsageView({
	result,
	onShowSessions,
	initialOptions = DEFAULT_STATS_VIEW.usage,
	onOptions,
}: {
	result: StatsUsageResult;
	onShowSessions: ShowSessions;
	initialOptions?: UsageOptions;
	onOptions?: (options: UsageOptions) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { usage, sources } = result;
	const [options, setOptions] = useState<UsageOptions>(initialOptions);
	const metric: UsageMetric = options.metric ?? usage.headline;
	const { by, withOutside, tab } = options;
	const choose = (patch: Partial<UsageOptions>) => {
		const next = { ...options, ...patch };
		setOptions(next);
		onOptions?.(next);
	};
	const setMetric = (next: UsageMetric) => choose({ metric: next });
	const setBy = (next: UsageBy) => choose({ by: next });
	const setWithOutside = (next: boolean) => choose({ withOutside: next });
	const setTab = (next: UsageTab) => choose({ tab: next });
	const tabsId = useId();
	const series = by === "model" ? usage.byModel : usage.byProject;
	const tokensTotal = usage.totals.tokens.value?.total ?? 0;
	const outside = usage.totals.outside.value;
	return (
		<div data-testid="usage-view" className="flex flex-col gap-8 p-12">
			<div className="flex flex-wrap items-center gap-8">
				<span className="tr-text-emphasis text-text-default">
					{t("sessionInsights.usage.title")}
				</span>
				<span className="flex items-center gap-12 tr-text-metadata text-text-muted">
					<span className="flex items-center gap-4">
						{t("sessionInsights.usage.tokens")}
						<FigCell
							sources={sources}
							testId="usage-total-tokens"
							cell={{
								...tokensCell(locale, usage.totals.tokens),
								detail: usage.totals.tokens.value
									? t("sessionInsights.figure.tokenBreakdown", {
											input: formatCount(locale, usage.totals.tokens.value.input),
											output: formatCount(locale, usage.totals.tokens.value.output),
											cacheRead: formatCount(locale, usage.totals.tokens.value.cacheRead),
											cacheWrite: formatCount(locale, usage.totals.tokens.value.cacheWrite),
										})
									: undefined,
							}}
						/>
					</span>
					<span className="flex items-center gap-4">
						{t("sessionInsights.usage.cost")}
						<FigCell
							sources={sources}
							testId="usage-total-cost"
							cell={{
								text: costText(t, locale, usage.totals.cost, tokensTotal),
								origin: usage.totals.cost.origin,
								metric: "cost",
								exact: formatCostExact(locale, usage.totals.cost.value ?? 0),
							}}
						/>
					</span>
					{outside && (outside.cost > 0 || outside.tokens > 0) ? (
						<span data-testid="usage-total-outside" className="flex items-center gap-4">
							<FigCell
								sources={sources}
								cell={{
									text:
										outside.cost > 0
											? t("sessionInsights.usage.outsideCost", {
													cost: formatCost(locale, outside.cost),
												})
											: t("sessionInsights.usage.outsideTokens", {
													tokens: formatTokens(locale, outside.tokens),
												}),
									origin: usage.totals.outside.origin,
									metric: "subagentsOutside",
								}}
							/>
						</span>
					) : null}
				</span>
				<span className="ml-auto flex flex-wrap items-center gap-4">
					<fieldset
						aria-label={t("sessionInsights.usage.metric")}
						className="flex items-center gap-2"
					>
						<ToggleSegment
							testid="usage-metric-cost"
							label={t("sessionInsights.usage.cost")}
							active={metric === "cost"}
							onClick={() => setMetric("cost")}
						/>
						<ToggleSegment
							testid="usage-metric-tokens"
							label={t("sessionInsights.usage.tokens")}
							active={metric === "tokens"}
							onClick={() => setMetric("tokens")}
						/>
					</fieldset>
					<fieldset
						aria-label={t("sessionInsights.usage.split")}
						className="flex items-center gap-2 border-border-default border-l pl-4"
					>
						<ToggleSegment
							testid="usage-by-model"
							label={t("sessionInsights.usage.byModel")}
							active={by === "model"}
							onClick={() => setBy("model")}
						/>
						<ToggleSegment
							testid="usage-by-project"
							label={t("sessionInsights.usage.byProject")}
							active={by === "project"}
							onClick={() => setBy("project")}
						/>
					</fieldset>
					{usage.outside ? (
						<ToggleSegment
							testid="usage-outside-toggle"
							label={t("sessionInsights.usage.withOutside")}
							active={withOutside}
							onClick={() => setWithOutside(!withOutside)}
						/>
					) : null}
				</span>
			</div>
			{usage.days.length === 0 ? (
				<p data-testid="usage-empty" className="p-16 text-center tr-text-ui text-text-muted">
					{t("sessionInsights.usage.empty")}
				</p>
			) : (
				<>
					<UsageChart
						usage={usage}
						series={series}
						metric={metric}
						withOutside={withOutside}
						labelOf={(item) => seriesLabel(t, item)}
					/>
					<ul
						data-testid="usage-legend"
						className="flex flex-wrap gap-x-12 gap-y-2 tr-text-metadata text-text-muted"
					>
						{series.map((item, at) => (
							<li key={item.key} className="flex min-w-0 items-center gap-4">
								<span
									aria-hidden
									className={cn("size-8 shrink-0 rounded-sm", swatchOf(seriesFill(item, at)))}
								/>
								<span className="truncate">{seriesLabel(t, item)}</span>
								<span className="tabular-nums text-text-subtle">
									{metric === "cost" && item.costOrigin === "notRecorded"
										? t("sessionInsights.usage.costNotRecorded", {
												tokens: formatTokens(locale, item.totalTokens),
											})
										: valueText(
												locale,
												metric,
												metric === "cost" ? item.totalCost : item.totalTokens,
											)}
								</span>
								{metric === "cost" &&
								item.costOrigin !== "recorded" &&
								item.costOrigin !== "notRecorded" ? (
									<FigureBadge origin="partiallyRecorded" />
								) : null}
							</li>
						))}
						{withOutside && usage.outside ? (
							<li className="flex items-center gap-4">
								<span
									aria-hidden
									className="size-8 shrink-0 rounded-sm border border-series-6 border-dashed"
								/>
								<span>{seriesLabel(t, usage.outside)}</span>
								<span className="tabular-nums text-text-subtle">
									{valueText(
										locale,
										metric,
										metric === "cost" ? usage.outside.totalCost : usage.outside.totalTokens,
									)}
								</span>
							</li>
						) : null}
					</ul>
					{usage.markers.length > 0 ? (
						<ul
							data-testid="usage-markers"
							className="flex flex-col gap-2 tr-text-metadata text-text-muted"
						>
							{usage.markers.map((marker) => (
								<li
									key={`${marker.kind}:${marker.day}:${marker.model ?? ""}`}
									data-kind={marker.kind}
								>
									{t(MARKER_NOTE[marker.kind], {
										day: dayLabel(locale, marker.day, true),
										model: marker.model ?? "",
									})}
								</li>
							))}
						</ul>
					) : null}
				</>
			)}
			<Tabs
				id={tabsId}
				label={t("sessionInsights.usage.tables")}
				tabs={TABS.map((item) => ({
					id: item.id,
					label: t(item.label),
					testId: `usage-tab-${item.id}`,
				}))}
				value={tab}
				onChange={setTab}
				className="flex flex-wrap items-center gap-2 border-border-default border-b"
				tabClassName="px-8 py-4"
			/>
			<div {...tabPanel(tabsId, tab)}>
				<UsageTable tab={tab} result={result} onShowSessions={onShowSessions} />
			</div>
			<p className="tr-text-metadata text-text-subtle">
				{t(TABLE_NOTE[tab], {
					count: usage.listingSessions,
					listing: formatCount(locale, usage.listingSessions),
					days: usage.sparkDays,
				})}
			</p>
		</div>
	);
}
