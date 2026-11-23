import {
	RiArrowDownLine,
	RiArrowDownSLine,
	RiArrowLeftRightLine,
	RiArrowRightSLine,
	RiArrowUpLine,
	RiFlowChart,
	RiFolderLine,
	RiRobot2Line,
} from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type { SessionListRow, SessionsListResult } from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type FocusEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { isBadged, OUTCOME_LABEL, OUTCOME_TONE, sessionName } from "./copy";
import {
	FIGURE_X,
	FigureBadge,
	FigureCell,
	FigureValue,
	type FigureView,
	Pill,
	type Sources,
} from "./FigureCell";
import {
	formatCost,
	formatCostExact,
	formatCount,
	formatDateTime,
	formatDuration,
	formatShare,
	formatStart,
	formatTokens,
} from "./format";
import { type GridCell, gridAttributes, gridMove, gridPosition } from "./grid";
import { LabelChips } from "./labels/LabelsEditor";
import { chatTarget } from "./load";
import { DEFAULT_SORT, groupRows, nextSort, type RowGroup, type Sort, type SortKey } from "./rows";

const COLUMNS = 9;
/** The name, *Open analysis* and compare cells (plus the labels editor when shown) come before the figures. */
const FIRST_FIGURE = 3;
const FIGURES = 7;
const OPEN_GROUPS = 3;
const PAGE = 25;
const NONE = "—";

type Line =
	| { kind: "group"; key: string; group: RowGroup; collapsed: boolean }
	| { kind: "row"; key: string; row: SessionListRow }
	| { kind: "more"; key: string; group: RowGroup; next: number };

const SORTABLE: readonly { key: SortKey; label: MessageKey }[] = [
	{ key: "start", label: "sessionInsights.column.start" },
	{ key: "active", label: "sessionInsights.column.active" },
	{ key: "tokens", label: "sessionInsights.column.tokens" },
	{ key: "cost", label: "sessionInsights.column.cost" },
	{ key: "calls", label: "sessionInsights.column.calls" },
	{ key: "errors", label: "sessionInsights.column.errors" },
	{ key: "subagents", label: "sessionInsights.column.subagents" },
];

function sessionContext(t: Translator, row: SessionListRow): string {
	const parts: string[] = [];
	if (row.workspaceName) parts.push(row.workspaceName);
	if (row.title && row.firstPrompt)
		parts.push(t("sessionInsights.quotedPrompt", { prompt: row.firstPrompt }));
	return parts.join(" · ");
}

function buildLines(
	groups: readonly RowGroup[],
	grouped: boolean,
	toggled: ReadonlySet<string>,
	limits: Readonly<Record<string, number>>,
): Line[] {
	const lines: Line[] = [];
	groups.forEach((group, index) => {
		const closedByDefault = index >= OPEN_GROUPS;
		const collapsed = grouped && closedByDefault !== toggled.has(group.key);
		if (grouped) lines.push({ kind: "group", key: `group:${group.key}`, group, collapsed });
		if (collapsed) return;
		const limit = limits[group.key] ?? PAGE;
		for (const row of group.rows.slice(0, limit))
			lines.push({ kind: "row", key: `session:${row.sessionId}`, row });
		if (group.rows.length > limit)
			lines.push({
				kind: "more",
				key: `more:${group.key}`,
				group,
				next: Math.min(PAGE, group.rows.length - limit),
			});
	});
	return lines;
}

function firstFigure(labelled: boolean): number {
	return labelled ? FIRST_FIGURE + 1 : FIRST_FIGURE;
}

function lineWidth(line: Line, labelled: boolean): number {
	return line.kind === "row" ? firstFigure(labelled) + FIGURES : 1;
}

function SortHeader({
	label,
	sortKey,
	sort,
	onSort,
}: {
	label: string;
	sortKey: SortKey;
	sort: Sort;
	onSort: (key: SortKey) => void;
}) {
	const active = sort.key === sortKey;
	const Arrow = sort.direction === "asc" ? RiArrowUpLine : RiArrowDownLine;
	return (
		<th
			scope="col"
			aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
			className={cn("py-4 text-right", FIGURE_X)}
		>
			<button
				type="button"
				data-testid={`session-insights-sort-${sortKey}`}
				onClick={() => onSort(sortKey)}
				className={cn(
					"inline-flex max-w-full items-center gap-2 rounded-sm tr-text-metadata hover:text-text-default focus-visible:focus-ring",
					active ? "text-text-default" : "text-text-muted",
				)}
			>
				<span className="min-w-0 truncate">{label}</span>
				{active ? <Arrow aria-hidden className="size-12 shrink-0" /> : null}
			</button>
		</th>
	);
}

function TableHead({ sort, onSort }: { sort: Sort; onSort: (key: SortKey) => void }) {
	const t = useT();
	const sortable = SORTABLE.map((column) => (
		<SortHeader
			key={column.key}
			label={t(column.label)}
			sortKey={column.key}
			sort={sort}
			onSort={onSort}
		/>
	));
	return (
		<thead className="sticky top-0 z-10 bg-container-header-bg">
			<tr className="border-border-default border-b">
				<th scope="col" className="px-8 py-4 text-left tr-text-metadata text-text-muted">
					{t("sessionInsights.column.session")}
				</th>
				{sortable}
				<th scope="col" className="truncate px-8 py-4 text-left tr-text-metadata text-text-muted">
					{t("sessionInsights.column.outcome")}
				</th>
			</tr>
		</thead>
	);
}

function GroupLine({
	line,
	cell,
	onToggle,
}: {
	line: Extract<Line, { kind: "group" }>;
	cell: GridCell;
	onToggle: () => void;
}) {
	const t = useT();
	const Chevron = line.collapsed ? RiArrowRightSLine : RiArrowDownSLine;
	return (
		<tr
			data-testid="session-insights-group"
			data-group={line.group.key}
			className="border-border-muted border-t bg-container-header-bg"
		>
			<td colSpan={COLUMNS} className="p-0">
				<button
					type="button"
					{...gridAttributes(cell)}
					aria-expanded={!line.collapsed}
					onClick={onToggle}
					className="flex w-full min-w-0 items-center gap-8 px-8 py-4 text-left hover:bg-control-bg-hovered focus-visible:focus-ring-inset"
				>
					<Chevron aria-hidden className="size-14 shrink-0 text-text-muted" />
					<RiFolderLine aria-hidden className="size-14 shrink-0 text-text-muted" />
					<span className="min-w-0 truncate tr-title-compact text-text-default">
						{line.group.project?.name ?? t("sessionInsights.group.unregistered")}
					</span>
					<span className="shrink-0 tr-text-metadata text-text-subtle">
						{t("sessionInsights.count", { count: line.group.rows.length })}
					</span>
				</button>
			</td>
		</tr>
	);
}

function MoreLine({
	line,
	cell,
	onMore,
}: {
	line: Extract<Line, { kind: "more" }>;
	cell: GridCell;
	onMore: () => void;
}) {
	const t = useT();
	return (
		<tr data-testid="session-insights-more">
			<td colSpan={COLUMNS} className="px-8 py-2">
				<Button variant="ghost" size="s" {...gridAttributes(cell)} onClick={onMore}>
					{t("sessionInsights.more", { count: line.next })}
				</Button>
			</td>
		</tr>
	);
}

function SecondLine({ children }: { children: ReactNode }) {
	return (
		<span className="block w-full truncate tr-text-metadata text-text-subtle">{children}</span>
	);
}

/** The session picked as the first side of a comparison, if any. */
export interface CompareState {
	from: string | null;
	onCompare: (row: SessionListRow) => void;
	onCancel: () => void;
}

/** The user's labels per row (chips under the name) and the row's labels editor at its grid cell. */
export interface RowLabels {
	of: (sessionId: string) => readonly string[];
	edit: (row: SessionListRow, cell: GridCell) => ReactNode;
}

function SessionLine({
	row,
	sources,
	now,
	cellAt,
	onOpen,
	onAnalyse,
	compare,
	labels,
}: {
	row: SessionListRow;
	sources: Sources;
	now: number;
	cellAt: (col: number) => GridCell;
	onOpen: (row: SessionListRow) => void;
	onAnalyse: (row: SessionListRow) => void;
	compare: CompareState;
	labels: RowLabels | null;
}) {
	const t = useT();
	const locale = localeOf(t);
	const name = sessionName(t, row);
	const context = sessionContext(t, row);
	const figure = (k: number) => cellAt(firstFigure(labels !== null) + k);
	const tokens = row.tokens.value;
	const cost = row.cost.value;
	const outside = row.subagentsOutside.value;
	const calls = row.toolCalls.value;
	const errors = row.toolErrors.value;
	const share = errors !== null && calls !== null ? formatShare(locale, errors, calls) : null;
	const showOutside = outside !== null && (outside.cost > 0 || outside.tokens > 0);
	const startFigure: FigureView = {
		metric: "start",
		origin: row.start.origin,
		exact: row.start.value === null ? null : formatDateTime(locale, row.start.value),
	};
	const tokensFigure: FigureView = {
		metric: "tokens",
		origin: row.tokens.origin,
		exact: tokens === null ? null : formatCount(locale, tokens.total),
		detail:
			tokens === null
				? undefined
				: t("sessionInsights.figure.tokenBreakdown", {
						input: formatCount(locale, tokens.input),
						output: formatCount(locale, tokens.output),
						cacheRead: formatCount(locale, tokens.cacheRead),
						cacheWrite: formatCount(locale, tokens.cacheWrite),
					}),
	};
	const costFigures: FigureView[] = [
		{
			metric: "cost",
			origin: row.cost.origin,
			exact: cost === null ? null : formatCostExact(locale, cost),
		},
	];
	if (showOutside)
		costFigures.push({
			metric: "subagentsOutside",
			origin: row.subagentsOutside.origin,
			exact: formatCostExact(locale, outside.cost),
			detail: t("sessionInsights.cost.tokens", { tokens: formatCount(locale, outside.tokens) }),
		});
	const target = chatTarget(row);
	return (
		<tr
			data-testid="session-insights-row"
			data-session-id={row.sessionId}
			data-workspace-state={row.workspaceState}
			className="border-border-muted border-t hover:bg-control-bg-hovered"
		>
			<td data-testid="session-insights-name" className="overflow-hidden p-0 align-top">
				<div className="flex min-w-0 items-start">
					<button
						type="button"
						{...gridAttributes(cellAt(0))}
						data-testid={target ? "session-insights-open-chat" : undefined}
						aria-disabled={target ? undefined : true}
						onClick={target ? () => onOpen(row) : undefined}
						className="group flex min-w-0 flex-1 flex-col items-start px-8 py-4 text-left focus-visible:focus-ring-inset"
					>
						<span className="flex w-full min-w-0 items-center gap-8">
							<span
								className={cn(
									"min-w-0 truncate tr-text-ui text-text-default",
									target && "group-hover:underline",
								)}
								title={name}
							>
								{name}
							</span>
							{target ? <span className="sr-only">{t("sessionInsights.openChat")}</span> : null}
							{row.live ? (
								<Pill testId="session-insights-live" className="border-primary-muted text-primary">
									{t("sessionInsights.badge.live")}
								</Pill>
							) : null}
							{row.workspaceState === "removed" ? (
								<Pill
									testId="session-insights-removed"
									className="border-border-default text-text-subtle"
								>
									{t("sessionInsights.badge.removed")}
								</Pill>
							) : null}
						</span>
						{context ? <SecondLine>{context}</SecondLine> : null}
						{labels ? (
							<span className="mt-2 flex w-full min-w-0">
								<LabelChips labels={labels.of(row.sessionId)} />
							</span>
						) : null}
					</button>
					<IconButton
						icon={RiFlowChart}
						size="s"
						label={t("sessionInsights.openAnalysis")}
						data-testid="session-insights-open-analysis"
						{...gridAttributes(cellAt(1))}
						onClick={() => onAnalyse(row)}
						className="mt-4 shrink-0"
					/>
					<IconButton
						icon={RiArrowLeftRightLine}
						size="s"
						label={
							compare.from === row.sessionId
								? t("sessionInsights.compare.cancel")
								: compare.from
									? t("sessionInsights.compare.withPicked")
									: t("sessionInsights.compare.with")
						}
						data-testid="session-insights-compare"
						aria-pressed={compare.from === row.sessionId}
						selected={compare.from === row.sessionId}
						{...gridAttributes(cellAt(2))}
						onClick={() => compare.onCompare(row)}
						className={cn("mt-4 shrink-0", !labels && "mr-4")}
					/>
					{labels ? (
						<span className="mt-4 mr-4 shrink-0">{labels.edit(row, cellAt(3))}</span>
					) : null}
				</div>
			</td>
			<FigureCell
				testId="session-insights-start"
				figures={[startFigure]}
				sources={sources}
				cell={figure(0)}
			>
				<FigureValue
					text={row.start.value === null ? NONE : formatStart(locale, row.start.value, now)}
					origin={row.start.origin}
				/>
			</FigureCell>
			<FigureCell
				testId="session-insights-active"
				figures={[
					{
						metric: "activeTime",
						origin: row.activeMs.origin,
						exact: row.activeMs.value === null ? null : formatDuration(t, row.activeMs.value, true),
					},
				]}
				sources={sources}
				cell={figure(1)}
			>
				<FigureValue
					text={row.activeMs.value === null ? NONE : formatDuration(t, row.activeMs.value)}
					origin={row.activeMs.origin}
				/>
			</FigureCell>
			<FigureCell
				testId="session-insights-tokens"
				figures={[tokensFigure]}
				sources={sources}
				cell={figure(2)}
			>
				<FigureValue
					text={tokens === null ? NONE : formatTokens(locale, tokens.total)}
					origin={row.tokens.origin}
				/>
			</FigureCell>
			<FigureCell
				testId="session-insights-cost"
				figures={costFigures}
				sources={sources}
				cell={figure(3)}
			>
				<FigureValue
					text={cost === null ? NONE : formatCost(locale, cost)}
					origin={row.cost.origin}
				/>
				{row.cost.origin === "notRecorded" && tokens !== null ? (
					<SecondLine>
						{t("sessionInsights.cost.tokens", { tokens: formatTokens(locale, tokens.total) })}
					</SecondLine>
				) : null}
				{showOutside ? (
					<span
						data-testid="session-insights-outside"
						className="flex min-w-0 items-start justify-end gap-4 text-right tr-text-metadata text-text-muted"
					>
						<span>
							{outside.cost > 0
								? t("sessionInsights.cost.subagentsOutside", {
										cost: formatCost(locale, outside.cost),
									})
								: t("sessionInsights.cost.subagentsOutsideTokens", {
										tokens: formatTokens(locale, outside.tokens),
									})}
						</span>
						{isBadged(row.subagentsOutside.origin) ? (
							<FigureBadge origin={row.subagentsOutside.origin} />
						) : null}
					</span>
				) : null}
			</FigureCell>
			<FigureCell
				testId="session-insights-calls"
				figures={[
					{
						metric: "toolCalls",
						origin: row.toolCalls.origin,
						exact: calls === null ? null : formatCount(locale, calls),
					},
				]}
				sources={sources}
				cell={figure(4)}
			>
				<FigureValue
					text={calls === null ? NONE : formatCount(locale, calls)}
					origin={row.toolCalls.origin}
				/>
			</FigureCell>
			<FigureCell
				testId="session-insights-errors"
				figures={[
					{
						metric: "toolErrors",
						origin: row.toolErrors.origin,
						exact: errors === null ? null : formatCount(locale, errors),
						detail: share ?? undefined,
					},
				]}
				sources={sources}
				cell={figure(5)}
				className={errors ? "text-feedback-error" : "text-text-subtle"}
			>
				<FigureValue
					text={
						errors === null
							? NONE
							: errors > 0 && share
								? `${formatCount(locale, errors)} · ${share}`
								: formatCount(locale, errors)
					}
					origin={row.toolErrors.origin}
				/>
			</FigureCell>
			<FigureCell
				testId="session-insights-subagents"
				figures={[
					{
						metric: "subagents",
						origin: row.subagents.origin,
						exact: row.subagents.value === null ? null : formatCount(locale, row.subagents.value),
					},
				]}
				sources={sources}
				cell={figure(6)}
				className={row.subagents.value ? "text-text-default" : "text-text-subtle"}
			>
				<span className="inline-flex items-center justify-end gap-4">
					{row.subagents.value ? (
						<RiRobot2Line aria-hidden className="size-12 shrink-0 text-text-muted" />
					) : null}
					<FigureValue
						text={row.subagents.value === null ? NONE : formatCount(locale, row.subagents.value)}
						origin={row.subagents.origin}
					/>
				</span>
			</FigureCell>
			<td data-testid="session-insights-outcome" className="overflow-hidden px-8 py-4 align-top">
				{row.outcome ? (
					<Pill testId="session-insights-outcome-badge" className={OUTCOME_TONE[row.outcome]}>
						{t(OUTCOME_LABEL[row.outcome])}
					</Pill>
				) : (
					<span className="tr-text-metadata text-text-subtle">{NONE}</span>
				)}
			</td>
		</tr>
	);
}

export function SessionsTable({
	result,
	grouped,
	now,
	onOpen,
	onAnalyse,
	compare,
	labels = null,
}: {
	result: SessionsListResult;
	grouped: boolean;
	now: number;
	onOpen: (row: SessionListRow) => void;
	onAnalyse: (row: SessionListRow) => void;
	compare: CompareState;
	labels?: RowLabels | null;
}) {
	const t = useT();
	const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
	const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
	const [limits, setLimits] = useState<Readonly<Record<string, number>>>({});
	const [active, setActive] = useState<{ key: string; col: number } | null>(null);
	const groups = groupRows(result, sort);
	const lines = buildLines(groups, grouped, toggled, limits);
	const widths = lines.map((line) => lineWidth(line, labels !== null));
	const activeRow = active ? lines.findIndex((line) => line.key === active.key) : -1;
	const focus =
		active && activeRow >= 0 && active.col < (widths[activeRow] ?? 0)
			? { row: activeRow, col: active.col }
			: { row: 0, col: 0 };
	const cellOf = (row: number, col: number): GridCell => ({
		key: lines[row]?.key ?? "",
		row,
		col,
		tabIndex: row === focus.row && col === focus.col ? 0 : -1,
	});
	const toggle = (key: string) =>
		setToggled((current) => {
			const next = new Set(current);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	const more = (group: RowGroup) =>
		setLimits((current) => ({ ...current, [group.key]: (current[group.key] ?? PAGE) + PAGE }));

	const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
		if (!(event.target instanceof HTMLElement)) return;
		const position = gridPosition(event.target);
		if (!position) return;
		const line = lines[position.row];
		if (
			event.key === "Enter" &&
			line?.kind === "row" &&
			position.col >= firstFigure(labels !== null)
		) {
			event.preventDefault();
			if (chatTarget(line.row)) onOpen(line.row);
			return;
		}
		const next = gridMove(event.key, event.ctrlKey || event.metaKey, position, widths);
		if (!next) return;
		event.preventDefault();
		event.currentTarget
			.querySelector<HTMLElement>(`[data-grid-row="${next.row}"][data-grid-col="${next.col}"]`)
			?.focus();
	};
	const onFocus = (event: FocusEvent<HTMLTableElement>) => {
		if (!(event.target instanceof HTMLElement)) return;
		const position = gridPosition(event.target);
		if (position && (position.key !== active?.key || position.col !== active.col))
			setActive({ key: position.key, col: position.col });
	};

	return (
		<table
			aria-label={t("sessionInsights.table")}
			data-testid="session-insights-table"
			onKeyDown={onKeyDown}
			onFocus={onFocus}
			className="w-full min-w-880 table-fixed border-collapse"
		>
			<colgroup>
				<col />
				<col className="w-136 @max-[1152px]:w-128" />
				<col className="w-104 @max-[1152px]:w-96" />
				<col className="w-72 @max-[1152px]:w-64" />
				<col className="w-144 @max-[1152px]:w-136" />
				<col className="w-72 @max-[1152px]:w-64" />
				<col className="w-80 @max-[1152px]:w-72" />
				<col className="w-96 @max-[1152px]:w-88" />
				<col className="w-104" />
			</colgroup>
			<TableHead sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
			<tbody>
				{lines.map((line, index) => {
					const cellAt = (col: number) => cellOf(index, col);
					if (line.kind === "group")
						return (
							<GroupLine
								key={line.key}
								line={line}
								cell={cellAt(0)}
								onToggle={() => toggle(line.group.key)}
							/>
						);
					if (line.kind === "more")
						return (
							<MoreLine
								key={line.key}
								line={line}
								cell={cellAt(0)}
								onMore={() => more(line.group)}
							/>
						);
					return (
						<SessionLine
							key={line.key}
							row={line.row}
							sources={result.sources}
							now={now}
							cellAt={cellAt}
							onOpen={onOpen}
							onAnalyse={onAnalyse}
							compare={compare}
							labels={labels}
						/>
					);
				})}
			</tbody>
		</table>
	);
}
