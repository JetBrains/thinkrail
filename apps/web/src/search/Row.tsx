import { RiCornerDownLeftLine } from "@remixicon/react";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, type ReactNode } from "react";
import { shortcutKeys } from "../commands";
import { AttentionDot } from "../components/AttentionDot";
import { highlightRanges } from "../components/MatchHighlight";
import { RunningIcon } from "../components/RunningIcon";
import type { PaletteRow } from "./model";

export function Row({
	row,
	id,
	index,
	selected,
	onHover,
	onActivate,
	note,
}: {
	row: PaletteRow;
	id: string;
	index: number;
	selected: boolean;
	onHover: () => void;
	onActivate: () => void;
	note?: string;
}) {
	const { item } = row;
	const Icon = item.icon;
	return (
		<div
			id={id}
			role="option"
			tabIndex={-1}
			aria-selected={selected}
			aria-disabled={item.disabledReason ? true : undefined}
			data-testid="search-row"
			data-index={index}
			data-item-id={item.id}
			data-kind={item.kind}
			data-top={row.top === true}
			onMouseMove={selected ? undefined : onHover}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onActivate}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onActivate();
				}
			}}
			className={cn(
				"group flex cursor-pointer items-center gap-8 rounded-sm px-8 py-4",
				item.subtitle ? "min-h-40" : "min-h-32",
				row.top ? "min-h-48" : undefined,
				selected ? "bg-control-bg-selected" : undefined,
				item.disabledReason ? "cursor-default" : undefined,
			)}
		>
			{item.running ? (
				<RunningIcon className="size-16 shrink-0 text-text-muted group-aria-selected:text-primary" />
			) : (
				<Icon
					aria-hidden
					className={cn(
						"size-16 shrink-0",
						item.disabledReason
							? "text-text-disabled"
							: "text-text-muted group-aria-selected:text-primary",
					)}
				/>
			)}
			<span className="flex min-w-0 flex-1 flex-col">
				<span
					data-title-source={item.titleSource}
					title={item.titleTooltip}
					className={cn(
						"truncate",
						row.top ? "tr-title-section" : "tr-text-ui",
						item.disabledReason ? "text-text-disabled" : "text-text-default",
					)}
				>
					<RowTitle title={item.title} lead={item.titleLead ?? 0} ranges={row.ranges.title} />
				</span>
				{item.subtitle ? (
					<span
						data-testid="search-row-subtitle"
						className="truncate tr-text-metadata text-text-subtle"
					>
						{highlightSpans(item.subtitle, row.ranges.subtitle, item.subtitleEmphasis)}
					</span>
				) : null}
			</span>
			<span className="flex min-w-0 max-w-[50%] items-center gap-8 tr-text-metadata text-text-subtle">
				{item.disabledReason ? <span className="truncate">{item.disabledReason}</span> : null}
				{note ? <span className="truncate">{note}</span> : null}
				{item.badge ? (
					<span className="truncate rounded-xs border border-border-muted px-4">{item.badge}</span>
				) : null}
				{item.attention && item.attention !== "running" ? <AttentionDot /> : null}
				{item.shortcut ? <Keycaps keys={shortcutKeys(item.shortcut)} /> : null}
				{selected && !item.disabledReason ? (
					<RiCornerDownLeftLine aria-hidden className="size-14 text-text-muted" />
				) : null}
			</span>
		</div>
	);
}

function RowTitle({
	title,
	lead,
	ranges = [],
}: {
	title: string;
	lead: number;
	ranges: readonly (readonly [number, number])[] | undefined;
}): ReactNode {
	return highlightSpans(title, ranges, lead > 0 ? [[0, lead]] : undefined);
}

type Span = readonly [number, number];

function highlightSpans(
	text: string,
	ranges: readonly Span[] | undefined,
	spans: readonly Span[] | undefined,
): ReactNode {
	if (!spans?.length) return highlightRanges(text, ranges);
	const cuts = [...new Set([0, text.length, ...spans.flat()])]
		.filter((cut) => cut >= 0 && cut <= text.length)
		.sort((a, b) => a - b);
	return cuts.slice(1).map((end, index) => {
		const start = cuts[index] ?? 0;
		const inner = (ranges ?? [])
			.filter(([from, to]) => from < end && to > start)
			.map(([from, to]): Span => [Math.max(from, start) - start, Math.min(to, end) - start]);
		const content = highlightRanges(text.slice(start, end), inner);
		const marked = spans.some(([from, to]) => from <= start && end <= to);
		return marked ? (
			<span key={start} className="text-text-muted">
				{content}
			</span>
		) : (
			<Fragment key={start}>{content}</Fragment>
		);
	});
}
