import {
	type RemixiconComponentType,
	RiDatabase2Line,
	RiErrorWarningLine,
	RiFileEditLine,
	RiFlowChart,
	RiMoneyDollarCircleLine,
	RiRobot2Line,
	RiStackLine,
	RiTimeLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
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
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { ContextView } from "../context/ContextView";
import { CostView } from "../cost/CostView";
import { ErrorsView } from "../errors/ErrorsView";
import { ExportMenu, type ExportTurn } from "../export/ExportMenu";
import { FilesView } from "../files/FilesView";
import { onSessionFocus, pendingSessionFocus, settleSessionFocus } from "../focus";
import { useLabels } from "../labels/api";
import { hostServesThisVersion } from "../load";
import { SubagentsView } from "../subagents/SubagentsView";
import { Tabs, tabPanel } from "../Tabs";
import { TimelineView } from "../timeline/TimelineView";
import { CHILD_PREFIX, nestChildren } from "../trace/children";
import { TraceModel } from "../trace/model";
import { type ChildTraces, TraceExplorer, type TraceIntent } from "../trace/TraceExplorer";
import { TurnsView } from "../turns/TurnsView";
import {
	type LoadedTrace,
	loadAnalysis,
	loadContext,
	loadCost,
	loadFiles,
	loadSubagents,
	loadTimeline,
} from "./api";
import { Header } from "./Header";
import { type Loadable, useChildTraces, useRevisioned, useSummary, useTrace } from "./hooks";

type Section =
	| "trace"
	| "turns"
	| "timeline"
	| "subagents"
	| "errors"
	| "context"
	| "cost"
	| "files";

const SECTIONS: readonly { id: Section; label: MessageKey; icon: RemixiconComponentType }[] = [
	{ id: "trace", label: "sessionInsights.session.section.trace", icon: RiFlowChart },
	{ id: "turns", label: "sessionInsights.session.section.turns", icon: RiStackLine },
	{ id: "timeline", label: "sessionInsights.session.section.timeline", icon: RiTimeLine },
	{ id: "subagents", label: "sessionInsights.session.section.subagents", icon: RiRobot2Line },
	{ id: "errors", label: "sessionInsights.session.section.errors", icon: RiErrorWarningLine },
	{ id: "context", label: "sessionInsights.session.section.context", icon: RiDatabase2Line },
	{ id: "cost", label: "sessionInsights.session.section.cost", icon: RiMoneyDollarCircleLine },
	{ id: "files", label: "sessionInsights.session.section.files", icon: RiFileEditLine },
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

interface Navigation {
	section: Section;
	selectedId: string | null;
	intent: TraceIntent | null;
	/** Bumped by a jump from another panel, so the trace remounts and reveals the event. */
	jump: number;
}

function SessionSections({
	host,
	sessionId,
	overview,
	trace,
	section,
	timeline,
	analysis,
	subagents,
	insights,
	subtraces,
	ready,
	selectedId,
	intent,
	jump,
	onSelectId,
	onNavigate,
	onRetryTimeline,
	onRetrySubagents,
	onRetryInsights,
}: {
	host: PanelHost;
	sessionId: string;
	overview: SessionOverview | null;
	trace: LoadedTrace;
	section: Section;
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
	selectedId: string | null;
	intent: TraceIntent | null;
	jump: number;
	onSelectId: (id: string) => void;
	onNavigate: (to: Navigation) => void;
	onRetryTimeline: () => void;
	onRetrySubagents: () => void;
	onRetryInsights: () => void;
}) {
	const t = useT();
	const payload = analysis.kind === "ready" ? analysis.value.analysis : null;
	const total = trace.meta.total;
	const base = useMemo(() => new TraceModel(trace.events, total), [total, trace.events]);
	const nested = useMemo(
		() => (ready.size === 0 ? base : new TraceModel(nestChildren(trace.events, ready), total)),
		[base, ready, total, trace.events],
	);
	const model = section === "trace" ? nested : base;
	const chosen = selectedId === null ? -1 : model.indexOf(selectedId);
	const selected = section === "trace" ? Math.max(0, chosen) : chosen;
	const awaiting = selectedId !== null && chosen < 0 && !trace.complete;
	const onSelect = (index: number) => {
		const id = model.at(index)?.id;
		if (id) onSelectId(id);
	};
	const toTrace = (id: string | null, next: TraceIntent | null) =>
		onNavigate({ section: "trace", selectedId: id, intent: next, jump });
	if (section === "trace")
		return (
			<TraceExplorer
				key={jump}
				host={host}
				sessionId={sessionId}
				overview={overview}
				trace={trace}
				model={nested}
				selected={selected}
				onSelect={onSelect}
				analysis={payload}
				subtraces={subtraces}
				intent={intent}
				awaiting={awaiting}
			/>
		);
	const showInTrace = (id: string) => toTrace(id, null);
	if (section === "context") {
		const state = insights.context;
		return state.kind !== "ready" || !state.value.context ? (
			<Unready
				state={state.kind === "ready" ? { kind: "missing" } : state}
				testId="context"
				loading={t("sessionInsights.context.loading")}
				onRetry={onRetryInsights}
			/>
		) : (
			<ContextView
				host={host}
				sessionId={sessionId}
				data={state.value.context}
				sources={state.value.sources}
				model={base}
				selectedId={selectedId}
				onSelectId={onSelectId}
				onShowInTrace={showInTrace}
			/>
		);
	}
	if (section === "cost") {
		const state = insights.cost;
		return state.kind !== "ready" || !state.value.cost ? (
			<Unready
				state={state.kind === "ready" ? { kind: "missing" } : state}
				testId="cost"
				loading={t("sessionInsights.cost.loading")}
				onRetry={onRetryInsights}
			/>
		) : (
			<CostView cost={state.value.cost} sources={state.value.sources} onShowInTrace={showInTrace} />
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
	if (section === "errors")
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
			/>
		);
	if (timeline.kind !== "ready")
		return (
			<Unready
				state={timeline}
				testId="timeline"
				loading={t("sessionInsights.timeline.loading")}
				onRetry={onRetryTimeline}
			/>
		);
	const value = timeline.value;
	if (!value.timeline)
		return <Notice testId="timeline-missing">{t("sessionInsights.session.missing")}</Notice>;
	return section === "turns" ? (
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
			onSelect={onSelect}
			onShowInTrace={(index) => {
				const id = base.at(index)?.id ?? null;
				toTrace(id, null);
			}}
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
			onSelect={onSelect}
		/>
	);
}

/**
 * One session's analysis: its header, a section switch — the trace, the turn cards, the timeline, the
 * subagent waves, the errors, context and cache, why it was expensive and its files, sharing one
 * selection — and the section.
 */
export default function SessionPanel({ host, params }: PanelProps) {
	const t = useT();
	const sessionId = params.sessionId ?? "";
	const tabsId = useId();
	const [attempt, setAttempt] = useState(0);
	const [traceAttempt, setTraceAttempt] = useState(0);
	const [timelineAttempt, setTimelineAttempt] = useState(0);
	const [subagentsAttempt, setSubagentsAttempt] = useState(0);
	const [insightsAttempt, setInsightsAttempt] = useState(0);
	const [navigation, setNavigation] = useState<Navigation>(() => ({
		section: "trace",
		selectedId: pendingSessionFocus(sessionId),
		intent: null,
		jump: 0,
	}));
	useEffect(() => {
		const initial = pendingSessionFocus(sessionId);
		if (initial) settleSessionFocus(sessionId, initial);
		return onSessionFocus((target) => {
			const eventId = target === sessionId ? pendingSessionFocus(sessionId) : null;
			if (!eventId) return;
			settleSessionFocus(sessionId, eventId);
			setNavigation((current) => ({
				section: "trace",
				selectedId: eventId,
				intent: null,
				jump: current.jump + 1,
			}));
		});
	}, [sessionId]);
	const [wantsTimeline, setWantsTimeline] = useState(false);
	const [wantsSubagents, setWantsSubagents] = useState(false);
	const [wants, setWants] = useState<ReadonlySet<Section>>(new Set());
	const section = navigation.section;
	const summary = useSummary(host, sessionId, attempt);
	const trace = useTrace(host, sessionId, traceAttempt);
	const complete =
		trace.kind === "ready" && trace.value.complete ? trace.value.meta.revision : null;
	const timeline = useRevisioned(
		sessionId,
		wantsTimeline ? complete : null,
		timelineAttempt,
		(signal) => loadTimeline(host, sessionId, signal).then(found),
	);
	const analysis = useRevisioned(sessionId, complete, subagentsAttempt, (signal) =>
		loadAnalysis(host, sessionId, signal).then((value) => (value.analysis ? value : null)),
	);
	const subagents = useRevisioned(
		sessionId,
		wantsSubagents ? complete : null,
		subagentsAttempt,
		(signal) =>
			loadSubagents(host, sessionId, signal).then((value) => (value.subagents ? value : null)),
	);
	const context = useRevisioned(
		sessionId,
		wants.has("context") ? complete : null,
		insightsAttempt,
		(signal) =>
			loadContext(host, sessionId, signal).then((value) => (value.context ? value : null)),
	);
	const cost = useRevisioned(
		sessionId,
		wants.has("cost") ? complete : null,
		insightsAttempt,
		(signal) => loadCost(host, sessionId, signal).then((value) => (value.cost ? value : null)),
	);
	const files = useRevisioned(
		sessionId,
		wants.has("files") ? complete : null,
		insightsAttempt,
		(signal) => loadFiles(host, sessionId, signal).then((value) => (value.files ? value : null)),
	);
	const transcripts = analysis.kind === "ready" ? analysis.value.analysis?.transcripts : undefined;
	const available = useMemo(() => new Set(transcripts ?? []), [transcripts]);
	const { ready, children: subtraces } = useChildTraces(host, sessionId, available);
	const labels = useLabels(host, [sessionId], hostServesThisVersion(host));
	const exportTarget = exportContext(
		trace.kind === "ready" ? trace.value.events : [],
		navigation.selectedId,
	);
	if (!hostServesThisVersion(host))
		return <Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>;
	const overview = summary.kind === "ready" ? summary.value.session : null;
	const navigate = (to: Navigation) => {
		setNavigation(to);
		if (to.section === "turns" || to.section === "timeline") setWantsTimeline(true);
		if (to.section === "subagents") setWantsSubagents(true);
		if (
			(to.section === "context" || to.section === "cost" || to.section === "files") &&
			!wants.has(to.section)
		)
			setWants(new Set(wants).add(to.section));
	};
	const choose = (next: Section) =>
		navigate({
			section: next,
			selectedId: navigation.selectedId,
			intent: null,
			jump: navigation.jump,
		});
	return (
		<div
			data-testid="session-insights-session"
			data-session-id={sessionId}
			className="flex h-full min-h-0 flex-col"
		>
			{summary.kind === "loading" ? (
				<LoadingRegion
					rows={3}
					label={t("sessionInsights.session.loading")}
					className="shrink-0 p-12"
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
					exportMenu={
						<ExportMenu
							host={host}
							sessionId={sessionId}
							turns={exportTarget.turns}
							defaultTurn={exportTarget.defaultTurn}
							selectedEvent={exportTarget.selectedEvent}
						/>
					}
				/>
			) : summary.kind === "failed" ? (
				<Failure testId="session-insights-session-error" onRetry={() => setAttempt(attempt + 1)} />
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
				onChange={choose}
				className="flex h-panel-header-row shrink-0 items-center gap-4 border-border-default border-b px-12"
				tabClassName="flex h-full items-center gap-4 px-4"
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
				{trace.kind !== "ready" ? (
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
						section={section}
						timeline={timeline}
						analysis={analysis}
						subagents={subagents}
						insights={{ context, cost, files }}
						subtraces={subtraces}
						ready={ready}
						selectedId={navigation.selectedId}
						intent={navigation.intent}
						jump={navigation.jump}
						onSelectId={(id) => setNavigation({ ...navigation, selectedId: id })}
						onNavigate={navigate}
						onRetryTimeline={() => setTimelineAttempt(timelineAttempt + 1)}
						onRetrySubagents={() => setSubagentsAttempt(subagentsAttempt + 1)}
						onRetryInsights={() => setInsightsAttempt(insightsAttempt + 1)}
					/>
				)}
			</div>
		</div>
	);
}

/** A timeline answer counts as found only with a timeline. */
function found(value: SessionTimelineResult): SessionTimelineResult | null {
	return value.timeline ? value : null;
}
