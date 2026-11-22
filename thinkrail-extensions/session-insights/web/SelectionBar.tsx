import { RiArrowLeftRightLine } from "@remixicon/react";
import { localeOf, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import { sessionName } from "./copy";
import { formatStart } from "./format";
import { comparedPair, type SessionPick } from "./selection";

const SIDE_TONE = { a: "text-series-1", b: "text-series-6" } as const;

function PickChip({
	pick,
	side,
	labels,
	now,
}: {
	pick: SessionPick;
	side: "a" | "b";
	labels: readonly string[];
	now: number;
}) {
	const t = useT();
	const locale = localeOf(t);
	const name = sessionName(t, pick);
	const [label] = labels;
	return (
		<span
			data-testid="session-insights-selection-chip"
			data-side={side}
			data-session-id={pick.sessionId}
			className="inline-flex max-w-320 min-w-0 items-center gap-4 rounded-sm border border-border-default bg-control-bg px-4 tr-text-metadata text-text-muted"
		>
			<span className={cn("shrink-0 tr-text-emphasis", SIDE_TONE[side])}>
				{side === "a" ? "A" : "B"}
			</span>
			{label ? (
				<span
					title={label}
					className="max-w-96 shrink-0 truncate rounded-full border border-border-default px-4 text-text-default"
				>
					{label}
				</span>
			) : null}
			<span title={name} className="min-w-0 truncate text-text-default">
				{name}
			</span>
			{pick.start !== null ? (
				<span className="shrink-0">{formatStart(locale, pick.start, now)}</span>
			) : null}
			{pick.calls !== null ? (
				<span className="shrink-0">
					{t("sessionInsights.compare.calls", { count: pick.calls })}
				</span>
			) : null}
		</span>
	);
}

/**
 * The ticked sessions at the bottom of the list: how many, A and B in the order they were ticked with
 * a swap, *Compare* (exactly two), *Clear* and the Esc hint.
 */
export function SelectionBar({
	picks,
	labelsOf,
	now,
	onSwap,
	onCompare,
	onClear,
}: {
	picks: readonly SessionPick[];
	labelsOf: (pick: SessionPick) => readonly string[];
	now: number;
	onSwap: () => void;
	onCompare: () => void;
	onClear: () => void;
}) {
	const t = useT();
	if (picks.length === 0) return null;
	const pair = comparedPair(picks);
	const [only] = picks;
	return (
		<section
			data-testid="session-insights-selection-bar"
			data-count={picks.length}
			aria-label={t("sessionInsights.selection.label")}
			className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-t bg-container-elevated-bg px-12 py-4 tr-text-metadata text-text-muted"
		>
			<span
				data-testid="session-insights-selection-count"
				role="status"
				className="shrink-0 tr-text-emphasis text-text-default"
			>
				{t("sessionInsights.selection.count", { count: picks.length })}
			</span>
			{pair ? (
				<span className="flex min-w-0 items-center gap-4">
					<PickChip pick={pair[0]} side="a" labels={labelsOf(pair[0])} now={now} />
					<IconButton
						icon={RiArrowLeftRightLine}
						size="s"
						label={t("sessionInsights.selection.swap")}
						data-testid="session-insights-selection-swap"
						onClick={onSwap}
					/>
					<PickChip pick={pair[1]} side="b" labels={labelsOf(pair[1])} now={now} />
				</span>
			) : picks.length === 1 && only ? (
				<PickChip pick={only} side="a" labels={labelsOf(only)} now={now} />
			) : null}
			{pair ? null : (
				<span data-testid="session-insights-selection-hint" className="shrink-0">
					{picks.length === 1
						? t("sessionInsights.selection.pickOneMore")
						: t("sessionInsights.selection.pickTwo")}
				</span>
			)}
			<span className="ml-auto flex shrink-0 items-center gap-8">
				<Button
					variant="primary"
					size="s"
					iconLeft={RiArrowLeftRightLine}
					data-testid="session-insights-selection-compare"
					disabled={!pair}
					onClick={onCompare}
				>
					{t("sessionInsights.selection.compare")}
				</Button>
				<Button
					variant="ghost"
					size="s"
					data-testid="session-insights-selection-clear"
					onClick={onClear}
				>
					{t("sessionInsights.selection.clear")}
				</Button>
				<Keycaps keys={["Esc"]} />
			</span>
		</section>
	);
}
