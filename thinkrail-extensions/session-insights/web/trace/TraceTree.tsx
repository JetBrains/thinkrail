import {
	type RemixiconComponentType,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiBookOpenLine,
	RiBrainLine,
	RiExchangeLine,
	RiFileAddLine,
	RiFileSearchLine,
	RiFolderOpenLine,
	RiGitBranchLine,
	RiGlobalLine,
	RiHammerLine,
	RiInboxArchiveLine,
	RiListCheck2,
	RiMessage2Line,
	RiNodeTree,
	RiPencilLine,
	RiPriceTag3Line,
	RiQuestionAnswerLine,
	RiRobot2Line,
	RiSettings3Line,
	RiSparklingLine,
	RiTerminalLine,
	RiUser3Line,
} from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	MarkKind,
	RepeatGroup,
	TraceEvent,
	TurnTrigger,
} from "@thinkrail/pi-session-insights/core";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { formatCount, formatSpan, formatTokens } from "../format";
import { PANEL_COMMANDS, PANEL_KEYS, PANEL_SCOPE, plainKey } from "../keys";
import { ROW_HEIGHT } from "./frame";
import { runStart, type SeriesKey, seriesOf, type TraceModel } from "./model";
import { roleSeries } from "./roles";

type Icon = RemixiconComponentType;

const INDENT = ["w-0", "w-12", "w-24", "w-36", "w-48", "w-60", "w-72", "w-84"] as const;

export const SERIES_TEXT = {
	"series-1": "text-series-1",
	"series-2": "text-series-2",
	"series-3": "text-series-3",
	"series-4": "text-series-4",
	"series-5": "text-series-5",
	"series-6": "text-series-6",
	"series-7": "text-series-7",
	"series-8": "text-series-8",
	primary: "text-primary",
} as const satisfies Record<SeriesKey, string>;

export const SERIES_SWATCH = {
	"series-1": "bg-series-1",
	"series-2": "bg-series-2",
	"series-3": "bg-series-3",
	"series-4": "bg-series-4",
	"series-5": "bg-series-5",
	"series-6": "bg-series-6",
	"series-7": "bg-series-7",
	"series-8": "bg-series-8",
	primary: "bg-primary",
} as const satisfies Record<SeriesKey, string>;

const MARK_ICON = {
	compaction: RiInboxArchiveLine,
	modelChange: RiExchangeLine,
	thinkingLevel: RiBrainLine,
	sessionInfo: RiPriceTag3Line,
	label: RiPriceTag3Line,
	branchSummary: RiGitBranchLine,
	customMessage: RiMessage2Line,
	system: RiSettings3Line,
} as const satisfies Record<MarkKind, Icon>;

export const MARK_TITLE = {
	compaction: "sessionInsights.trace.mark.compaction",
	modelChange: "sessionInsights.trace.mark.modelChange",
	thinkingLevel: "sessionInsights.trace.mark.thinkingLevel",
	sessionInfo: "sessionInsights.trace.mark.sessionInfo",
	label: "sessionInsights.trace.mark.label",
	branchSummary: "sessionInsights.trace.mark.branchSummary",
	customMessage: "sessionInsights.trace.mark.customMessage",
	system: "sessionInsights.trace.mark.system",
} as const satisfies Record<MarkKind, MessageKey>;

function toolIcon(tool: string): Icon {
	switch (tool) {
		case "bash":
		case "background_command":
			return RiTerminalLine;
		case "read":
			return RiBookOpenLine;
		case "edit":
			return RiPencilLine;
		case "write":
			return RiFileAddLine;
		case "grep":
		case "find":
			return RiFileSearchLine;
		case "ls":
			return RiFolderOpenLine;
		case "Agent":
		case "get_subagent_result":
			return RiRobot2Line;
		case "ask_user_question":
			return RiQuestionAnswerLine;
		case "web_search":
		case "fetch_content":
		case "get_search_content":
		case "source_check":
			return RiGlobalLine;
		default:
			if (tool.startsWith("todo_")) return RiListCheck2;
			if (tool.startsWith("spec_")) return RiNodeTree;
			return RiHammerLine;
	}
}

export const TRIGGER_ICON = {
	prompt: RiUser3Line,
	background: RiTerminalLine,
	subagent: RiRobot2Line,
} as const satisfies Record<TurnTrigger, Icon>;

export const TRIGGER_TITLE = {
	prompt: "sessionInsights.trace.turn",
	background: "sessionInsights.trace.turnBackground",
	subagent: "sessionInsights.trace.turnSubagent",
} as const satisfies Record<TurnTrigger, MessageKey>;

export function eventIcon(event: TraceEvent): Icon {
	switch (event.kind) {
		case "turn":
			return TRIGGER_ICON[event.trigger];
		case "llm":
			return event.thinking === "none" ? RiSparklingLine : RiBrainLine;
		case "tool":
			return toolIcon(event.tool);
		case "subagent":
			return RiRobot2Line;
		case "mark":
			return MARK_ICON[event.mark];
	}
}

export function eventTone(event: TraceEvent): string {
	if (event.kind === "turn") return "text-primary";
	if (event.kind === "subagent") return SERIES_TEXT[roleSeries(event.role)];
	const series = seriesOf(event);
	return series ? SERIES_TEXT[series] : "text-text-muted";
}

/** The row's name: the tool, the model, the turn number, the marker. */
export function eventTitle(t: Translator, event: TraceEvent): string {
	switch (event.kind) {
		case "turn":
			return t(TRIGGER_TITLE[event.trigger], { n: event.n });
		case "llm":
			return event.model?.split("/").pop() ?? t("sessionInsights.trace.llm");
		case "tool":
			return event.tool;
		case "subagent":
			return event.role ?? t("sessionInsights.trace.subagent");
		case "mark":
			return t(MARK_TITLE[event.mark]);
	}
}

/** The row's second line: the prompt, the reply's first line, the call's main argument, the marker detail. */
export function eventSubtitle(t: Translator, model: TraceModel, index: number): string {
	const event = model.at(index);
	if (!event) return "";
	if (event.label) return event.label;
	switch (event.kind) {
		case "llm": {
			const tools: string[] = [];
			const end = model.end[index] ?? index + 1;
			for (let at = index + 1; at < end; at++) {
				const child = model.at(at);
				if (child?.kind === "tool" && !tools.includes(child.tool)) tools.push(child.tool);
			}
			return tools.length > 0 ? t("sessionInsights.trace.calls", { tools: tools.join(", ") }) : "";
		}
		case "mark":
			return event.detail ?? (event.tokensBefore !== undefined ? String(event.tokensBefore) : "");
		default:
			return "";
	}
}

export function rowDomId(sessionId: string, eventId: string): string {
	return `session-insights-trace-${sessionId}-${eventId}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function Badges({
	event,
	repeat,
	repeatOpen,
	loading,
}: {
	event: TraceEvent;
	repeat: RepeatGroup | undefined;
	repeatOpen: boolean;
	loading: boolean;
}) {
	const t = useT();
	const locale = localeOf(t);
	const duration = event.t1 > event.t0 && event.kind !== "turn" ? event.t1 - event.t0 : null;
	return (
		<span className="ml-auto flex shrink-0 items-center gap-4 pl-4 tr-text-caption">
			{repeat ? (
				<span
					data-repeat
					data-testid="trace-repeat-badge"
					data-open={repeatOpen ? "true" : "false"}
					title={t(
						repeatOpen ? "sessionInsights.trace.repeatFold" : "sessionInsights.trace.repeatUnfold",
					)}
					className="cursor-pointer rounded-sm bg-feedback-warning-subtle px-4 text-feedback-warning tabular-nums hover:underline"
				>
					{t("sessionInsights.trace.repeat", { n: formatCount(locale, repeat.ids.length) })}
				</span>
			) : null}
			{loading ? (
				<span className="text-text-subtle">{t("sessionInsights.trace.childLoading")}</span>
			) : null}
			{event.kind === "tool" && event.missing ? (
				<span className="rounded-sm bg-feedback-error-subtle px-4 text-feedback-error">
					{t("sessionInsights.trace.noResult")}
				</span>
			) : null}
			{event.error && event.kind === "tool" && !event.missing ? (
				<span
					data-testid="trace-error-badge"
					className="rounded-sm bg-feedback-error-subtle px-4 text-feedback-error"
				>
					{event.exit && event.exit !== "error"
						? t("sessionInsights.trace.exit", { code: event.exit })
						: t("sessionInsights.trace.failed")}
				</span>
			) : null}
			{event.error && event.kind === "llm" ? (
				<span className="rounded-sm bg-feedback-error-subtle px-4 text-feedback-error">
					{event.stop}
				</span>
			) : null}
			{event.kind === "subagent" && event.status ? (
				<span
					className={cn(
						"rounded-sm px-4",
						event.error ? "bg-feedback-error-subtle text-feedback-error" : "text-text-subtle",
					)}
				>
					{event.status}
				</span>
			) : null}
			{event.kind === "llm" ? (
				<span className="text-text-subtle tabular-nums">
					{t("sessionInsights.trace.outputTokens", {
						tokens: formatTokens(locale, event.tokens.output),
					})}
				</span>
			) : null}
			{duration !== null ? (
				<span className="text-text-subtle tabular-nums">
					{event.timing === "approximated" ? "≈" : ""}
					{formatSpan(t, locale, duration)}
				</span>
			) : null}
		</span>
	);
}

function HiddenRow({ model, first, count }: { model: TraceModel; first: number; count: number }) {
	const t = useT();
	const locale = localeOf(t);
	const depth = model.at(first)?.depth ?? 0;
	return (
		<div
			role="treeitem"
			tabIndex={-1}
			aria-level={depth + 1}
			aria-selected={false}
			data-testid="trace-hidden-run"
			data-run={first}
			className="flex h-24 min-w-0 cursor-pointer items-center gap-4 border-border-muted border-b pr-8 tr-text-metadata text-text-subtle hover:bg-control-bg-hovered"
		>
			<span className={cn("shrink-0", INDENT[Math.min(depth, INDENT.length - 1)])} />
			<span className="size-16 shrink-0" />
			<span className="truncate italic">
				{t("sessionInsights.trace.hiddenRows", { count, n: formatCount(locale, count) })}
			</span>
		</div>
	);
}

function TraceRow({
	sessionId,
	model,
	index,
	open,
	expandable,
	selected,
	hit,
	dimmed,
	repeat,
	repeatOpen,
	loading,
}: {
	sessionId: string;
	model: TraceModel;
	index: number;
	open: boolean;
	expandable: boolean;
	selected: boolean;
	hit: boolean;
	dimmed: boolean;
	repeat: RepeatGroup | undefined;
	repeatOpen: boolean;
	loading: boolean;
}) {
	const t = useT();
	const event = model.at(index);
	if (!event) return null;
	const Icon = eventIcon(event);
	const children = expandable;
	const Chevron = open ? RiArrowDownSLine : RiArrowRightSLine;
	const subtitle = eventSubtitle(t, model, index);
	return (
		<div
			role="treeitem"
			tabIndex={-1}
			id={rowDomId(sessionId, event.id)}
			aria-level={event.depth + 1}
			aria-expanded={children ? open : undefined}
			aria-selected={selected}
			data-testid="trace-row"
			data-index={index}
			data-kind={event.kind}
			data-event-id={event.id}
			data-error={event.error ? "true" : undefined}
			data-selected={selected ? "true" : undefined}
			data-dimmed={dimmed ? "true" : undefined}
			className={cn(
				"flex h-24 min-w-0 cursor-default items-center gap-4 border-border-muted border-b pr-8 tr-text-metadata",
				selected ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
				hit && !selected && "bg-feedback-warning-subtle",
				dimmed && !selected && "text-text-subtle [&_*]:text-text-subtle",
			)}
		>
			<span className="flex min-w-0 flex-1 items-center gap-4">
				<span className={cn("shrink-0", INDENT[Math.min(event.depth, INDENT.length - 1)])} />
				<span
					data-twisty
					className="flex size-16 shrink-0 items-center justify-center text-text-muted"
				>
					{children ? <Chevron aria-hidden className="size-14" /> : null}
				</span>
				<Icon aria-hidden className={cn("size-14 shrink-0", eventTone(event))} />
				<span
					className={cn(
						"shrink-0 truncate",
						event.kind === "tool" ? "tr-code-text-small text-text-default" : "text-text-default",
						event.kind === "turn" && "text-primary",
					)}
				>
					{eventTitle(t, event)}
				</span>
				{subtitle ? (
					<span
						className={cn(
							"min-w-0 truncate text-text-muted",
							event.kind === "tool" && "tr-code-text-small",
						)}
					>
						{subtitle}
					</span>
				) : null}
				<Badges event={event} repeat={repeat} repeatOpen={repeatOpen} loading={loading} />
			</span>
		</div>
	);
}

export interface TreeKeys {
	onMove: (delta: number | "first" | "last") => void;
	onExpand: (open: boolean) => void;
	onActivate: () => void;
	onSearchStep: (step: 1 | -1) => void;
	onErrorStep: (step: 1 | -1) => void;
	onRetryStep: (step: 1 | -1) => void;
	onFocusSearch: () => void;
	onZoomSelection: () => void;
	onZoom: (factor: number | "fit") => void;
}

const PAGE_ROWS = 10;

export interface TreeRows {
	rows: readonly number[];
	runs: ReadonlyMap<number, number>;
	/** Focus mode: rows outside are dimmed. */
	keep: Uint8Array | null;
	repeats: ReadonlyMap<number, RepeatGroup>;
	repeatOpen: ReadonlySet<string>;
	/** Subagents whose transcript is loading, by child id. */
	loading: ReadonlySet<string>;
	expandable: (index: number) => boolean;
	open: (index: number) => boolean;
}

export function TraceTree({
	sessionId,
	model,
	view,
	selected,
	hits,
	virtuoso,
	onScroller,
	onSelect,
	onToggle,
	onToggleRepeat,
	onExpandRun,
	keys,
	label,
}: {
	sessionId: string;
	model: TraceModel;
	view: TreeRows;
	selected: number;
	hits: ReadonlySet<number>;
	virtuoso: RefObject<VirtuosoHandle | null>;
	onScroller: (element: HTMLElement | null) => void;
	onSelect: (index: number) => void;
	onToggle: (index: number) => void;
	onToggleRepeat: (index: number) => void;
	onExpandRun: (first: number) => void;
	keys: TreeKeys;
	label: string;
}) {
	const { rows } = view;
	const selectedEvent = model.at(selected);
	const local = useLocalKeys(PANEL_SCOPE, PANEL_COMMANDS);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const commands: Record<string, () => void> = {
			[PANEL_KEYS.nextMatch]: () => keys.onSearchStep(1),
			[PANEL_KEYS.previousMatch]: () => keys.onSearchStep(-1),
			[PANEL_KEYS.nextError]: () => keys.onErrorStep(1),
			[PANEL_KEYS.previousError]: () => keys.onErrorStep(-1),
			[PANEL_KEYS.nextRetry]: () => keys.onRetryStep(1),
			[PANEL_KEYS.previousRetry]: () => keys.onRetryStep(-1),
			[PANEL_KEYS.search]: keys.onFocusSearch,
			[PANEL_KEYS.zoomToSelection]: keys.onZoomSelection,
			[PANEL_KEYS.zoomIn]: () => keys.onZoom(0.6),
			[PANEL_KEYS.zoomOut]: () => keys.onZoom(1 / 0.6),
			[PANEL_KEYS.zoomFit]: () => keys.onZoom("fit"),
		};
		const navigation: Record<string, () => void> = {
			ArrowDown: () => keys.onMove(1),
			ArrowUp: () => keys.onMove(-1),
			PageDown: () => keys.onMove(PAGE_ROWS),
			PageUp: () => keys.onMove(-PAGE_ROWS),
			Home: () => keys.onMove("first"),
			End: () => keys.onMove("last"),
			ArrowRight: () => keys.onExpand(true),
			ArrowLeft: () => keys.onExpand(false),
			Enter: keys.onActivate,
		};
		const command = local.match(event.nativeEvent);
		const action =
			command === null ? (plainKey(event) ? navigation[event.key] : undefined) : commands[command];
		if (!action) return;
		event.preventDefault();
		action();
	};
	const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.focus({ preventScroll: true });
	};
	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		if (!(event.target instanceof Element)) return;
		const run = event.target.closest<HTMLElement>("[data-run]");
		if (run) {
			onExpandRun(Number(run.dataset.run));
			return;
		}
		const row = event.target.closest<HTMLElement>("[data-index]");
		const index = Number(row?.dataset.index);
		if (!row || !Number.isInteger(index)) return;
		if (event.target.closest("[data-repeat]")) onToggleRepeat(index);
		else if (event.target.closest("[data-twisty]") && view.expandable(index)) onToggle(index);
		else onSelect(index);
	};
	return (
		<div
			role="tree"
			aria-label={label}
			aria-activedescendant={selectedEvent ? rowDomId(sessionId, selectedEvent.id) : undefined}
			tabIndex={0}
			data-testid="trace-tree"
			data-key-scope={PANEL_SCOPE}
			aria-keyshortcuts={local.aria(...Object.values(PANEL_KEYS))}
			onKeyDown={onKeyDown}
			onMouseDown={onMouseDown}
			onClick={onClick}
			className="h-full min-h-0 focus-visible:focus-ring-inset"
		>
			<Virtuoso
				ref={virtuoso}
				data={rows}
				fixedItemHeight={ROW_HEIGHT}
				increaseViewportBy={ROW_HEIGHT * 10}
				scrollerRef={(element) => onScroller(element instanceof HTMLElement ? element : null)}
				computeItemKey={(_, index) =>
					index < 0 ? `run:${runStart(index)}` : (model.at(index)?.id ?? String(index))
				}
				itemContent={(_, index) => {
					if (index < 0)
						return (
							<HiddenRow
								model={model}
								first={runStart(index)}
								count={view.runs.get(runStart(index)) ?? 0}
							/>
						);
					const event = model.at(index);
					const repeat = view.repeats.get(index);
					return (
						<TraceRow
							sessionId={sessionId}
							model={model}
							index={index}
							open={view.open(index)}
							expandable={view.expandable(index)}
							selected={index === selected}
							hit={hits.has(index)}
							dimmed={view.keep !== null && !view.keep[index]}
							repeat={repeat}
							repeatOpen={repeat ? view.repeatOpen.has(repeat.ids[0] ?? "") : false}
							loading={event?.kind === "subagent" && view.loading.has(event.childId)}
						/>
					);
				}}
				className="h-full"
			/>
		</div>
	);
}
