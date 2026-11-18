import { localeOf, useT } from "@thinkrail/locales/react";
import type { StatsUsage, UsageSeries } from "@thinkrail/pi-session-insights/core";
import { cn } from "@thinkrail/ui/utils";
import { type PointerEvent, useState } from "react";
import { formatCost, formatTokens } from "../format";
import { MARKER_LABEL } from "./copy";

const W = 1000;
const H = 160;
const MODEL_FILLS = [
	"fill-series-3",
	"fill-series-1",
	"fill-series-5",
	"fill-series-2",
	"fill-series-7",
	"fill-series-4",
];
const PROJECT_FILLS = [
	"fill-series-1",
	"fill-series-2",
	"fill-series-3",
	"fill-series-4",
	"fill-series-5",
	"fill-series-7",
];
const SWATCHES: Readonly<Record<string, string>> = {
	"fill-series-1": "bg-series-1",
	"fill-series-2": "bg-series-2",
	"fill-series-3": "bg-series-3",
	"fill-series-4": "bg-series-4",
	"fill-series-5": "bg-series-5",
	"fill-series-6": "bg-series-6",
	"fill-series-7": "bg-series-7",
	"fill-series-8": "bg-series-8",
	"fill-text-subtle": "bg-text-subtle",
};

export type UsageMetric = "cost" | "tokens";
export type UsageBy = "model" | "project";

/** A series' fill: models and projects by rank, the rest by kind (subagents in their own series). */
export function seriesFill(series: UsageSeries, at: number): string {
	switch (series.kind) {
		case "model":
			return MODEL_FILLS[at % MODEL_FILLS.length] ?? "fill-series-8";
		case "project":
			return PROJECT_FILLS[at % PROJECT_FILLS.length] ?? "fill-series-8";
		case "subagents":
			return "fill-series-6";
		case "other":
			return "fill-text-subtle";
		default:
			return "fill-series-8";
	}
}

export function swatchOf(fill: string): string {
	return SWATCHES[fill] ?? "bg-series-8";
}

export function valueText(locale: string, metric: UsageMetric, value: number): string {
	return metric === "cost" ? formatCost(locale, value) : formatTokens(locale, value);
}

function niceMax(value: number): number {
	if (value <= 0) return 1;
	const power = 10 ** Math.floor(Math.log10(value));
	for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
	return 10 * power;
}

/** The day `YYYY-MM-DD` as a short local date (the server cut the days in the host's zone). */
export function dayLabel(locale: string, day: string, withYear = false): string {
	const [year, month, date] = day.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		...(withYear ? { year: "numeric" } : {}),
	}).format(new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1));
}

/**
 * Stacked per-day bars of the server's series on a calendar axis, the subagent spend outside pi's total
 * as a dashed segment on top, and the change markers. Pixels and the axis are presentation.
 */
export function UsageChart({
	usage,
	series,
	metric,
	withOutside,
	labelOf,
}: {
	usage: StatsUsage;
	series: readonly UsageSeries[];
	metric: UsageMetric;
	withOutside: boolean;
	labelOf: (series: UsageSeries) => string;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [hover, setHover] = useState<number | null>(null);
	const days = usage.days;
	const n = Math.max(1, days.length);
	const valuesOf = (item: UsageSeries) => (metric === "cost" ? item.cost : item.tokens);
	const outside = withOutside ? usage.outside : null;
	const tops = days.map(
		(_, at) =>
			series.reduce((height, item) => height + (valuesOf(item)[at] ?? 0), 0) +
			(outside ? (valuesOf(outside)[at] ?? 0) : 0),
	);
	const max = niceMax(Math.max(0, ...tops));
	const band = W / n;
	const width = Math.max(0.8, band * 0.78);
	const y = (value: number) => H - (value / max) * H;
	const x = (at: number) => at * band + (band - width) / 2;
	const paths = series.map((item, rank) => ({ item, rank, d: "" }));
	const base = new Array<number>(days.length).fill(0);
	for (const path of paths) {
		const values = valuesOf(path.item);
		values.forEach((value, at) => {
			if (value <= 0) return;
			const bottom = base[at] ?? 0;
			const top = bottom + value;
			base[at] = top;
			const y0 = y(bottom);
			const y1 = y(top);
			path.d += `M${x(at).toFixed(2)} ${y1.toFixed(2)}h${width.toFixed(2)}v${Math.max(0.5, y0 - y1).toFixed(2)}h${(-width).toFixed(2)}z`;
		});
	}
	let outsidePath = "";
	if (outside)
		valuesOf(outside).forEach((value, at) => {
			if (value <= 0) return;
			const bottom = base[at] ?? 0;
			outsidePath += `M${x(at).toFixed(2)} ${y(bottom + value).toFixed(2)}h${width.toFixed(2)}v${Math.max(0.5, y(bottom) - y(bottom + value)).toFixed(2)}h${(-width).toFixed(2)}z`;
		});
	const percent = (at: number) => `${(((at + 0.5) / n) * 100).toFixed(2)}%`;
	const step = Math.max(1, Math.ceil(n / 8));
	const ticks = days.flatMap((day, at) => (at % step === 0 || at === n - 1 ? [{ day, at }] : []));
	const pick = (event: PointerEvent<HTMLDivElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		if (box.width <= 0) return;
		const at = Math.floor(((event.clientX - box.left) / box.width) * n);
		setHover(Math.max(0, Math.min(n - 1, at)));
	};
	const hovered = hover !== null && hover < days.length ? hover : null;
	return (
		<figure data-testid="usage-chart" data-days={days.length} className="flex flex-col gap-4">
			<div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4">
				<div className="flex h-160 flex-col justify-between text-right tr-text-caption text-text-subtle tabular-nums">
					<span>{valueText(locale, metric, max)}</span>
					<span>{valueText(locale, metric, max / 2)}</span>
					<span>{valueText(locale, metric, 0)}</span>
				</div>
				<div
					className="relative h-160 border-border-default border-b"
					onPointerMove={pick}
					onPointerLeave={() => setHover(null)}
				>
					<svg
						aria-hidden="true"
						viewBox={`0 0 ${W} ${H}`}
						preserveAspectRatio="none"
						className="absolute inset-0 block h-full w-full"
					>
						<line
							x1={0}
							x2={W}
							y1={H / 2}
							y2={H / 2}
							className="stroke-border-muted"
							strokeDasharray="3 4"
							vectorEffect="non-scaling-stroke"
						/>
						{hovered !== null ? (
							<rect
								x={hovered * band}
								y={0}
								width={band}
								height={H}
								className="fill-control-bg-hovered"
							/>
						) : null}
						{paths.map((path) => (
							<path
								key={path.item.key}
								data-testid="usage-series"
								data-key={path.item.key}
								data-kind={path.item.kind}
								d={path.d}
								className={seriesFill(path.item, path.rank)}
							/>
						))}
						{outsidePath ? (
							<path
								data-testid="usage-outside"
								d={outsidePath}
								className="fill-none stroke-series-6"
								strokeDasharray="3 2"
								vectorEffect="non-scaling-stroke"
							/>
						) : null}
						{usage.markers.map((marker) => {
							const at = days.indexOf(marker.day);
							if (at < 0) return null;
							return (
								<line
									key={`${marker.kind}:${marker.day}:${marker.model ?? ""}`}
									x1={at * band}
									x2={at * band}
									y1={0}
									y2={H}
									className="stroke-feedback-warning"
									strokeDasharray="4 3"
									vectorEffect="non-scaling-stroke"
								/>
							);
						})}
					</svg>
					<svg
						aria-hidden="true"
						width="100%"
						height="160"
						className="pointer-events-none absolute inset-0 block overflow-visible"
					>
						{usage.markers.map((marker, index) => {
							const at = days.indexOf(marker.day);
							if (at < 0) return null;
							return (
								<text
									key={`${marker.kind}:${marker.day}:${marker.model ?? ""}`}
									x={`${((at / n) * 100).toFixed(2)}%`}
									dx={4}
									y={12 + index * 12}
									textAnchor={at / n > 0.6 ? "end" : "start"}
									className="fill-feedback-warning tr-text-caption"
								>
									{t(MARKER_LABEL[marker.kind], {
										day: dayLabel(locale, marker.day),
										model: marker.model ?? "",
									})}
								</text>
							);
						})}
					</svg>
				</div>
				<span />
				<svg aria-hidden="true" width="100%" height="16" className="block overflow-visible">
					{ticks.map(({ day, at }) => (
						<text
							key={day}
							x={percent(at)}
							y={12}
							textAnchor={at === 0 ? "start" : at === n - 1 ? "end" : "middle"}
							className="fill-text-subtle tr-text-caption"
						>
							{dayLabel(locale, day)}
						</text>
					))}
				</svg>
			</div>
			<figcaption
				data-testid="usage-hover"
				className={cn(
					"min-h-16 truncate tr-text-metadata tabular-nums",
					hovered === null ? "text-text-subtle" : "text-text-muted",
				)}
			>
				{hovered === null
					? t("sessionInsights.usage.hoverHint")
					: [
							dayLabel(locale, days[hovered] ?? "", true),
							...series.flatMap((item) => {
								const value = valuesOf(item)[hovered] ?? 0;
								return value > 0 ? [`${labelOf(item)} ${valueText(locale, metric, value)}`] : [];
							}),
							...(outside && (valuesOf(outside)[hovered] ?? 0) > 0
								? [
										t("sessionInsights.usage.outsideValue", {
											value: valueText(locale, metric, valuesOf(outside)[hovered] ?? 0),
										}),
									]
								: []),
						].join(" · ")}
			</figcaption>
		</figure>
	);
}
