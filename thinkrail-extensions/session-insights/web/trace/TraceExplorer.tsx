import {
	RiArrowDownSLine,
	RiArrowUpSLine,
	RiCloseLine,
	RiSearchLine,
	RiZoomInLine,
	RiZoomOutLine,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, useT } from "@thinkrail/locales/react";
import type { SessionAnalysis, SessionOverview } from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { DetailsPanel } from "../details/DetailsPanel";
import { formatClock, formatCount, formatDay, formatDuration, formatSpan } from "../format";
import { keyLabels, PANEL_COMMANDS, PANEL_KEYS, PANEL_SCOPE } from "../keys";
import { type LoadedTrace, searchTrace } from "../session/api";
import { BandMenu } from "./BandMenu";
import { bandLabel } from "./bandCopy";
import { type BandPick, bandSteps, pickIntervals, samePick } from "./bands";
import { childEventId } from "./children";
import { ROW_HEIGHT, rowInView, type ScrollAlign, scrollTarget } from "./frame";
import { type Flow, type GanttState, type GanttText, headerBands } from "./gantt";
import { Legend } from "./Legend";
import { useCanvasLook } from "./look";
import {
	cycle,
	repeatHidden,
	retryIds,
	revealed,
	type TraceFilter,
	type TraceModel,
	unfoldFor,
} from "./model";
import {
	COMPRESS_GAPS_OVER_MS,
	fitView,
	TimeScale,
	type View,
	viewAround,
	viewContaining,
	zoomView,
} from "./scale";
import { HEADER_CLASS, TraceGantt } from "./TraceGantt";
import { eventTitle, TraceTree, type TreeRows } from "./TraceTree";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_CHARS = 2;
const ZOOM_STEP = 0.6;
/** Frames a scroll to a row is retried while the list lays out (about a second). */
const SCROLL_TRIES = 60;

interface TimeWindow {
	t0: number;
	t1: number;
}

interface Search {
	query: string;
	ids: readonly string[];
	busy: boolean;
	truncated: boolean;
}

/** Events another section asked the trace to focus on: a recovery chain's attempts and steps. */
export interface TraceFocus {
	ids: readonly string[];
	label: string;
}

/** What another section asked the trace to show when it opens: a focus and rows to expand. */
export interface TraceIntent {
	focus: TraceFocus | null;
	expand: readonly string[];
}

type Selection = { kind: "ids"; focus: TraceFocus } | { kind: "pick"; pick: BandPick };

/** The trace's folds and top row as the session view keeps them across remounts. */
export interface TraceMemory {
	/** Read once, when the explorer mounts. */
	read: () => { open: readonly (readonly [string, boolean])[]; top: string | null };
	onFolds: (open: ReadonlyMap<string, boolean>) => void;
	onTop: (eventId: string | null) => void;
}

/** A scroll the explorer still owes: to an event at the top, or to the selection (`id` null). */
interface ScrollAim {
	id: string | null;
	align: ScrollAlign;
}

/** Subagent transcripts nested into the trace on demand. */
export interface ChildTraces {
	/** Child ids whose transcript the trace can expand. */
	available: ReadonlySet<string>;
	loaded: ReadonlySet<string>;
	loading: ReadonlySet<string>;
	load: (childId: string) => void;
}

/**
 * The trace section: a tree column and the Gantt on one axis, with the call details beside them. The
 * selection is the session view's, shared with the turn cards and the timeline.
 */
export function TraceExplorer({
	host,
	sessionId,
	overview,
	trace,
	model,
	selected,
	onSelect,
	analysis,
	subtraces,
	intent,
	awaiting = false,
	memory,
	reveal = true,
	toolbarStart,
}: {
	host: PanelHost;
	sessionId: string;
	overview: SessionOverview | null;
	trace: LoadedTrace;
	model: TraceModel;
	selected: number;
	onSelect: (index: number) => void;
	analysis: SessionAnalysis | null;
	subtraces: ChildTraces;
	intent: TraceIntent | null;
	/** The selected event is on a page still to come: keep the reveal pending until it arrives. */
	awaiting?: boolean;
	memory?: TraceMemory | undefined;
	/** Scroll the selection into view on mount (a jump) rather than back to the remembered top row. */
	reveal?: boolean;
	/** Leads the toolbar (the trace's view modes). */
	toolbarStart?: ReactNode;
}) {
	const t = useT();
	const locale = localeOf(t);
	const local = useLocalKeys(PANEL_SCOPE, PANEL_COMMANDS);
	const initialFocus = intent?.focus ?? null;
	const [saved] = useState(() => memory?.read() ?? null);
	const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(() =>
		revealed(
			model,
			new Map([...(saved?.open ?? []), ...(intent?.expand ?? []).map((id) => [id, true] as const)]),
			selected,
		),
	);
	const [pending, setPending] = useState<string | null>(null);
	const [filter, setFilter] = useState<TraceFilter>(initialFocus ? "selection" : "all");
	const [focus, setFocus] = useState(initialFocus !== null);
	const [selection, setSelection] = useState<Selection | null>(
		initialFocus ? { kind: "ids", focus: initialFocus } : null,
	);
	const [showBands, setShowBands] = useState(true);
	const [repeatOpen, setRepeatOpen] = useState<ReadonlySet<string>>(new Set());
	const [expandedRuns, setExpandedRuns] = useState<ReadonlySet<number>>(new Set());
	const [compress, setCompress] = useState(true);
	const [timeWindow, setTimeWindow] = useState<TimeWindow | null>(null);
	const [search, setSearch] = useState<Search>({
		query: "",
		ids: [],
		busy: false,
		truncated: false,
	});
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [scroller, setScroller] = useState<HTMLElement | null>(null);
	const virtuoso = useRef<VirtuosoHandle>(null);
	const searchInput = useRef<HTMLInputElement>(null);
	const tree = useRef<HTMLDivElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);
	const aim = useRef<ScrollAim | null>(
		!reveal && saved?.top ? { id: saved.top, align: "start" } : { id: null, align: "center" },
	);
	const stacked = host.placement === "chatPane";
	const { palette, font } = useCanvasLook(root);

	const start = trace.meta.start ?? 0;
	const end = trace.meta.end ?? start;
	const scale = useMemo(
		() => new TimeScale(start, end, trace.meta.gaps, compress ? COMPRESS_GAPS_OVER_MS : null),
		[compress, end, start, trace.meta.gaps],
	);
	const view: View = timeWindow
		? { u0: scale.toUnit(timeWindow.t0), u1: scale.toUnit(timeWindow.t1) }
		: fitView(scale);
	const repeats = analysis?.repeats ?? [];
	const retries = useMemo(() => retryIds(analysis?.chains ?? []), [analysis]);
	const retryChains = (analysis?.chains ?? []).filter(
		(chain) => chain.kind === "tool" && chain.attempts.length > 1,
	).length;
	const retryOrder = useMemo(
		() =>
			retries
				.map((id) => model.indexOf(id))
				.filter((at) => at >= 0)
				.sort((a, b) => a - b),
		[model, retries],
	);
	const match = useMemo(() => {
		switch (filter) {
			case "all":
				return null;
			case "errors":
				return model.failureMask();
			case "repeats":
				return model.mask(repeats.flatMap((group) => group.ids));
			case "retries":
				return model.mask(retries);
			case "selection":
				if (!selection) return null;
				return selection.kind === "ids"
					? model.mask(selection.focus.ids)
					: model.during(pickIntervals(analysis, selection.pick));
		}
	}, [analysis, filter, model, repeats, retries, selection]);
	const collapsed = useMemo(
		() => repeatHidden(model, repeats, repeatOpen, match),
		[match, model, repeats, repeatOpen],
	);
	const list = useMemo(
		() =>
			model.visible(open, match, {
				focus,
				hidden: collapsed.hidden,
				expanded: expandedRuns,
			}),
		[collapsed.hidden, expandedRuns, focus, match, model, open],
	);
	const rows = list.rows;
	const hits = useMemo(
		() => new Set(search.ids.map((id) => model.indexOf(id)).filter((at) => at >= 0)),
		[model, search.ids],
	);
	const hitOrder = useMemo(() => [...hits].sort((a, b) => a - b), [hits]);
	const failures = useMemo(() => model.failures(), [model]);
	const expandable = (index: number) => {
		if (model.hasChildren(index)) return true;
		const event = model.at(index);
		return (
			event?.kind === "subagent" &&
			subtraces.available.has(event.childId) &&
			!subtraces.loaded.has(event.childId)
		);
	};
	const isOpen = (index: number) => {
		if (match && !focus) return model.hasChildren(index);
		if (focus && list.keep?.[index] && !match?.[index] && model.hasChildren(index)) return true;
		const event = model.at(index);
		if (event?.kind === "subagent" && subtraces.loading.has(event.childId)) return true;
		return model.isOpen(index, open);
	};
	const pick = selection?.kind === "pick" ? selection.pick : null;
	const bandsShown = showBands && analysis !== null;
	const bands = headerBands(
		bandsShown && bandSteps(analysis).length > 0,
		bandsShown && (analysis?.skills.length ?? 0) > 0,
	);
	const headerClass = HEADER_CLASS[bands.reduce((sum, band) => sum + band.height, 0)] ?? "h-50";

	const selectionFolded = [selected, ...model.ancestors(selected)].some(
		(at) => collapsed.hidden?.[at] === 1,
	);
	useEffect(() => {
		if (awaiting) return;
		if (selectionFolded) {
			const unfolded = unfoldFor(model, repeats, repeatOpen, selected, match);
			if (unfolded !== repeatOpen) {
				if (!aim.current) aim.current = { id: null, align: "nearest" };
				setRepeatOpen(unfolded);
				return;
			}
		}
		const owed = aim.current;
		if (!owed) return;
		if (owed.id === null) {
			const shown = revealed(model, open, selected);
			if (shown !== open) {
				setOpen(shown);
				return;
			}
		}
		const target = owed.id === null ? selected : model.indexOf(owed.id);
		const row = target < 0 ? -1 : rows.indexOf(target);
		if (row < 0) {
			if (owed.id !== null && trace.complete) aim.current = null;
			return;
		}
		let frame = 0;
		let tries = 0;
		let attempted = false;
		const run = () => {
			const box = scroller;
			if (box && box.clientHeight > 0) {
				if (attempted && rowInView(row, box.scrollTop, box.clientHeight)) {
					aim.current = null;
					return;
				}
				const align = attempted ? "center" : owed.align;
				const top = scrollTarget(row, box.scrollTop, box.clientHeight, align);
				if (top === null && !attempted && owed.align !== "start") {
					aim.current = null;
					return;
				}
				attempted = true;
				if (top !== null) virtuoso.current?.scrollTo({ top });
			}
			tries += 1;
			if (tries < SCROLL_TRIES) frame = requestAnimationFrame(run);
			else aim.current = null;
		};
		run();
		return () => cancelAnimationFrame(frame);
	}, [
		awaiting,
		match,
		model,
		open,
		repeatOpen,
		repeats,
		rows,
		selected,
		selectionFolded,
		scroller,
		trace.complete,
	]);

	useEffect(() => {
		memory?.onFolds(open);
	}, [memory, open]);

	useEffect(() => {
		if (!scroller || !memory) return;
		const report = () => {
			let at = Math.floor(scroller.scrollTop / ROW_HEIGHT);
			while ((rows[at] ?? 0) < 0) at += 1;
			const index = rows[at];
			memory.onTop(index === undefined ? null : (model.at(index)?.id ?? null));
		};
		scroller.addEventListener("scroll", report, { passive: true });
		return () => scroller.removeEventListener("scroll", report);
	}, [memory, model, rows, scroller]);

	useEffect(() => {
		const query = search.query.trim();
		if (query.length < SEARCH_MIN_CHARS) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			searchTrace(host, sessionId, query, controller.signal).then(
				(result) => {
					if (!controller.signal.aborted)
						setSearch((current) =>
							current.query.trim() === query
								? { ...current, ids: result.ids, busy: false, truncated: result.truncated }
								: current,
						);
				},
				() => {
					if (!controller.signal.aborted)
						setSearch((current) => ({ ...current, ids: [], busy: false, truncated: false }));
				},
			);
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [host, search.query, sessionId]);

	const setView = (next: View) =>
		setTimeWindow({ t0: scale.toTime(next.u0), t1: scale.toTime(next.u1) });

	const select = (index: number, follow = true) => {
		const event = model.at(index);
		if (!event) return;
		const nextOpen = revealed(model, open, index);
		const nextRepeats = unfoldFor(model, repeats, repeatOpen, index, match);
		const hidden = repeatHidden(model, repeats, nextRepeats, match).hidden;
		const shown = model
			.visible(nextOpen, match, { focus, hidden, expanded: expandedRuns })
			.rows.includes(index);
		if (!shown) {
			setFilter("all");
			setFocus(false);
		}
		setOpen(nextOpen);
		if (nextRepeats !== repeatOpen) setRepeatOpen(nextRepeats);
		onSelect(index);
		aim.current = { id: null, align: "nearest" };
		if (follow) setView(viewContaining(scale, view, event.t0));
	};

	const zoomTo = (index: number) => {
		const event = model.at(index);
		if (event) setView(viewAround(scale, event.t0, event.t1, 0.4));
	};

	const toggle = (index: number) => {
		const event = model.at(index);
		if (!event) return;
		if (
			event.kind === "subagent" &&
			subtraces.available.has(event.childId) &&
			!subtraces.loaded.has(event.childId)
		) {
			subtraces.load(event.childId);
			setOpen((current) => new Map(current).set(event.id, true));
			return;
		}
		setOpen((current) => new Map(current).set(event.id, !model.isOpen(index, current)));
	};

	const showChild = (childId: string, eventId: string | null) => {
		const subagent = `sub:${childId}`;
		if (!subtraces.loaded.has(childId) && subtraces.available.has(childId)) subtraces.load(childId);
		setOpen((current) => new Map(current).set(subagent, true));
		const target = eventId === null ? subagent : childEventId(childId, eventId);
		const at = model.indexOf(target);
		if (at >= 0 && (eventId === null || subtraces.loaded.has(childId))) select(at);
		else setPending(target);
	};

	useEffect(() => {
		if (pending === null) return;
		const at = model.indexOf(pending);
		if (at < 0) return;
		setPending(null);
		select(at);
	});

	const toggleRepeat = (index: number) => {
		const first = collapsed.heads.get(index)?.ids[0];
		if (!first) return;
		const next = new Set(repeatOpen);
		if (!collapsed.open.has(first)) {
			setRepeatOpen(next.add(first));
			return;
		}
		next.delete(first);
		if (repeatHidden(model, repeats, next, match).open.has(first)) return;
		setRepeatOpen(next);
		if (unfoldFor(model, repeats, next, selected, match) !== next) select(index, false);
	};

	const choosePick = (next: BandPick) => {
		if (selection?.kind === "pick" && samePick(selection.pick, next)) {
			setSelection(null);
			setFilter("all");
			return;
		}
		setSelection({ kind: "pick", pick: next });
		setFilter("selection");
		setFocus(true);
		setExpandedRuns(new Set());
	};

	const clearSelection = () => {
		setSelection(null);
		if (filter === "selection") setFilter("all");
	};

	const chooseFilter = (next: TraceFilter) => {
		setFilter(filter === next ? "all" : next);
		setExpandedRuns(new Set());
	};

	const rowOf = (index: number) => rows.indexOf(index);

	const keys = {
		onMove: (delta: number | "first" | "last") => {
			if (rows.length === 0) return;
			const at = Math.max(0, rowOf(selected));
			let next =
				delta === "first"
					? 0
					: delta === "last"
						? rows.length - 1
						: Math.max(0, Math.min(rows.length - 1, at + delta));
			const step = delta === "last" || (typeof delta === "number" && delta < 0) ? -1 : 1;
			while ((rows[next] ?? 0) < 0 && next + step >= 0 && next + step < rows.length) next += step;
			const target = rows[next];
			if (target !== undefined && target >= 0) select(target);
		},
		onExpand: (expand: boolean) => {
			const opened = isOpen(selected);
			if (expand) {
				if (expandable(selected) && !opened) toggle(selected);
				else if (collapsed.heads.has(selected)) toggleRepeat(selected);
				else if (opened) select(selected + 1);
				return;
			}
			if (opened && !(match && !focus) && model.hasChildren(selected)) toggle(selected);
			else {
				const parent = model.parent[selected] ?? -1;
				if (parent >= 0) select(parent);
			}
		},
		onActivate: () =>
			tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
		onSearchStep: (step: 1 | -1) => {
			const next = cycle(hitOrder, selected, step);
			if (next !== null) select(next);
		},
		onErrorStep: (step: 1 | -1) => {
			const next = cycle(failures, selected, step);
			if (next !== null) select(next);
		},
		onRetryStep: (step: 1 | -1) => {
			const next = cycle(retryOrder, selected, step);
			if (next !== null) select(next);
		},
		onFocusSearch: () => searchInput.current?.focus(),
		onZoomSelection: () => zoomTo(selected),
		onZoom: (factor: number | "fit") => {
			if (factor === "fit") setTimeWindow(null);
			else setView(zoomView(scale, view, (view.u0 + view.u1) / 2, factor));
		},
	};

	const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
		if (isImeComposing(event.nativeEvent)) return;
		event.stopPropagation();
		if (event.key === "Enter") {
			event.preventDefault();
			keys.onSearchStep(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			setSearch({ query: "", ids: [], busy: false, truncated: false });
			tree.current?.querySelector<HTMLElement>('[role="tree"]')?.focus();
		}
	};

	const text: GanttText = useMemo(
		() => ({
			font,
			time: (ms, seconds) => formatClock(locale, ms, seconds),
			date: (ms) => formatDay(locale, ms),
			breakLabel: (gap) =>
				t("sessionInsights.trace.gap", { duration: formatDuration(t, gap.t1 - gap.t0) }),
			hover: (index) => {
				const event = model.at(index);
				if (!event) return "";
				const title = eventTitle(t, event);
				return event.t1 > event.t0 && event.kind !== "turn"
					? `${title} · ${event.timing === "approximated" ? "≈" : ""}${formatSpan(t, locale, event.t1 - event.t0)}`
					: title;
			},
			band: (next) => bandLabel(t, locale, analysis, next),
			hidden: (count) =>
				t("sessionInsights.trace.hiddenRows", { count, n: formatCount(locale, count) }),
		}),
		[analysis, font, locale, model, t],
	);

	const flows = useMemo((): Flow[] => {
		const event = model.at(selected);
		if (!event) return [];
		const subagentAt =
			event.kind === "subagent"
				? selected
				: event.kind === "tool" && model.at(selected + 1)?.kind === "subagent"
					? selected + 1
					: -1;
		const sub = model.at(subagentAt);
		if (sub?.kind !== "subagent") return [];
		const out: Flow[] = [];
		const spawn = model.parent[subagentAt] ?? -1;
		const firstChild = model.hasChildren(subagentAt) ? subagentAt + 1 : subagentAt;
		const childStart = model.at(firstChild)?.t0 ?? sub.t0;
		if (spawn >= 0)
			out.push({
				from: { index: spawn, t: model.at(spawn)?.t0 ?? sub.t0 },
				to: { index: firstChild, t: childStart },
				tone: "spawn",
			});
		const reader = sub.consumedBy ? model.indexOf(sub.consumedBy) : -1;
		const reading = model.at(reader);
		if (reading)
			out.push({
				from: { index: subagentAt, t: sub.t1 },
				to: { index: reader, t: reading.t0 },
				tone: "return",
			});
		return out;
	}, [model, selected]);

	const ganttState: GanttState = useMemo(
		() => ({
			model,
			rows,
			runs: list.runs,
			open: (index: number) => {
				if (match && !focus) return model.hasChildren(index);
				if (focus && list.keep?.[index] && !match?.[index] && model.hasChildren(index)) return true;
				return model.isOpen(index, open);
			},
			scale,
			view: timeWindow
				? { u0: scale.toUnit(timeWindow.t0), u1: scale.toUnit(timeWindow.t1) }
				: fitView(scale),
			selected,
			hits,
			bands,
			analysis,
			pick,
			keep: focus ? list.keep : null,
			flows,
		}),
		[
			analysis,
			bands,
			flows,
			focus,
			hits,
			list,
			match,
			model,
			open,
			pick,
			rows,
			scale,
			selected,
			timeWindow,
		],
	);

	const treeView: TreeRows = {
		rows,
		runs: list.runs,
		keep: focus ? list.keep : null,
		repeats: collapsed.heads,
		repeatOpen: collapsed.open,
		loading: subtraces.loading,
		expandable,
		open: isOpen,
	};

	const hitPosition = hitOrder.indexOf(selected);
	const query = search.query.trim();
	const searching = query.length >= SEARCH_MIN_CHARS;
	const steps = bandSteps(analysis);
	const skills = analysis?.skills ?? [];
	const selectionLabel =
		selection?.kind === "ids"
			? selection.focus.label
			: selection
				? bandLabel(t, locale, analysis, selection.pick)
				: null;

	return (
		<div ref={setRoot} data-testid="trace-explorer" className="flex h-full min-h-0 flex-col">
			<div
				role="toolbar"
				aria-label={t("sessionInsights.trace.toolbar")}
				className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-b px-12 py-4"
			>
				{toolbarStart}
				<span className="flex min-w-160 items-center gap-4">
					<RiSearchLine aria-hidden className="size-14 shrink-0 text-text-subtle" />
					<input
						ref={searchInput}
						type="search"
						data-testid="trace-search"
						value={search.query}
						placeholder={t("sessionInsights.trace.search")}
						aria-label={t("sessionInsights.trace.search")}
						onChange={(event) =>
							setSearch({
								query: event.target.value,
								ids: [],
								busy: event.target.value.trim().length >= SEARCH_MIN_CHARS,
								truncated: false,
							})
						}
						onKeyDown={onSearchKey}
						className="h-24 min-w-0 flex-1 rounded-sm border border-control-border-default bg-control-bg px-4 tr-text-metadata text-text-default placeholder:text-text-subtle focus-visible:focus-ring focus:border-control-border-active"
					/>
				</span>
				{searching ? (
					<span
						data-testid="trace-search-count"
						className="tr-text-caption text-text-subtle tabular-nums"
					>
						{search.busy
							? t("sessionInsights.trace.searching")
							: hitOrder.length === 0
								? t("sessionInsights.trace.noMatches")
								: t("sessionInsights.trace.matchPosition", {
										at: hitPosition >= 0 ? hitPosition + 1 : 0,
										total: formatCount(locale, hitOrder.length),
									})}
					</span>
				) : null}
				<IconButton
					icon={RiArrowUpSLine}
					size="s"
					label={t("sessionInsights.trace.previousMatch")}
					disabled={hitOrder.length === 0}
					onClick={() => keys.onSearchStep(-1)}
				/>
				<IconButton
					icon={RiArrowDownSLine}
					size="s"
					label={t("sessionInsights.trace.nextMatch")}
					disabled={hitOrder.length === 0}
					onClick={() => keys.onSearchStep(1)}
				/>
				<fieldset
					aria-label={t("sessionInsights.trace.filter")}
					className="flex min-w-0 items-center gap-4"
				>
					<ToggleSegment
						testid="trace-filter-all"
						label={t("sessionInsights.trace.filterAll")}
						active={filter === "all"}
						onClick={() => {
							setFilter("all");
							setExpandedRuns(new Set());
						}}
					/>
					<ToggleSegment
						testid="trace-filter-errors"
						label={t("sessionInsights.trace.filterErrors", {
							count: failures.length,
							n: formatCount(locale, failures.length),
						})}
						active={filter === "errors"}
						onClick={() => chooseFilter("errors")}
					/>
					{repeats.length > 0 ? (
						<ToggleSegment
							testid="trace-filter-repeats"
							label={t("sessionInsights.trace.filterRepeats", {
								count: repeats.length,
								n: formatCount(locale, repeats.length),
							})}
							active={filter === "repeats"}
							onClick={() => chooseFilter("repeats")}
						/>
					) : null}
					{retryChains > 0 ? (
						<ToggleSegment
							testid="trace-filter-retries"
							label={t("sessionInsights.trace.filterRetries", {
								count: retryChains,
								n: formatCount(locale, retryChains),
							})}
							active={filter === "retries"}
							onClick={() => chooseFilter("retries")}
						/>
					) : null}
				</fieldset>
				{selectionLabel ? (
					<span
						data-testid="trace-selection"
						className={cn(
							"flex min-w-0 max-w-320 items-center gap-2 rounded-sm border pl-8 tr-text-metadata",
							filter === "selection"
								? "border-primary-muted text-text-default"
								: "border-border-default text-text-muted",
						)}
					>
						<button
							type="button"
							aria-pressed={filter === "selection"}
							onClick={() => setFilter(filter === "selection" ? "all" : "selection")}
							className="min-w-0 truncate rounded-sm focus-visible:focus-ring"
						>
							{selectionLabel}
						</button>
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("sessionInsights.trace.clearSelection")}
							onClick={clearSelection}
						/>
					</span>
				) : null}
				<ToggleSegment
					testid="trace-focus"
					label={t("sessionInsights.trace.focus")}
					active={focus}
					onClick={() => {
						setFocus(!focus);
						setExpandedRuns(new Set());
					}}
				/>
				<ToggleSegment
					testid="trace-compress"
					label={t("sessionInsights.trace.compress")}
					active={compress}
					onClick={() => setCompress(!compress)}
				/>
				{steps.length > 0 || skills.length > 0 ? (
					<ToggleSegment
						testid="trace-bands"
						label={t("sessionInsights.trace.bands")}
						active={showBands}
						onClick={() => setShowBands(!showBands)}
					/>
				) : null}
				<div className="ml-auto flex items-center gap-4">
					{!trace.complete ? (
						<span
							data-testid="trace-paging"
							className="tr-text-caption text-text-subtle tabular-nums"
						>
							{t("sessionInsights.trace.paging", {
								count: trace.meta.total,
								loaded: formatCount(locale, trace.events.length),
								total: formatCount(locale, trace.meta.total),
							})}
						</span>
					) : null}
					<IconButton
						icon={RiZoomOutLine}
						size="s"
						label={t("sessionInsights.trace.zoomOut")}
						tooltipShortcut={local.caps(PANEL_KEYS.zoomOut)}
						onClick={() => keys.onZoom(1 / ZOOM_STEP)}
					/>
					<IconButton
						icon={RiZoomInLine}
						size="s"
						label={t("sessionInsights.trace.zoomIn")}
						tooltipShortcut={local.caps(PANEL_KEYS.zoomIn)}
						onClick={() => keys.onZoom(ZOOM_STEP)}
					/>
					<Button
						variant="ghost"
						size="s"
						data-testid="trace-fit"
						onClick={() => setTimeWindow(null)}
					>
						{t("sessionInsights.trace.fit")}
					</Button>
				</div>
			</div>
			<ResizablePanelGroup
				direction={stacked ? "vertical" : "horizontal"}
				className="min-h-0 flex-1"
			>
				<ResizablePanel defaultSize={stacked ? 60 : 68} minSize={stacked ? 25 : 40}>
					<div className="flex h-full min-h-0 flex-col">
						<ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
							<ResizablePanel defaultSize={stacked ? 72 : 42} minSize={20}>
								<div ref={tree} className="flex h-full min-h-0 flex-col">
									<div
										className={cn(
											"flex shrink-0 flex-col border-border-default border-b bg-container-header-bg px-12 tr-text-caption text-text-muted",
											headerClass,
										)}
									>
										<span className="flex h-28 shrink-0 items-end truncate pb-4">
											{t("sessionInsights.trace.rows", {
												count: rows.length,
												n: formatCount(locale, rows.length),
											})}
										</span>
										{bands.some((band) => band.key === "plan") ? (
											<BandMenu
												testId="trace-band-plan"
												label={t("sessionInsights.trace.planBand", {
													count: steps.length,
													n: formatCount(locale, steps.length),
												})}
												items={steps.map((step, at) => ({
													key: step.id,
													label: `${at + 1}. ${step.title}`,
													pick: { kind: "step", id: step.id },
												}))}
												current={pick}
												onPick={choosePick}
											/>
										) : null}
										{bands.some((band) => band.key === "skills") ? (
											<BandMenu
												testId="trace-band-skills"
												label={t("sessionInsights.trace.skillsBand", {
													count: skills.length,
													n: formatCount(locale, skills.length),
												})}
												items={skills.map((skill, at) => ({
													key: `${skill.eventId}:${at}`,
													label: skill.name,
													pick: { kind: "skill", index: at },
												}))}
												current={pick}
												onPick={choosePick}
											/>
										) : null}
									</div>
									<div className="min-h-0 flex-1">
										<TraceTree
											sessionId={sessionId}
											model={model}
											view={treeView}
											selected={selected}
											hits={hits}
											virtuoso={virtuoso}
											onScroller={setScroller}
											onSelect={(index) => select(index, false)}
											onToggle={toggle}
											onToggleRepeat={toggleRepeat}
											onExpandRun={(first) => setExpandedRuns(new Set([...expandedRuns, first]))}
											keys={keys}
											label={t("sessionInsights.trace.tree")}
										/>
									</div>
								</div>
							</ResizablePanel>
							<ResizableHandle />
							<ResizablePanel defaultSize={stacked ? 28 : 58} minSize={stacked ? 15 : 25}>
								<TraceGantt
									state={ganttState}
									palette={palette}
									text={text}
									scroller={scroller}
									onSelect={(index) => select(index, false)}
									onView={setView}
									onZoomRow={zoomTo}
									onPick={choosePick}
								/>
							</ResizablePanel>
						</ResizablePanelGroup>
						<Legend
							model={model}
							testId="trace-legend"
							hint={t("sessionInsights.trace.legend.keys", {
								matches: keyLabels(local, PANEL_KEYS.nextMatch, PANEL_KEYS.previousMatch),
								errors: keyLabels(local, PANEL_KEYS.nextError, PANEL_KEYS.previousError),
								retries: keyLabels(local, PANEL_KEYS.nextRetry, PANEL_KEYS.previousRetry),
							})}
						>
							<span className="text-text-subtle">
								{t("sessionInsights.trace.legend.approximated")}
							</span>
						</Legend>
					</div>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel defaultSize={stacked ? 40 : 32} minSize={stacked ? 20 : 22}>
					<div
						data-testid="trace-details-pane"
						data-stacked={stacked ? "true" : undefined}
						className={cn(
							"h-full min-h-0 border-border-default",
							stacked ? "border-t" : "border-l",
						)}
					>
						<DetailsPanel
							host={host}
							sessionId={sessionId}
							model={model}
							index={rows.length > 0 ? selected : -1}
							overview={overview}
							query={searching ? query : ""}
							onSelect={(index) => select(index)}
							onZoom={zoomTo}
							onShowChild={showChild}
							tabsRef={tabsRef}
						/>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
