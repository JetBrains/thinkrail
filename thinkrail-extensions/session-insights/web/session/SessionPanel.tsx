import {
	type RemixiconComponentType,
	RiErrorWarningLine,
	RiFileEditLine,
	RiFlowChart,
	RiLayoutGridLine,
	RiMoneyDollarCircleLine,
	RiNodeTree,
	RiRobot2Line,
	RiStackLine,
	RiTimeLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	SessionAnalysisResult,
	SessionContextResult,
	SessionCostResult,
	SessionFilesResult,
	SessionOverview,
	SessionSubagentsResult,
	SessionTimelineResult,
	TraceEvent,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { type ContextMode, ContextView } from "../context/ContextView";
import { CostView } from "../cost/CostView";
import { DetailsContext, type DetailsHost, type ShowOutcome } from "../details/context";
import type { DetailTab } from "../details/tabs";
import { ErrorsView } from "../errors/ErrorsView";
import type { ExportTurn } from "../export/ExportMenu";
import { FilesView } from "../files/FilesView";
import { onSessionFocus, pendingSessionFocus, settleSessionFocus } from "../focus";
import { formatCount } from "../format";
import { useLabels } from "../labels/api";
import { hostServesThisVersion } from "../load";
import { OverviewView } from "../overview/OverviewView";
import { SubagentsView } from "../subagents/SubagentsView";
import { Tabs, tabPanel } from "../Tabs";
import { TimelineView } from "../timeline/TimelineView";
import { CHILD_PREFIX, eventRef, nestChildren } from "../trace/children";
import { TraceModel } from "../trace/model";
import {
	type ChildTraces,
	TraceExplorer,
	type TraceIntent,
	type TraceMemory,
} from "../trace/TraceExplorer";
import { TurnsView } from "../turns/TurnsView";
import {
	type LoadedTrace,
	loadAnalysis,
	loadAnchor,
	loadContext,
	loadCost,
	loadFiles,
	loadSubagents,
	loadTimeline,
} from "./api";
import { Header } from "./Header";
import { type Loadable, useChildTraces, useRevisioned, useSummary, useTrace } from "./hooks";
import {
	initialNavigation,
	moved,
	type Navigation,
	openFindings,
	routeOverviewLink,
} from "./navigation";
import { foldEntries, type Section, type TraceMode, ViewMemory } from "./viewState";

const SECTIONS: readonly { id: Section; label: MessageKey; icon: RemixiconComponentType }[] = [
	{ id: "overview", label: "sessionInsights.session.section.overview", icon: RiLayoutGridLine },
	{ id: "trace", label: "sessionInsights.session.section.trace", icon: RiFlowChart },
	{ id: "subagents", label: "sessionInsights.session.section.subagents", icon: RiRobot2Line },
	{ id: "errors", label: "sessionInsights.session.section.errors", icon: RiErrorWarningLine },
	{ id: "cost", label: "sessionInsights.session.section.cost", icon: RiMoneyDollarCircleLine },
	{ id: "files", label: "sessionInsights.session.section.files", icon: RiFileEditLine },
];

const MODES: readonly { id: TraceMode; label: MessageKey; icon: RemixiconComponentType }[] = [
	{ id: "tree", label: "sessionInsights.trace.mode.tree", icon: RiNodeTree },
	{ id: "turns", label: "sessionInsights.trace.mode.turns", icon: RiStackLine },
	{ id: "timeline", label: "sessionInsights.trace.mode.timeline", icon: RiTimeLine },
];

/**
 * What the export dialog offers: the session's turns, the turn holding the selection (the fixture's
 * default cut) and the selected event when it is not a turn (a cut right after it).
 */
export function exportContext(
	events: readonly TraceEvent[],
	selectedId: string | null,
): {
	turns: ExportTurn[];
	defaultTurn: number | null;
	selectedEvent: { id: string; label: string } | null;
} {
	const turns: ExportTurn[] = [];
	const byId = new Map<string, TraceEvent>();
	for (const event of events) {
		byId.set(event.id, event);
		if (event.kind === "turn") turns.push({ n: event.n, label: event.label });
	}
	let current = selectedId ? byId.get(selectedId) : undefined;
	const selected = current;
	while (current && current.kind !== "turn")
		current = current.parent ? byId.get(current.parent) : undefined;
	return {
		turns,
		defaultTurn: current?.kind === "turn" ? current.n : (turns.at(-1)?.n ?? null),
		selectedEvent:
			selected && selected.kind !== "turn" && !selected.id.startsWith(CHILD_PREFIX)
				? { id: selected.id, label: selected.label || selected.kind }
				: null,
	};
}

function Notice({ testId, children }: { testId: string; children: ReactNode }) {
	return (
		<div
			data-testid={testId}
			role="alert"
			className="flex flex-col items-center justify-center gap-8 p-16 text-center tr-text-ui text-text-muted"
		>
			{children}
		</div>
	);
}

function Failure({ testId, onRetry }: { testId: string; onRetry: () => void }) {
	const t = useT();
	return (
		<Notice testId={testId}>
			<span>{t("sessionInsights.error.failed")}</span>
			<Button variant="outline" size="m" onClick={onRetry}>
				{t("common.retry")}
			</Button>
		</Notice>
	);
}

function Unready({
	state,
	testId,
	loading,
	onRetry,
}: {
	state: Exclude<Loadable<unknown>, { kind: "ready" }>;
	testId: string;
	loading: string;
	onRetry: () => void;
}) {
	const t = useT();
	switch (state.kind) {
		case "loading":
			return (
				<LoadingRegion rows={10} label={loading} testId={`${testId}-loading`} className="p-16" />
			);
		case "missing":
			return <Notice testId={`${testId}-missing`}>{t("sessionInsights.session.missing")}</Notice>;
		case "version":
			return (
				<Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>
			);
		case "failed":
			return <Failure testId={`${testId}-error`} onRetry={onRetry} />;
	}
}

/** Tree | Turns | Timeline: the trace's three views of one chronology. */
export function ModeSwitch({
	mode,
	onMode,
}: {
	mode: TraceMode;
	onMode: (mode: TraceMode) => void;
}) {
	const t = useT();
	return (
		<fieldset
			aria-label={t("sessionInsights.trace.modes")}
			data-testid="session-insights-trace-modes"
			className="flex shrink-0 items-center gap-2 rounded-sm border border-border-default p-2"
		>
			{MODES.map((item) => (
				<button
					key={item.id}
					type="button"
					aria-pressed={item.id === mode}
					data-testid={`session-insights-trace-mode-${item.id}`}
					onClick={() => onMode(item.id)}
					className={cn(
						"flex items-center gap-4 rounded-sm px-6 py-2 tr-text-metadata focus-visible:focus-ring-inset",
						item.id === mode
							? "bg-control-bg-selected text-text-default"
							: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
					)}
				>
					<item.icon aria-hidden className="size-14 shrink-0" />
					{t(item.label)}
				</button>
			))}
		</fieldset>
	);
}

/** The trace's Turns or Timeline while its data loads: the mode switch stays reachable. */
function ModeLoading({ modes, children }: { modes: ReactNode; children: ReactNode }) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-8 border-border-default border-b px-12 py-4">
				{modes}
			</div>
			<div className="min-h-0 flex-1">{children}</div>
		</div>
	);
}

/** Why it was expensive, then context and cache, in one scroll. */
export function CostContextSection({
	cost,
	context,
	diff,
}: {
	cost: ReactNode;
	context: ReactNode;
	/** The request diff fills a box of its own height inside the scroll. */
	diff: boolean;
}) {
	return (
		<div data-testid="cost-context" className="h-full min-h-0 overflow-y-auto">
			<section data-testid="cost-context-cost">{cost}</section>
			<section
				data-testid="cost-context-context"
				className={cn("border-border-default border-t", diff && "h-640")}
			>
				{context}
			</section>
		</div>
	);
}

interface SectionsProps {
	host: PanelHost;
	sessionId: string;
	overview: SessionOverview | null;
	trace: LoadedTrace;
	navigation: Navigation;
	timeline: Loadable<SessionTimelineResult>;
	analysis: Loadable<SessionAnalysisResult>;
	subagents: Loadable<SessionSubagentsResult>;
	insights: {
		context: Loadable<SessionContextResult>;
		cost: Loadable<SessionCostResult>;
		files: Loadable<SessionFilesResult>;
	};
	subtraces: ChildTraces;
	ready: ReadonlyMap<string, readonly TraceEvent[]>;
	memory: TraceMemory;
	contextMode: ContextMode;
	chain: number | null;
	file: string | null;
	/** A selection the user made in the trace (its tree, turns or timeline). */
	onPick: (id: string, mode: TraceMode) => void;
	onSelectId: (id: string) => void;
	onNavigate: (to: Partial<Omit<Navigation, "seen">>) => void;
	onContextMode: (mode: ContextMode) => void;
	onChain: (index: number) => void;
	onFile: (path: string) => void;
	onRetryTimeline: () => void;
	onRetrySubagents: () => void;
	onRetryInsights: () => void;
}

function SessionSections({
	host,
	sessionId,
	overview,
	trace,
	navigation,
	timeline,
	analysis,
	subagents,
	insights,
	subtraces,
	ready,
	memory,
	contextMode,
	chain,
	file,
	onPick,
	onSelectId,
	onNavigate,
	onContextMode,
	onChain,
	onFile,
	onRetryTimeline,
	onRetrySubagents,
	onRetryInsights,
}: SectionsProps) {
	const t = useT();
	const { section, mode, selectedId, intent, jump } = navigation;
	const payload = analysis.kind === "ready" ? analysis.value.analysis : null;
	const total = trace.meta.total;
	const base = useMemo(() => new TraceModel(trace.events, total), [total, trace.events]);
	const nested = useMemo(
		() => (ready.size === 0 ? base : new TraceModel(nestChildren(trace.events, ready), total)),
		[base, ready, total, trace.events],
	);
	const tree = section === "trace" && mode === "tree";
	const model = tree ? nested : base;
	const chosen = selectedId === null ? -1 : model.indexOf(selectedId);
	const selected = tree ? Math.max(0, chosen) : chosen;
	const awaiting = selectedId !== null && chosen < 0 && !trace.complete;
	const pick = (index: number) => {
		const id = model.at(index)?.id;
		if (id) onPick(id, mode);
	};
	const toTrace = (id: string | null, next: TraceIntent | null) =>
		onNavigate({
			section: "trace",
			mode: "tree",
			selectedId: id,
			intent: next,
			jump: jump + 1,
			reveal: true,
		});
	const showInTrace = (id: string) => toTrace(id, null);
	const modes = (
		<ModeSwitch mode={mode} onMode={(next) => onNavigate({ section: "trace", mode: next })} />
	);
	if (section === "trace") {
		if (mode === "tree")
			return (
				<TraceExplorer
					key={jump}
					host={host}
					sessionId={sessionId}
					overview={overview}
					trace={trace}
					model={nested}
					selected={selected}
					onSelect={pick}
					analysis={payload}
					subtraces={subtraces}
					intent={intent}
					awaiting={awaiting}
					memory={memory}
					reveal={navigation.reveal}
					toolbarStart={modes}
				/>
			);
		if (timeline.kind !== "ready")
			return (
				<ModeLoading modes={modes}>
					<Unready
						state={timeline}
						testId="timeline"
						loading={t("sessionInsights.timeline.loading")}
						onRetry={onRetryTimeline}
					/>
				</ModeLoading>
			);
		const value = timeline.value;
		if (!value.timeline)
			return (
				<ModeLoading modes={modes}>
					<Notice testId="timeline-missing">{t("sessionInsights.session.missing")}</Notice>
				</ModeLoading>
			);
		return mode === "turns" ? (
			<TurnsView
				host={host}
				sessionId={sessionId}
				overview={overview}
				model={base}
				gaps={trace.meta.gaps}
				timeline={value.timeline}
				analysis={payload}
				sources={value.sources}
				selected={selected}
				onSelect={pick}
				onShowInTrace={(index) => toTrace(base.at(index)?.id ?? null, null)}
				toolbarStart={modes}
			/>
		) : (
			<TimelineView
				host={host}
				sessionId={sessionId}
				overview={overview}
				model={base}
				gaps={trace.meta.gaps}
				timeline={value.timeline}
				analysis={payload}
				sources={value.sources}
				selected={selected}
				onSelect={pick}
				toolbarStart={modes}
			/>
		);
	}
	if (section === "cost") {
		const cost = insights.cost;
		const context = insights.context;
		return (
			<CostContextSection
				diff={contextMode === "diff" && context.kind === "ready"}
				cost={
					cost.kind !== "ready" || !cost.value.cost ? (
						<Unready
							state={cost.kind === "ready" ? { kind: "missing" } : cost}
							testId="cost"
							loading={t("sessionInsights.cost.loading")}
							onRetry={onRetryInsights}
						/>
					) : (
						<CostView
							cost={cost.value.cost}
							sources={cost.value.sources}
							onShowInTrace={showInTrace}
						/>
					)
				}
				context={
					context.kind !== "ready" || !context.value.context ? (
						<Unready
							state={context.kind === "ready" ? { kind: "missing" } : context}
							testId="context"
							loading={t("sessionInsights.context.loading")}
							onRetry={onRetryInsights}
						/>
					) : (
						<ContextView
							host={host}
							sessionId={sessionId}
							data={context.value.context}
							sources={context.value.sources}
							model={base}
							selectedId={selectedId}
							onSelectId={onSelectId}
							onShowInTrace={showInTrace}
							mode={contextMode}
							onMode={onContextMode}
						/>
					)
				}
			/>
		);
	}
	if (section === "files") {
		const state = insights.files;
		return state.kind !== "ready" || !state.value.files ? (
			<Unready
				state={state.kind === "ready" ? { kind: "missing" } : state}
				testId="files"
				loading={t("sessionInsights.files.loading")}
				onRetry={onRetryInsights}
			/>
		) : (
			<FilesView
				host={host}
				sessionId={sessionId}
				overview={overview}
				files={state.value.files}
				sources={state.value.sources}
				onShowInTrace={showInTrace}
				path={file}
				onPath={onFile}
			/>
		);
	}
	if (section === "subagents")
		return subagents.kind !== "ready" ? (
			<Unready
				state={subagents}
				testId="subagents"
				loading={t("sessionInsights.subagents.loading")}
				onRetry={onRetrySubagents}
			/>
		) : (
			<SubagentsView
				model={base}
				view={subagents.value.subagents}
				sources={subagents.value.sources}
				onOpen={(childId) => {
					if (subtraces.available.has(childId)) subtraces.load(childId);
					toTrace(`sub:${childId}`, { focus: null, expand: [`sub:${childId}`] });
				}}
			/>
		);
	return analysis.kind !== "ready" ? (
		<Unready
			state={analysis}
			testId="errors"
			loading={t("sessionInsights.errors.loading")}
			onRetry={onRetrySubagents}
		/>
	) : (
		<ErrorsView
			host={host}
			sessionId={sessionId}
			model={base}
			analysis={analysis.value.analysis}
			sources={analysis.value.sources}
			onShowInTrace={(focus, first) => toTrace(first, { focus, expand: [] })}
			chain={chain}
			onChain={onChain}
		/>
	);
}

/**
 * Asks where an event's message is in the chat and has the chat beside the pane show it; a subagent's
 * event has no place there, and an ask `signal` aborted (a later pick) shows nothing.
 */
export function showEventInChat(
	host: PanelHost,
	sessionId: string,
	eventId: string,
	signal: AbortSignal,
): Promise<ShowOutcome> {
	if (eventRef(eventId).childId !== undefined) return Promise.resolve("notInChat");
	return loadAnchor(host, sessionId, eventId, signal).then(
		(result): ShowOutcome => {
			if (signal.aborted) return "stale";
			if (!result.anchor) return "notInChat";
			host.showInChat?.(result.anchor);
			return "shown";
		},
		(): ShowOutcome => (signal.aborted ? "stale" : "failed"),
	);
}

/** In a chat pane: shows events in the chat beside it, the latest ask winning; `show` is `null` in a tab. */
function useShowInChat(host: PanelHost, sessionId: string) {
	const running = useRef<AbortController | null>(null);
	const [shown, setShown] = useState<string | null>(null);
	useEffect(() => () => running.current?.abort(), []);
	if (host.placement !== "chatPane" || !host.showInChat) return { show: null, shown };
	const show = (eventId: string): Promise<ShowOutcome> => {
		running.current?.abort();
		const controller = new AbortController();
		running.current = controller;
		return showEventInChat(host, sessionId, eventId, controller.signal).then((outcome) => {
			if (outcome === "shown") setShown(eventId);
			return outcome;
		});
	};
	return { show, shown };
}

/**
 * One session's analysis: its one-line header, the six sections — the overview, the trace (tree, turns
 * or timeline), the subagent waves, the errors, cost and context, and its files — sharing one selection,
 * with the view kept across remounts and, in a chat pane, picks shown in the chat beside it.
 */
export default function SessionPanel({ host, params }: PanelProps) {
	const t = useT();
	const locale = localeOf(t);
	const sessionId = params.sessionId ?? "";
	const tabsId = useId();
	const [memory] = useState(() => ViewMemory.of(host));
	const [traceMemory] = useState<TraceMemory>(() => ({
		read: () => ({ open: memory.state.open, top: memory.state.top }),
		onFolds: (open) => memory.remember({ open: foldEntries(open) }),
		onTop: (top) => memory.remember({ top }),
	}));
	const [attempt, setAttempt] = useState(0);
	const [traceAttempt, setTraceAttempt] = useState(0);
	const [timelineAttempt, setTimelineAttempt] = useState(0);
	const [subagentsAttempt, setSubagentsAttempt] = useState(0);
	const [insightsAttempt, setInsightsAttempt] = useState(0);
	const [navigation, setNavigation] = useState<Navigation>(() =>
		initialNavigation(memory.state, pendingSessionFocus(sessionId)),
	);
	const [contextMode, setContextMode] = useState<ContextMode>(() => memory.state.context);
	const [detailTab, setDetailTab] = useState<DetailTab | null>(() => memory.state.detailTab);
	const [chain, setChain] = useState<number | null>(() => memory.state.chain);
	const [file, setFile] = useState<string | null>(() => memory.state.file);
	const { section, mode, selectedId } = navigation;
	useEffect(() => {
		memory.attach(host);
	}, [host, memory]);
	useEffect(() => () => memory.flush(), [memory]);
	useEffect(() => {
		memory.remember({
			section,
			mode,
			selectedId,
			context: contextMode,
			detailTab,
			chain,
			file,
		});
	}, [chain, contextMode, detailTab, file, memory, mode, section, selectedId]);
	useEffect(() => {
		const initial = pendingSessionFocus(sessionId);
		if (initial) settleSessionFocus(sessionId, initial);
		return onSessionFocus((target) => {
			const eventId = target === sessionId ? pendingSessionFocus(sessionId) : null;
			if (!eventId) return;
			settleSessionFocus(sessionId, eventId);
			setNavigation((current) =>
				moved(current, {
					section: "trace",
					mode: "tree",
					selectedId: eventId,
					intent: null,
					jump: current.jump + 1,
					reveal: true,
				}),
			);
		});
	}, [sessionId]);
	const summary = useSummary(host, sessionId, attempt);
	const trace = useTrace(host, sessionId, traceAttempt);
	const complete =
		trace.kind === "ready" && trace.value.complete ? trace.value.meta.revision : null;
	const seen = navigation.seen;
	const timeline = useRevisioned(
		sessionId,
		seen.has("timeline") ? complete : null,
		timelineAttempt,
		(signal) => loadTimeline(host, sessionId, signal).then(found),
	);
	const analysis = useRevisioned(sessionId, complete, subagentsAttempt, (signal) =>
		loadAnalysis(host, sessionId, signal).then((value) => (value.analysis ? value : null)),
	);
	const subagents = useRevisioned(
		sessionId,
		seen.has("subagents") ? complete : null,
		subagentsAttempt,
		(signal) =>
			loadSubagents(host, sessionId, signal).then((value) => (value.subagents ? value : null)),
	);
	const context = useRevisioned(
		sessionId,
		seen.has("cost") ? complete : null,
		insightsAttempt,
		(signal) =>
			loadContext(host, sessionId, signal).then((value) => (value.context ? value : null)),
	);
	const cost = useRevisioned(
		sessionId,
		seen.has("cost") ? complete : null,
		insightsAttempt,
		(signal) => loadCost(host, sessionId, signal).then((value) => (value.cost ? value : null)),
	);
	const files = useRevisioned(
		sessionId,
		seen.has("files") ? complete : null,
		insightsAttempt,
		(signal) => loadFiles(host, sessionId, signal).then((value) => (value.files ? value : null)),
	);
	const transcripts = analysis.kind === "ready" ? analysis.value.analysis?.transcripts : undefined;
	const available = useMemo(() => new Set(transcripts ?? []), [transcripts]);
	const { ready, children: subtraces } = useChildTraces(host, sessionId, available);
	const labels = useLabels(host, [sessionId], hostServesThisVersion(host));
	const pane = useShowInChat(host, sessionId);
	const exportTarget = exportContext(trace.kind === "ready" ? trace.value.events : [], selectedId);
	if (!hostServesThisVersion(host))
		return <Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>;
	const overview = summary.kind === "ready" ? summary.value.session : null;
	const navigate = (to: Partial<Omit<Navigation, "seen">>) =>
		setNavigation((current) => moved(current, to));
	const select = (id: string) => {
		memory.remember({ top: null });
		setNavigation((current) => ({ ...current, selectedId: id }));
	};
	const onPick = (id: string, from: TraceMode) => {
		if (from !== "tree") memory.remember({ top: null });
		setNavigation((current) => ({ ...current, selectedId: id }));
		void pane.show?.(id);
	};
	const details: DetailsHost = {
		tab: detailTab,
		onTab: setDetailTab,
		showInChat: pane.show,
		shown: pane.shown,
	};
	const onOverview = (link: Parameters<typeof routeOverviewLink>[0]) =>
		routeOverviewLink(link, {
			trace: (to, events) => {
				const [first] = events;
				setNavigation((current) =>
					moved(current, {
						section: "trace",
						mode: to,
						selectedId: first ?? current.selectedId,
						intent:
							events.length > 1
								? {
										focus: {
											ids: events,
											label: t("sessionInsights.session.overviewFocus", {
												count: events.length,
												n: formatCount(locale, events.length),
											}),
										},
										expand: [],
									}
								: null,
						jump: current.jump + 1,
						reveal: true,
					}),
				);
			},
			section: (to) => navigate({ section: to }),
			chain: setChain,
			file: setFile,
			findings: () => openFindings(host),
		});
	return (
		<DetailsContext value={details}>
			<div
				data-testid="session-insights-session"
				data-session-id={sessionId}
				data-placement={host.placement ?? "tab"}
				className="flex h-full min-h-0 flex-col"
			>
				{summary.kind === "loading" ? (
					<LoadingRegion
						rows={1}
						label={t("sessionInsights.session.loading")}
						className="h-40 shrink-0 px-12 py-8"
					/>
				) : summary.kind === "ready" && overview ? (
					<Header
						host={host}
						session={overview}
						sources={summary.value.sources}
						labels={
							labels
								? {
										entry: labels.sessions.find((entry) => entry.sessionId === sessionId) ?? null,
										vocabulary: labels.vocabulary,
									}
								: null
						}
						exportTarget={exportTarget}
						beforeLeave={() => memory.flush()}
					/>
				) : summary.kind === "failed" ? (
					<Failure
						testId="session-insights-session-error"
						onRetry={() => setAttempt(attempt + 1)}
					/>
				) : summary.kind === "version" ? (
					<Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>
				) : (
					<Notice testId="session-insights-session-missing">
						{t("sessionInsights.session.missing")}
					</Notice>
				)}
				<Tabs
					id={tabsId}
					label={t("sessionInsights.session.sections")}
					tabs={SECTIONS.map((item) => ({
						id: item.id,
						testId: `session-insights-section-${item.id}`,
						label: (
							<>
								<item.icon aria-hidden className="size-14" />
								{t(item.label)}
							</>
						),
					}))}
					value={section}
					onChange={(next) => navigate({ section: next })}
					className="flex h-panel-header-row shrink-0 items-center gap-4 overflow-x-auto border-border-default border-b px-12"
					tabClassName="flex h-full shrink-0 items-center gap-4 px-4"
				/>
				{trace.kind === "ready" && trace.value.newer ? (
					<div
						data-testid="session-insights-newer"
						role="status"
						className="flex shrink-0 items-center gap-8 border-border-default border-b bg-control-bg px-12 py-4 tr-text-metadata text-text-muted"
					>
						<span className="min-w-0 truncate">{t("sessionInsights.session.newer")}</span>
						<Button
							variant="ghost"
							size="s"
							data-testid="session-insights-reload"
							onClick={() => setTraceAttempt(traceAttempt + 1)}
						>
							{t("sessionInsights.session.reload")}
						</Button>
					</div>
				) : null}
				<div {...tabPanel(tabsId, section)} className="min-h-0 flex-1">
					{section === "overview" ? (
						<div data-testid="session-insights-overview" className="h-full min-h-0 overflow-y-auto">
							<OverviewView host={host} sessionId={sessionId} onOpen={onOverview} />
						</div>
					) : trace.kind !== "ready" ? (
						<Unready
							state={trace}
							testId="trace"
							loading={t("sessionInsights.trace.loading")}
							onRetry={() => setTraceAttempt(traceAttempt + 1)}
						/>
					) : trace.value.events.length === 0 ? (
						<Notice testId="trace-empty">{t("sessionInsights.trace.empty")}</Notice>
					) : (
						<SessionSections
							host={host}
							sessionId={sessionId}
							overview={overview}
							trace={trace.value}
							navigation={navigation}
							timeline={timeline}
							analysis={analysis}
							subagents={subagents}
							insights={{ context, cost, files }}
							subtraces={subtraces}
							ready={ready}
							memory={traceMemory}
							contextMode={contextMode}
							chain={chain}
							file={file}
							onPick={onPick}
							onSelectId={select}
							onNavigate={navigate}
							onContextMode={setContextMode}
							onChain={setChain}
							onFile={setFile}
							onRetryTimeline={() => setTimelineAttempt(timelineAttempt + 1)}
							onRetrySubagents={() => setSubagentsAttempt(subagentsAttempt + 1)}
							onRetryInsights={() => setInsightsAttempt(insightsAttempt + 1)}
						/>
					)}
				</div>
			</div>
		</DetailsContext>
	);
}

/** A timeline answer counts as found only with a timeline. */
function found(value: SessionTimelineResult): SessionTimelineResult | null {
	return value.timeline ? value : null;
}
