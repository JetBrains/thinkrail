import { useT } from "@thinkrail/locales/react";
import type { MetricId, Origin } from "@thinkrail/pi-session-insights/core";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import {
	BADGE_TEXT,
	type BadgedOrigin,
	isBadged,
	METRIC_HOW,
	ORIGIN_LABEL,
	ORIGIN_NOTE,
} from "./copy";
import { type GridCell, gridAttributes } from "./grid";

export interface FigureView {
	metric: MetricId;
	origin: Origin;
	exact: string | null;
	detail?: string | undefined;
}

export type Sources = Readonly<Record<MetricId, readonly string[]>>;

const PILL = "inline-flex shrink-0 items-center rounded-full border px-4 tr-text-caption";

export const FIGURE_X = "px-8 @max-[1152px]:px-4";

const BADGE_TONE = {
	approximated: "border-feedback-warning-muted text-feedback-warning",
	partiallyRecorded: "border-feedback-warning-muted text-feedback-warning",
	notRecorded: "border-border-default text-text-subtle",
	notMeasured: "border-border-default text-text-subtle",
} as const satisfies Record<BadgedOrigin, string>;

export function Pill({
	className,
	testId,
	children,
}: {
	className: string;
	testId: string;
	children: ReactNode;
}) {
	return (
		<span data-testid={testId} className={cn(PILL, className)}>
			{children}
		</span>
	);
}

export function FigureBadge({
	origin,
	legend = false,
}: {
	origin: BadgedOrigin;
	legend?: boolean;
}) {
	const t = useT();
	return (
		<span
			data-testid={legend ? "session-insights-legend-badge" : "session-insights-badge"}
			data-origin={origin}
			aria-hidden={legend ? true : undefined}
			className={cn(PILL, BADGE_TONE[origin])}
		>
			<span aria-hidden="true">{t(BADGE_TEXT[origin])}</span>
			{legend ? null : <span className="sr-only">{t(ORIGIN_LABEL[origin])}</span>}
		</span>
	);
}

export function FigureValue({ text, origin }: { text: string; origin: Origin }) {
	return (
		<span className="inline-flex min-w-0 max-w-full items-center justify-end gap-4">
			<span className="min-w-0 truncate tabular-nums">{text}</span>
			{isBadged(origin) ? <FigureBadge origin={origin} /> : null}
		</span>
	);
}

function FigureSection({ figure, sources }: { figure: FigureView; sources: Sources }) {
	const t = useT();
	const { origin } = figure;
	const fields = sources[figure.metric] ?? [];
	return (
		<div data-testid="session-insights-figure" data-metric={figure.metric} data-origin={origin}>
			<div className="flex items-baseline gap-8">
				<span className="tr-text-emphasis text-text-default">{t(ORIGIN_LABEL[origin])}</span>
				{figure.exact !== null ? (
					<span className="ml-auto tabular-nums text-text-default">{figure.exact}</span>
				) : null}
			</div>
			{figure.detail ? <p className="text-text-muted tabular-nums">{figure.detail}</p> : null}
			<p className="text-text-muted">
				<span className="text-text-default">{t("sessionInsights.figure.how")}</span>{" "}
				{t(METRIC_HOW[figure.metric])}
			</p>
			{isBadged(origin) ? <p className="text-text-muted">{t(ORIGIN_NOTE[origin])}</p> : null}
			{fields.length > 0 ? (
				<p className="text-text-muted">
					<span className="text-text-default">{t("sessionInsights.figure.source")}</span>{" "}
					<code className="tr-code-text-small text-text-muted">{fields.join(", ")}</code>
				</p>
			) : null}
		</div>
	);
}

export function FigureDetails({
	figures,
	sources,
}: {
	figures: readonly FigureView[];
	sources: Sources;
}) {
	return (
		<div className="flex max-w-320 flex-col gap-8 py-2">
			{figures.map((figure) => (
				<FigureSection key={figure.metric} figure={figure} sources={sources} />
			))}
		</div>
	);
}

export function FigureCell({
	figures,
	sources,
	cell,
	testId,
	className,
	children,
}: {
	figures: readonly FigureView[];
	sources: Sources;
	cell: GridCell;
	testId: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<td data-testid={testId} className={cn("overflow-hidden p-0 align-top", className)}>
			<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="end">
				<button
					type="button"
					{...gridAttributes(cell)}
					className={cn(
						"flex w-full min-w-0 flex-col items-end py-4 text-right tr-text-ui focus-visible:focus-ring-inset",
						FIGURE_X,
					)}
				>
					{children}
				</button>
			</IconTooltip>
		</td>
	);
}
