import { RiArrowLeftRightLine, RiSearchLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type { SessionListRow } from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useId, useState } from "react";
import { sessionName } from "../copy";
import { formatCost, formatCount, formatStart } from "../format";
import { useLabels } from "../labels/api";
import { LabelChips } from "../labels/LabelsEditor";
import { type ListOutcome, listScope, loadSessions, openComparison, type ScopeKind } from "../load";
import { type Query, useKeyedQuery } from "../useKeyedQuery";

/** The session the comparison starts from: it is A. */
export interface CompareFrom {
	sessionId: string;
	name: string;
}

function byStartDesc(a: SessionListRow, b: SessionListRow): number {
	const x = a.start.value;
	const y = b.start.value;
	if (x === y) return 0;
	if (x === null) return 1;
	if (y === null) return -1;
	return y - x;
}

/**
 * The sessions offered as B: the scope's rows without A, most recent first, kept when what is typed
 * occurs in the title, the first prompt or one of the user's labels.
 */
export function pickerRows(
	rows: readonly SessionListRow[],
	current: string,
	query: string,
	labels: ReadonlyMap<string, readonly string[]>,
): SessionListRow[] {
	const needle = query.trim().toLocaleLowerCase();
	return rows
		.filter((row) => row.sessionId !== current)
		.filter(
			(row) =>
				needle === "" ||
				[row.title, row.firstPrompt, ...(labels.get(row.sessionId) ?? [])].some((text) =>
					text?.toLocaleLowerCase().includes(needle),
				),
		)
		.sort(byStartDesc);
}

/** A list answered while the host's index is still being built: more sessions are on their way. */
export function stillIndexing(outcome: ListOutcome): boolean {
	return outcome.kind === "ok" && outcome.result.state.phase !== "ready";
}

export type PickerStatus = "loading" | "failed" | "noMatches" | "empty" | null;

/** What the picker says under its options: nothing while it shows some, else why there are none. */
export function pickerStatus(list: Query<ListOutcome>, shown: number, query: string): PickerStatus {
	if (list.kind === "loading") return "loading";
	if (list.kind !== "ready" || list.value.kind !== "ok") return "failed";
	if (shown > 0) return null;
	if (query.trim()) return "noMatches";
	return stillIndexing(list.value) ? "loading" : "empty";
}

const STATUS_COPY = {
	loading: "sessionInsights.comparePicker.loading",
	failed: "sessionInsights.comparePicker.failed",
	noMatches: "sessionInsights.comparePicker.noMatches",
	empty: "sessionInsights.comparePicker.empty",
} as const;

/** The option ↑/↓ moves to (clamped at the ends), Home/End reach; `null` for any other key. */
export function pickerStep(key: string, active: number, count: number): number | null {
	if (count === 0) return null;
	switch (key) {
		case "ArrowDown":
			return Math.min(count - 1, active + 1);
		case "ArrowUp":
			return Math.max(0, active - 1);
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}

/** Opens A against `row` as B, in the tab the list's comparison opens, named "A ↔ B". */
export function compareWith(
	host: PanelHost,
	t: Translator,
	from: CompareFrom,
	row: SessionListRow,
): void {
	openComparison(
		host,
		from.sessionId,
		row.sessionId,
		t("sessionInsights.compare.tabTitle", { a: from.name, b: sessionName(t, row) }),
	);
}

function Option({
	row,
	id,
	active,
	labels,
	onPick,
	onHover,
}: {
	row: SessionListRow;
	id: string;
	active: boolean;
	labels: readonly string[];
	onPick: () => void;
	onHover: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const calls = row.toolCalls.value;
	const facts = [
		row.start.value === null ? null : formatStart(locale, row.start.value, Date.now()),
		calls === null
			? null
			: t("sessionInsights.comparePicker.calls", { count: calls, n: formatCount(locale, calls) }),
		row.cost.value === null ? null : formatCost(locale, row.cost.value),
	].filter((fact) => fact !== null);
	return (
		<button
			type="button"
			id={id}
			role="option"
			tabIndex={-1}
			aria-selected={active}
			data-testid="compare-picker-option"
			data-session-id={row.sessionId}
			onClick={onPick}
			onMouseMove={onHover}
			className={cn(
				"flex min-w-0 flex-col items-stretch gap-2 rounded-sm px-8 py-4 text-left",
				active ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
			)}
		>
			<span className="truncate tr-text-ui text-text-default" title={sessionName(t, row)}>
				{sessionName(t, row)}
			</span>
			<span className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-muted tabular-nums">
				<span className="shrink-0">{facts.join(" · ")}</span>
				<LabelChips labels={labels} testId="compare-picker-label" />
			</span>
		</button>
	);
}

/**
 * Picks B for a comparison with the current session: the scope's sessions (this project, or all),
 * most recent first and filtered by what is typed; ↑/↓ move, Enter compares, Esc closes.
 */
export function CompareChooser({
	host,
	from,
	onPicked,
}: {
	host: PanelHost;
	from: CompareFrom;
	onPicked: () => void;
}) {
	const t = useT();
	const listId = useId();
	const [scope, setScope] = useState<ScopeKind>("project");
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const list = useKeyedQuery(
		scope,
		(signal) => loadSessions(host, listScope(host, scope), signal),
		stillIndexing,
	);
	const labels = useLabels(host, null, true);
	const labelsOf = new Map(
		(labels?.sessions ?? []).map((entry) => [entry.sessionId, entry.labels]),
	);
	const rows =
		list.kind === "ready" && list.value.kind === "ok"
			? pickerRows(list.value.result.rows, from.sessionId, query, labelsOf)
			: [];
	const at = Math.min(active, Math.max(0, rows.length - 1));
	const optionId = (index: number) => `${listId}-${index}`;
	const pick = (row: SessionListRow | undefined) => {
		if (!row) return;
		compareWith(host, t, from, row);
		onPicked();
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (isImeComposing(event.nativeEvent)) return;
		if (event.key === "Enter") {
			event.preventDefault();
			pick(rows[at]);
			return;
		}
		const next = pickerStep(event.key, at, rows.length);
		if (next === null) return;
		event.preventDefault();
		setActive(next);
		document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
	};
	const status = pickerStatus(list, rows.length, query);
	const state = status ? t(STATUS_COPY[status]) : null;
	return (
		<div data-testid="compare-picker" className="flex w-400 max-w-full flex-col gap-8 p-8">
			<span className="truncate tr-text-metadata text-text-subtle" title={from.name}>
				{t("sessionInsights.comparePicker.current", { name: from.name })}
			</span>
			<div className="flex items-center gap-8">
				<span className="flex min-w-0 flex-1 items-center gap-4">
					<RiSearchLine aria-hidden className="size-14 shrink-0 text-text-subtle" />
					<input
						type="text"
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={rows.length > 0 ? optionId(at) : undefined}
						aria-label={t("sessionInsights.comparePicker.search")}
						placeholder={t("sessionInsights.comparePicker.search")}
						data-testid="compare-picker-search"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						onKeyDown={onKeyDown}
						className="h-24 min-w-0 flex-1 rounded-sm border border-control-border-default bg-control-bg px-4 tr-text-metadata text-text-default placeholder:text-text-subtle focus-visible:focus-ring focus:border-control-border-active"
					/>
				</span>
				<span className="flex shrink-0 items-center gap-2">
					<ToggleSegment
						testid="compare-picker-scope-project"
						label={t("sessionInsights.scope.project")}
						active={scope === "project"}
						onClick={() => {
							setScope("project");
							setActive(0);
						}}
					/>
					<ToggleSegment
						testid="compare-picker-scope-all"
						label={t("sessionInsights.scope.all")}
						active={scope === "all"}
						onClick={() => {
							setScope("all");
							setActive(0);
						}}
					/>
				</span>
			</div>
			<div
				id={listId}
				role="listbox"
				aria-label={t("sessionInsights.comparePicker.list")}
				data-testid="compare-picker-list"
				className="flex max-h-320 flex-col gap-2 overflow-y-auto"
			>
				{rows.map((row, index) => (
					<Option
						key={row.sessionId}
						row={row}
						id={optionId(index)}
						active={index === at}
						labels={labelsOf.get(row.sessionId) ?? []}
						onPick={() => pick(row)}
						onHover={() => setActive(index)}
					/>
				))}
			</div>
			{state ? (
				<p role="status" className="px-8 py-4 tr-text-metadata text-text-muted">
					{state}
				</p>
			) : null}
		</div>
	);
}

/** The header's *Compare with…*: a picker of the session to compare the current one with. */
export function CompareButton({ host, from }: { host: PanelHost; from: CompareFrom }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="s"
					iconLeft={RiArrowLeftRightLine}
					data-testid="session-insights-compare-with"
					aria-haspopup="dialog"
				>
					{t("sessionInsights.header.compareWith")}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="p-0">
				{open ? <CompareChooser host={host} from={from} onPicked={() => setOpen(false)} /> : null}
			</PopoverContent>
		</Popover>
	);
}
