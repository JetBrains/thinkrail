import {
	RiArrowDownSLine,
	RiArrowLeftRightLine,
	RiFilter3Line,
	RiInformationLine,
} from "@remixicon/react";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	CompareMetric,
	CompareMetricId,
	CompareVerdict,
	SessionRef,
	SliceBy,
	SliceConfound,
	SliceOption,
	SlicesCompareResult,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type FormEvent, useState } from "react";
import { sessionName } from "../copy";
import {
	formatCost,
	formatCount,
	formatDay,
	formatDuration,
	formatPercent,
	formatSigned,
	formatTokens,
} from "../format";
import type { SliceChoice } from "./api";
import { COMPARE_METRIC_LABEL, COMPARE_STAT_LABEL, SLICE_BY_LABEL, VERDICT_LABEL } from "./copy";
import { Fig } from "./Fig";

const BYS: readonly SliceBy[] = ["model", "period", "project", "label", "filter"];
const LIST = 6;

const VERDICT_TONE = {
	none: "border-transparent text-text-subtle",
	better: "border-feedback-success-muted bg-feedback-success-subtle text-feedback-success",
	worse: "border-feedback-error-muted bg-feedback-error-subtle text-feedback-error",
	higher: "border-feedback-info-muted bg-feedback-info-subtle text-feedback-info",
	lower: "border-feedback-info-muted bg-feedback-info-subtle text-feedback-info",
	same: "border-transparent bg-control-bg text-text-muted",
	noData: "border-border-default border-dashed text-text-subtle",
	tooFew: "border-border-default border-dashed text-text-subtle",
} as const satisfies Record<CompareVerdict, string>;

const INTERVAL_TONE = {
	better: { stroke: "stroke-feedback-success", fill: "fill-feedback-success" },
	worse: { stroke: "stroke-feedback-error", fill: "fill-feedback-error" },
	higher: { stroke: "stroke-feedback-info", fill: "fill-feedback-info" },
	lower: { stroke: "stroke-feedback-info", fill: "fill-feedback-info" },
	same: { stroke: "stroke-text-subtle", fill: "fill-text-subtle" },
} as const;

export interface CompareActions {
	onOpenSession: (session: SessionRef, eventId: string | null) => void;
	onShowSessions: (label: string, ids: readonly string[]) => void;
}

/** A metric's value as its kind reads: shares as percents, tokens compact, time and money as such. */
export function formatMetric(
	t: Translator,
	locale: string,
	id: CompareMetricId,
	value: number,
): string {
	switch (id) {
		case "failedShare":
			return formatPercent(locale, value, 1);
		case "tokens":
		case "contextPeak":
			return formatTokens(locale, value);
		case "cost":
			return formatCost(locale, value);
		case "activeTime":
			return formatDuration(t, value);
		case "sessions":
			return formatCount(locale, value);
		default:
			return formatSigned(locale, value).replace(/^[±+]/, "");
	}
}

/** B − A as its kind reads: percentage points, signed tokens, signed durations. */
export function formatDelta(
	t: Translator,
	locale: string,
	id: CompareMetricId,
	value: number,
): string {
	const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
	switch (id) {
		case "failedShare":
			return t("sessionInsights.slices.points", {
				value: formatSigned(locale, value * 100, 1),
			});
		case "tokens":
		case "contextPeak":
			return `${sign}${formatTokens(locale, Math.abs(value))}`;
		case "cost":
			return `${sign}${formatCost(locale, Math.abs(value))}`;
		case "activeTime":
			return `${sign}${formatDuration(t, Math.abs(value))}`;
		default:
			return formatSigned(locale, value);
	}
}

function IntervalChart({ metric }: { metric: CompareMetric }) {
	if (metric.low === null || metric.high === null || metric.delta === null) return null;
	const width = 160;
	const height = 18;
	const extent =
		Math.max(Math.abs(metric.low), Math.abs(metric.high), Math.abs(metric.delta)) * 1.15 || 1;
	const x = (value: number) => width / 2 + (value / extent) * (width / 2 - 6);
	const tone =
		metric.verdict === "better" ||
		metric.verdict === "worse" ||
		metric.verdict === "higher" ||
		metric.verdict === "lower"
			? INTERVAL_TONE[metric.verdict]
			: INTERVAL_TONE.same;
	return (
		<svg
			aria-hidden="true"
			data-testid="compare-interval"
			viewBox={`0 0 ${width} ${height}`}
			className="block h-18 w-160"
		>
			<line
				x1={width / 2}
				x2={width / 2}
				y1={0}
				y2={height}
				strokeDasharray="2 2"
				className="stroke-border-default"
			/>
			<line
				x1={x(metric.low)}
				x2={x(metric.high)}
				y1={height / 2}
				y2={height / 2}
				strokeWidth={3}
				strokeLinecap="round"
				className={tone.stroke}
			/>
			<circle cx={x(metric.delta)} cy={height / 2} r={4} className={tone.fill} />
		</svg>
	);
}

/** The same slices with A and B swapped; `null` where B cannot become A (the rest, a period). */
export function swappedChoice(compare: SlicesCompareResult["compare"]): SliceChoice | null {
	if (compare.by === "period" || compare.b.key === "") return null;
	return { by: compare.by, a: compare.b.key, b: compare.a.key };
}

const SIDE_TONE = { a: "text-series-1", b: "text-series-6" } as const;

/** A picker's options: all of them, the other side's (`taken`) shown but not pickable. */
export function pickerItems(
	options: readonly SliceOption[],
	taken: string,
): { option: SliceOption; taken: boolean }[] {
	return options.map((option) => ({ option, taken: option.key === taken }));
}

function SwapButton({
	choice,
	onChoice,
}: {
	choice: SliceChoice | null;
	onChoice: (choice: SliceChoice) => void;
}) {
	const t = useT();
	return (
		<IconButton
			icon={RiArrowLeftRightLine}
			size="s"
			label={t("sessionInsights.slices.swap")}
			data-testid="compare-swap"
			disabled={choice === null}
			onClick={() => {
				if (choice) onChoice(choice);
			}}
		/>
	);
}

function OptionPicker({
	side,
	value,
	options,
	label,
	onPick,
	rest,
	taken,
}: {
	side: "a" | "b";
	value: string;
	options: readonly SliceOption[];
	label: (option: SliceOption) => string;
	onPick: (key: string) => void;
	/** Offers "the rest" (an empty key) first, named so. */
	rest?: string;
	/** The other side's key: shown, but it cannot be picked here too. */
	taken: string;
}) {
	const t = useT();
	const locale = localeOf(t);
	const current = options.find((option) => option.key === value);
	const shown = current
		? label(current)
		: rest && value === ""
			? rest
			: t("sessionInsights.slices.none");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="s"
					iconRight={RiArrowDownSLine}
					data-testid={`compare-pick-${side}`}
					className="max-w-240 min-w-0"
				>
					<span className={SIDE_TONE[side]}>{side === "a" ? "A" : "B"}</span>
					<span className="min-w-0 truncate">{shown}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup value={value} onValueChange={onPick}>
					{rest ? (
						<DropdownMenuRadioItem value="" data-testid="compare-option" data-key="">
							<span className="min-w-0 flex-1 truncate">{rest}</span>
						</DropdownMenuRadioItem>
					) : null}
					{pickerItems(options, taken).map(({ option, taken: other }) => (
						<DropdownMenuRadioItem
							key={option.key}
							value={option.key}
							disabled={other}
							data-testid="compare-option"
							data-key={option.key}
						>
							<span className="min-w-0 flex-1 truncate">{label(option)}</span>
							<span className="ml-12 tr-text-caption text-text-subtle">
								{t("sessionInsights.slices.n", { n: formatCount(locale, option.sessions) })}
							</span>
							{other ? (
								<span className={cn("ml-4 tr-text-caption", SIDE_TONE[side === "a" ? "b" : "a"])}>
									{side === "a" ? "B" : "A"}
								</span>
							) : null}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The period's split day: typing never asks the server, a blur or Enter commits a whole date. */
function DayField({
	value,
	min,
	max,
	onCommit,
}: {
	value: string;
	min: string | undefined;
	max: string | undefined;
	onCommit: (day: string) => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState(value);
	const commit = () => {
		if (draft && draft !== value) onCommit(draft);
	};
	return (
		<label className="flex items-center gap-8 tr-text-metadata text-text-muted">
			{t("sessionInsights.slices.splitDay")}
			<input
				type="date"
				data-testid="compare-day"
				value={draft}
				min={min}
				max={max}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || isImeComposing(event.nativeEvent)) return;
					event.preventDefault();
					commit();
				}}
				className="rounded-sm border border-control-border-default bg-control-bg px-8 py-2 tr-text-metadata text-text-default focus-visible:focus-ring"
			/>
		</label>
	);
}

function FilterForm({
	a,
	b,
	onApply,
}: {
	a: string;
	b: string;
	onApply: (a: string, b: string) => void;
}) {
	const t = useT();
	const [left, setLeft] = useState(a);
	const [right, setRight] = useState(b);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onApply(left.trim(), right.trim());
	};
	const swap = () => {
		setLeft(right);
		setRight(left);
		onApply(right.trim(), left.trim());
	};
	const field =
		"w-160 rounded-sm border border-control-border-default bg-control-bg px-8 py-2 tr-text-metadata text-text-default placeholder:text-text-subtle focus-visible:focus-ring";
	return (
		<form onSubmit={submit} className="flex flex-wrap items-center gap-4">
			<input
				data-testid="compare-filter-a"
				aria-label={t("sessionInsights.slices.filterA")}
				placeholder={t("sessionInsights.slices.filterA")}
				value={left}
				onChange={(event) => setLeft(event.currentTarget.value)}
				className={field}
			/>
			<IconButton
				icon={RiArrowLeftRightLine}
				size="s"
				label={t("sessionInsights.slices.swap")}
				data-testid="compare-swap"
				disabled={right.trim() === ""}
				onClick={swap}
			/>
			<input
				data-testid="compare-filter-b"
				aria-label={t("sessionInsights.slices.filterB")}
				placeholder={t("sessionInsights.slices.filterB")}
				value={right}
				onChange={(event) => setRight(event.currentTarget.value)}
				className={field}
			/>
			<Button type="submit" variant="outline" size="s" data-testid="compare-filter-apply">
				{t("sessionInsights.slices.apply")}
			</Button>
		</form>
	);
}

function confoundText(t: Translator, locale: string, confound: SliceConfound, by: SliceBy): string {
	const byLabel = t(SLICE_BY_LABEL[by]);
	switch (confound.kind) {
		case "time":
			return t("sessionInsights.slices.confound.time", {
				a: `${formatDay(locale, confound.a.first)} – ${formatDay(locale, confound.a.last)}`,
				b: `${formatDay(locale, confound.b.first)} – ${formatDay(locale, confound.b.last)}`,
				by: byLabel,
			});
		case "projects":
			return t("sessionInsights.slices.confound.projects", {
				a: confound.a ?? t("sessionInsights.group.unregistered"),
				b: confound.b ?? t("sessionInsights.group.unregistered"),
			});
		case "models":
			return t("sessionInsights.slices.confound.models", {
				a: confound.a ?? "—",
				b: confound.b ?? "—",
			});
	}
}

const STRIP_H = 72;
const ROW_Y = { a: 22, b: 54 } as const;

function DotStrip({ metric, labels }: { metric: CompareMetric; labels: { a: string; b: string } }) {
	const t = useT();
	const locale = localeOf(t);
	const values = [...metric.sampleA.values, ...metric.sampleB.values];
	const lo = Math.min(0, ...values);
	const top = Math.max(...values, lo + 1e-9);
	const hi = top + (top - lo) * 0.04 || lo + 1;
	const x = (value: number) => `${(2 + ((value - lo) / (hi - lo)) * 96).toFixed(2)}%`;
	const rows = [
		{
			key: "a",
			sample: metric.sampleA,
			stat: metric.a.value,
			look: "fill-series-1",
			line: "stroke-series-1",
			label: labels.a,
		},
		{
			key: "b",
			sample: metric.sampleB,
			stat: metric.b.value,
			look: "fill-series-6",
			line: "stroke-series-6",
			label: labels.b,
		},
	] as const;
	const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
	return (
		<div className="grid min-w-0 grid-cols-[10rem_minmax(0,1fr)] gap-x-8">
			<div className="flex flex-col pt-12 tr-text-metadata">
				<span className="h-32 truncate text-series-1">{labels.a}</span>
				<span className="h-32 truncate text-series-6">{labels.b}</span>
			</div>
			<div className="flex min-w-0 flex-col">
				<svg
					data-testid="compare-strip"
					width="100%"
					height={STRIP_H}
					role="img"
					aria-label={t("sessionInsights.slices.stripLabel", {
						metric: t(COMPARE_METRIC_LABEL[metric.id]),
					})}
					className="block overflow-visible"
				>
					{rows.map((row) => {
						const y = ROW_Y[row.key];
						return (
							<g key={row.key}>
								<line x1="0%" x2="100%" y1={y} y2={y} className="stroke-border-muted" />
								{row.sample.values.map((value, index) => (
									<circle
										key={row.sample.sessions[index]}
										data-testid={`compare-dot-${row.key}`}
										cx={x(value)}
										cy={y + (((index * 37) % 13) / 13 - 0.5) * 12}
										r={3.6}
										fillOpacity={0.75}
										className={row.look}
									/>
								))}
								{row.stat !== null ? (
									<>
										<line
											x1={x(row.stat)}
											x2={x(row.stat)}
											y1={y - 10}
											y2={y + 10}
											strokeWidth={2}
											className={row.line}
										/>
										<text
											x={x(row.stat)}
											dx={5}
											y={y - 8}
											className={cn("tr-code-text-small", row.look)}
										>
											{formatMetric(t, locale, metric.id, row.stat)}
										</text>
									</>
								) : null}
							</g>
						);
					})}
				</svg>
				<svg aria-hidden="true" width="100%" height={14} className="block overflow-visible">
					{ticks.map((tick, at) => (
						<text
							key={tick}
							x={x(tick)}
							y={11}
							textAnchor={at === 0 ? "start" : at === ticks.length - 1 ? "end" : "middle"}
							className="fill-text-subtle tr-code-text-small"
						>
							{formatMetric(t, locale, metric.id, tick)}
						</text>
					))}
				</svg>
			</div>
		</div>
	);
}

function SessionList({
	side,
	metric,
	sessions,
	label,
	actions,
}: {
	side: "a" | "b";
	metric: CompareMetric;
	sessions: readonly SessionRef[];
	label: string;
	actions: CompareActions;
}) {
	const t = useT();
	const locale = localeOf(t);
	const sample = side === "a" ? metric.sampleA : metric.sampleB;
	const ranked = sample.sessions
		.map((session, at) => ({ session, value: sample.values[at] ?? 0 }))
		.sort((x, y) => y.value - x.value || x.session - y.session)
		.slice(0, LIST);
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<span
				className={cn("truncate tr-text-caption", side === "a" ? "text-series-1" : "text-series-6")}
			>
				{label}
			</span>
			<ul className="flex min-w-0 flex-col">
				{ranked.map(({ session, value }) => {
					const ref = sessions[session];
					if (!ref) return null;
					return (
						<li key={session}>
							<button
								type="button"
								data-testid={`compare-session-${side}`}
								onClick={() => actions.onOpenSession(ref, null)}
								className="flex w-full min-w-0 items-center gap-8 rounded-sm px-4 py-2 text-left tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring"
							>
								<span className="min-w-0 flex-1 truncate text-text-default">
									{sessionName(t, ref)}
								</span>
								{metric.id === "sessions" ? null : (
									<span className="shrink-0 tr-code-text-small text-text-muted">
										{formatMetric(t, locale, metric.id, value)}
									</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>
			{sample.sessions.length > LIST ? (
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.slices.moreSessions", { count: sample.sessions.length - LIST })}
				</span>
			) : null}
		</div>
	);
}

/**
 * The A/B slices: two slices of the scope's sessions by model, period, project, label or a text filter,
 * metric by metric with seeded bootstrap intervals, a three-state verdict, the sessions behind each
 * figure and a note when the slices also differ in time or task mix.
 */
export function CompareView({
	result,
	busy = false,
	choice,
	onChoice,
	actions,
}: {
	result: SlicesCompareResult;
	/** A new choice is loading: the controls stay, the results show a skeleton. */
	busy?: boolean;
	choice: SliceChoice;
	onChoice: (choice: SliceChoice) => void;
	actions: CompareActions;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { compare, sessions } = result;
	const firstDistinct = compare.metrics.find(
		(metric) => metric.low !== null && metric.high !== null && (metric.low > 0 || metric.high < 0),
	);
	const [picked, setPicked] = useState<CompareMetricId | null>(null);
	const focus =
		compare.metrics.find((metric) => metric.id === picked) ??
		firstDistinct ??
		compare.metrics.find((metric) => metric.id === "failedShare") ??
		compare.metrics[0];
	const sideName = (side: "a" | "b") => {
		const slice = compare[side];
		if (compare.by === "project") return slice.name ?? t("sessionInsights.group.unregistered");
		if (compare.by === "period")
			return side === "a"
				? t("sessionInsights.slices.before", { day: compare.a.key })
				: t("sessionInsights.slices.after", { day: compare.a.key });
		if ((compare.by === "filter" || compare.by === "label") && side === "b" && !slice.key)
			return t("sessionInsights.slices.rest");
		return slice.key || t("sessionInsights.slices.none");
	};
	const labels = {
		a: t("sessionInsights.slices.sideLabel", { side: "A", name: sideName("a") }),
		b: t("sessionInsights.slices.sideLabel", { side: "B", name: sideName("b") }),
	};
	const projectLabel = (option: SliceOption) =>
		option.name ?? t("sessionInsights.group.unregistered");
	const showSessions = (metric: CompareMetric) =>
		actions.onShowSessions(
			t(COMPARE_METRIC_LABEL[metric.id]),
			[...metric.sampleA.sessions, ...metric.sampleB.sessions].flatMap(
				(index) => sessions[index]?.sessionId ?? [],
			),
		);
	return (
		<div
			data-testid="compare-view"
			data-by={compare.by}
			className="@container flex min-h-0 flex-col"
		>
			<div className="flex flex-wrap items-center gap-8 border-border-default border-b px-12 py-4">
				<fieldset
					aria-label={t("sessionInsights.slices.byLabel")}
					className="flex items-center gap-2"
				>
					{BYS.map((by) => (
						<ToggleSegment
							key={by}
							testid={`compare-by-${by}`}
							label={t(SLICE_BY_LABEL[by])}
							active={choice.by === by}
							onClick={() => onChoice({ by, a: null, b: null })}
						/>
					))}
				</fieldset>
				<span className="ml-auto flex flex-wrap items-center gap-4">
					{choice.by !== compare.by ? null : compare.by === "model" ? (
						<>
							<OptionPicker
								side="a"
								value={compare.a.key}
								options={compare.options.models}
								label={(option) => option.key}
								taken={compare.b.key}
								onPick={(key) => onChoice({ by: "model", a: key, b: compare.b.key })}
							/>
							<SwapButton choice={swappedChoice(compare)} onChoice={onChoice} />
							<OptionPicker
								side="b"
								value={compare.b.key}
								options={compare.options.models}
								label={(option) => option.key}
								taken={compare.a.key}
								onPick={(key) => onChoice({ by: "model", a: compare.a.key, b: key })}
							/>
						</>
					) : compare.by === "project" ? (
						<>
							<OptionPicker
								side="a"
								value={compare.a.key}
								options={compare.options.projects}
								label={projectLabel}
								taken={compare.b.key}
								onPick={(key) => onChoice({ by: "project", a: key, b: compare.b.key })}
							/>
							<SwapButton choice={swappedChoice(compare)} onChoice={onChoice} />
							<OptionPicker
								side="b"
								value={compare.b.key}
								options={compare.options.projects}
								label={projectLabel}
								taken={compare.a.key}
								onPick={(key) => onChoice({ by: "project", a: compare.a.key, b: key })}
							/>
						</>
					) : compare.by === "label" ? (
						compare.options.labels.length > 0 ? (
							<>
								<OptionPicker
									side="a"
									value={compare.a.key}
									options={compare.options.labels}
									label={(option) => option.key}
									taken={compare.b.key}
									onPick={(key) => onChoice({ by: "label", a: key, b: compare.b.key })}
								/>
								<SwapButton choice={swappedChoice(compare)} onChoice={onChoice} />
								<OptionPicker
									side="b"
									value={compare.b.key}
									options={compare.options.labels}
									label={(option) => option.key}
									rest={t("sessionInsights.slices.rest")}
									taken={compare.a.key}
									onPick={(key) => onChoice({ by: "label", a: compare.a.key, b: key })}
								/>
							</>
						) : null
					) : compare.by === "period" ? (
						<DayField
							key={compare.a.key}
							value={compare.a.key}
							min={compare.options.days?.first}
							max={compare.options.days?.last}
							onCommit={(day) => onChoice({ by: "period", a: day, b: null })}
						/>
					) : (
						<FilterForm
							key={`${compare.a.key}\u0000${compare.b.key}`}
							a={compare.a.key}
							b={compare.b.key}
							onApply={(a, b) => onChoice({ by: "filter", a, b })}
						/>
					)}
				</span>
			</div>
			{busy ? (
				<LoadingRegion
					rows={8}
					label={t("sessionInsights.stats.loading")}
					testId="stats-results-loading"
					className="p-16"
				/>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-8 px-12 py-8 tr-text-metadata text-text-muted">
						<span
							data-testid="compare-side-a"
							className="inline-flex max-w-full items-center gap-4 rounded-sm border border-series-1 px-6 text-text-default"
						>
							<span className="truncate">{labels.a}</span>
							<span className="text-text-muted">
								{t("sessionInsights.slices.n", {
									n: formatCount(locale, compare.a.sessions.length),
								})}
							</span>
						</span>
						<span
							data-testid="compare-side-b"
							className="inline-flex max-w-full items-center gap-4 rounded-sm border border-series-6 px-6 text-text-default"
						>
							<span className="truncate">{labels.b}</span>
							<span className="text-text-muted">
								{t("sessionInsights.slices.n", {
									n: formatCount(locale, compare.b.sessions.length),
								})}
							</span>
						</span>
						<span className="text-text-subtle">
							{t("sessionInsights.slices.method", {
								resamples: formatCount(locale, compare.rules.resamples),
								level: formatPercent(locale, compare.rules.level),
							})}
						</span>
					</div>
					{compare.by === "label" && compare.options.labels.length === 0 ? (
						<p
							data-testid="compare-no-labels"
							className="px-12 pb-8 tr-text-metadata text-text-muted"
						>
							{t("sessionInsights.slices.noLabels")}
						</p>
					) : null}
					{compare.by === "project" && compare.options.projects.length < 2 ? (
						<p
							data-testid="compare-one-project"
							className="px-12 pb-8 tr-text-metadata text-text-muted"
						>
							{t("sessionInsights.slices.oneProject")}
						</p>
					) : null}
					<div className="min-w-0 overflow-x-auto">
						<table
							data-testid="compare-table"
							className="w-full min-w-720 table-fixed border-collapse tr-text-ui"
						>
							<colgroup>
								<col />
								<col className="w-96" />
								<col className="w-96" />
								<col className="w-200" />
								<col className="w-176 @max-[60rem]:w-0" />
								<col className="w-176" />
							</colgroup>
							<thead className="bg-control-bg">
								<tr className="tr-text-caption text-text-subtle">
									<th scope="col" className="px-12 py-4 text-left font-normal">
										{t("sessionInsights.slices.column.metric")}
									</th>
									<th scope="col" className="px-8 py-4 text-right font-normal text-series-1">
										A
									</th>
									<th scope="col" className="px-8 py-4 text-right font-normal text-series-6">
										B
									</th>
									<th scope="col" className="px-8 py-4 text-left font-normal">
										{t("sessionInsights.slices.column.delta", {
											level: formatPercent(locale, compare.rules.level),
										})}
									</th>
									<th
										scope="col"
										className="truncate px-8 py-4 text-left font-normal @max-[60rem]:hidden"
									>
										{t("sessionInsights.slices.column.chart")}
									</th>
									<th scope="col" className="px-8 py-4 text-left font-normal">
										{t("sessionInsights.slices.column.verdict")}
									</th>
								</tr>
							</thead>
							<tbody>
								{compare.metrics.map((metric) => {
									const label = t(COMPARE_METRIC_LABEL[metric.id]);
									const focused = focus?.id === metric.id;
									const value = (side: "a" | "b") => {
										const figure = metric[side];
										const text =
											figure.value === null
												? "—"
												: formatMetric(t, locale, metric.id, figure.value);
										return (
											<Fig
												text={text}
												origin={figure.origin}
												sources={result.sources}
												testId={`compare-value-${side}`}
												figures={[
													{
														metric: "sliceCompare",
														origin: figure.origin,
														exact: figure.value === null ? null : text,
														detail: t(COMPARE_STAT_LABEL[metric.stat]),
													},
												]}
											/>
										);
									};
									return (
										<tr
											key={metric.id}
											data-testid="compare-row"
											data-metric={metric.id}
											data-verdict={metric.verdict}
											className={cn("border-border-muted border-t", focused && "bg-control-bg")}
										>
											<td
												className={cn(
													"max-w-0 px-12 py-4",
													focused && "border-l-2 border-feedback-info",
												)}
											>
												<span className="flex min-w-0 flex-col items-start">
													<button
														type="button"
														data-testid="compare-metric"
														aria-pressed={focused}
														onClick={() => setPicked(metric.id)}
														className="max-w-full truncate rounded-sm text-left text-text-default hover:underline focus-visible:focus-ring"
													>
														{label}
													</button>
													<span className="flex min-w-0 items-center gap-6 tr-text-caption text-text-subtle">
														<span className="truncate">{t(COMPARE_STAT_LABEL[metric.stat])}</span>
														<button
															type="button"
															data-testid="compare-metric-sessions"
															onClick={() => showSessions(metric)}
															className="inline-flex shrink-0 items-center gap-2 rounded-sm hover:text-text-default focus-visible:focus-ring"
														>
															<RiFilter3Line aria-hidden className="size-12" />
															{t("sessionInsights.slices.sessionsBehind", {
																count:
																	metric.sampleA.sessions.length + metric.sampleB.sessions.length,
															})}
														</button>
													</span>
												</span>
											</td>
											<td className="px-8 py-4 text-right tabular-nums">{value("a")}</td>
											<td className="px-8 py-4 text-right tabular-nums">{value("b")}</td>
											<td className="px-8 py-4">
												{metric.delta === null || metric.verdict === "noData" ? (
													<span className="text-text-subtle">—</span>
												) : (
													<span className="flex min-w-0 flex-col">
														<span
															data-testid="compare-delta"
															className="truncate tr-code-text-small text-text-default"
														>
															{formatDelta(t, locale, metric.id, metric.delta)}
															{metric.relative !== null && metric.id !== "failedShare" ? (
																<span className="text-text-subtle">
																	{" "}
																	({formatSigned(locale, metric.relative * 100, 0)}%)
																</span>
															) : null}
														</span>
														{metric.low !== null && metric.high !== null ? (
															<span
																data-testid="compare-range"
																className="truncate tr-code-text-small text-text-subtle"
															>
																{t("sessionInsights.slices.range", {
																	level: formatPercent(locale, compare.rules.level),
																	low: formatDelta(t, locale, metric.id, metric.low),
																	high: formatDelta(t, locale, metric.id, metric.high),
																})}
															</span>
														) : null}
													</span>
												)}
											</td>
											<td className="px-8 py-4 @max-[60rem]:hidden">
												<IntervalChart metric={metric} />
											</td>
											<td className="px-8 py-4">
												<span
													data-testid="compare-verdict"
													className={cn(
														"inline-flex max-w-full rounded-full border px-8 tr-text-metadata",
														VERDICT_TONE[metric.verdict],
													)}
												>
													<span className="truncate">{t(VERDICT_LABEL[metric.verdict])}</span>
												</span>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					<div
						data-testid="compare-note"
						className="flex gap-6 px-12 py-8 tr-text-metadata text-text-muted"
					>
						<RiInformationLine aria-hidden className="mt-2 size-14 shrink-0 text-feedback-info" />
						<span className="flex min-w-0 flex-col gap-2">
							<span>
								{t("sessionInsights.slices.noteGrey", {
									level: formatPercent(locale, compare.rules.level),
									min: compare.rules.minSessions,
								})}
							</span>
							{compare.confounds.map((confound) => (
								<span
									key={confound.kind}
									data-testid="compare-confound"
									data-kind={confound.kind}
									className="text-feedback-warning"
								>
									{confoundText(t, locale, confound, compare.by)}
								</span>
							))}
							<span>
								{t("sessionInsights.slices.noteMany", {
									count: compare.metrics.length - 1,
									distinct: compare.distinguishable,
								})}
							</span>
						</span>
					</div>
					{focus && focus.id !== "sessions" ? (
						<section
							data-testid="compare-sessions"
							data-metric={focus.id}
							className="mx-12 mb-12 flex min-w-0 flex-col gap-8 rounded-md border border-border-default bg-container-sidebar-bg p-12"
						>
							<span className="tr-text-metadata text-text-muted">
								{t("sessionInsights.slices.stripTitle", {
									metric: t(COMPARE_METRIC_LABEL[focus.id]),
								})}
							</span>
							<DotStrip metric={focus} labels={labels} />
							<div className="grid grid-cols-1 gap-12 @[48rem]:grid-cols-2">
								<SessionList
									side="a"
									metric={focus}
									sessions={sessions}
									label={labels.a}
									actions={actions}
								/>
								<SessionList
									side="b"
									metric={focus}
									sessions={sessions}
									label={labels.b}
									actions={actions}
								/>
							</div>
						</section>
					) : null}
				</>
			)}
		</div>
	);
}
