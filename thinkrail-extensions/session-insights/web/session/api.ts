import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	ErrorDetailQuery,
	ErrorDetailResult,
	EventAnchorQuery,
	EventAnchorResult,
	EventGetQuery,
	EventGetResult,
	FileDetailQuery,
	FileDetailResult,
	RequestDiffQuery,
	RequestDiffResult,
	SessionAnalysisQuery,
	SessionAnalysisResult,
	SessionContextQuery,
	SessionContextResult,
	SessionCostQuery,
	SessionCostResult,
	SessionFilesQuery,
	SessionFilesResult,
	SessionSubagentsQuery,
	SessionSubagentsResult,
	SessionSummaryQuery,
	SessionSummaryResult,
	SessionTimelineQuery,
	SessionTimelineResult,
	SessionTraceParams,
	SessionTraceQuery,
	SessionTraceResult,
	SubagentGetQuery,
	SubagentGetResult,
	TraceEvent,
	TraceMeta,
	TracePageEvents,
	TraceSearchQuery,
	TraceSearchResult,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";

export const SESSION_SUMMARY: SessionSummaryQuery = "session.summary";
export const SESSION_TRACE: SessionTraceQuery = "session.trace";
export const EVENT_GET: EventGetQuery = "event.get";
export const EVENT_ANCHOR: EventAnchorQuery = "event.anchor";
export const TRACE_SEARCH: TraceSearchQuery = "trace.search";
export const SESSION_TIMELINE: SessionTimelineQuery = "session.timeline";
export const SESSION_ANALYSIS: SessionAnalysisQuery = "session.analysis";
export const SESSION_SUBAGENTS: SessionSubagentsQuery = "session.subagents";
export const SUBAGENT_GET: SubagentGetQuery = "subagent.get";
export const ERROR_DETAIL: ErrorDetailQuery = "error.detail";
export const SESSION_CONTEXT: SessionContextQuery = "session.context";
export const REQUEST_DIFF: RequestDiffQuery = "request.diff";
export const SESSION_COST: SessionCostQuery = "session.cost";
export const SESSION_FILES: SessionFilesQuery = "session.files";
export const FILE_DETAIL: FileDetailQuery = "file.detail";
const PAGE_EVENTS: TracePageEvents = 2000;
const MAX_RESTARTS = 3;

/** A lookup the host cannot answer yet: its index has not reached the session (it is still being built). */
export const PENDING = "pending";
export type Pending = typeof PENDING;

/** The host answered with a payload this web half does not understand. */
export class VersionSkew extends Error {
	constructor() {
		super("The session insights payload version differs from this client's");
		this.name = "VersionSkew";
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isCurrent(value: unknown): value is Record<string, unknown> {
	return isObject(value) && value.apiVersion === API_VERSION;
}

function isSummary(value: unknown): value is SessionSummaryResult {
	return isCurrent(value) && isObject(value.state) && isObject(value.sources) && "session" in value;
}

function isTracePage(value: unknown): value is SessionTraceResult {
	return isCurrent(value) && typeof value.found === "boolean" && Array.isArray(value.events);
}

function isEventResult(value: unknown): value is EventGetResult {
	return isCurrent(value) && typeof value.found === "boolean" && "body" in value;
}

function isAnchorResult(value: unknown): value is EventAnchorResult {
	return isCurrent(value) && typeof value.found === "boolean" && "anchor" in value;
}

function isTimelineResult(value: unknown): value is SessionTimelineResult {
	return (
		isCurrent(value) &&
		typeof value.found === "boolean" &&
		"timeline" in value &&
		isObject(value.sources)
	);
}

function isAnalysisResult(value: unknown): value is SessionAnalysisResult {
	return isCurrent(value) && typeof value.found === "boolean" && "analysis" in value;
}

function isSubagentsResult(value: unknown): value is SessionSubagentsResult {
	return isCurrent(value) && typeof value.found === "boolean" && "subagents" in value;
}

function isSubagentResult(value: unknown): value is SubagentGetResult {
	return isCurrent(value) && typeof value.found === "boolean" && "detail" in value;
}

function isErrorDetailResult(value: unknown): value is ErrorDetailResult {
	return isCurrent(value) && typeof value.found === "boolean" && "detail" in value;
}

function isContextResult(value: unknown): value is SessionContextResult {
	return isCurrent(value) && typeof value.found === "boolean" && "context" in value;
}

function isRequestDiffResult(value: unknown): value is RequestDiffResult {
	return isCurrent(value) && typeof value.found === "boolean" && "diff" in value;
}

function isCostResult(value: unknown): value is SessionCostResult {
	return isCurrent(value) && typeof value.found === "boolean" && "cost" in value;
}

function isFilesResult(value: unknown): value is SessionFilesResult {
	return isCurrent(value) && typeof value.found === "boolean" && "files" in value;
}

function isFileDetailResult(value: unknown): value is FileDetailResult {
	return isCurrent(value) && typeof value.found === "boolean" && "detail" in value;
}

function isSearchResult(value: unknown): value is TraceSearchResult {
	return isCurrent(value) && Array.isArray(value.ids);
}

function checked<T>(value: unknown, guard: (value: unknown) => value is T): T {
	if (!guard(value)) throw new VersionSkew();
	return value;
}

export async function loadSummary(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionSummaryResult> {
	return checked(await host.query(SESSION_SUMMARY, { sessionId }, signal), isSummary);
}

/** The session's summary; `null`: the host does not have it, `PENDING`: its index has not reached it yet. */
export async function loadOverview(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionSummaryResult | Pending | null> {
	const value = await loadSummary(host, sessionId, signal);
	if (value.session) return value;
	return value.pending === true ? PENDING : null;
}

export interface LoadedTrace {
	meta: TraceMeta;
	events: readonly TraceEvent[];
	complete: boolean;
	/** The file moved past the revision these pages were pinned to: a reload shows the newer one. */
	newer: boolean;
}

/**
 * Pages the trace in, handing every growing prefix to `onProgress`. Later pages ask for the first
 * page's revision, so a session that is still being written never mixes two versions (`newer` says it
 * moved on); a host that no longer keeps that revision answers the current one, and paging restarts.
 * `null`: the host does not have the session; `PENDING`: its index has not reached it yet.
 */
export async function loadTrace(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
	onProgress: (trace: LoadedTrace) => void,
	childId?: string,
): Promise<LoadedTrace | Pending | null> {
	for (let restart = 0; restart <= MAX_RESTARTS; restart += 1) {
		let events: TraceEvent[] = [];
		let revision: string | null = null;
		let cursor: number | null = 0;
		let meta: TraceMeta | null = null;
		let newer = false;
		let moved = false;
		while (cursor !== null) {
			const params: SessionTraceParams = {
				sessionId,
				cursor,
				limit: PAGE_EVENTS,
				...(childId ? { childId } : {}),
				...(revision === null ? {} : { revision }),
			};
			const page: SessionTraceResult = checked(
				await host.query(SESSION_TRACE, params, signal),
				isTracePage,
			);
			if (!page.found || !page.meta) return page.pending === true ? PENDING : null;
			if (revision !== null && page.meta.revision !== revision) {
				moved = true;
				break;
			}
			revision = page.meta.revision;
			meta = page.meta;
			events = events.concat(page.events);
			cursor = page.next;
			newer ||= page.newerRevision;
			onProgress({ meta, events, complete: cursor === null, newer });
		}
		if (!moved && meta !== null) return { meta, events, complete: true, newer };
	}
	throw new Error("The session file kept changing while its trace was paged");
}

export async function loadEvent(
	host: PanelHost,
	sessionId: string,
	eventId: string,
	signal: AbortSignal,
	childId?: string,
): Promise<EventGetResult> {
	return checked(
		await host.query(EVENT_GET, { sessionId, eventId, ...(childId ? { childId } : {}) }, signal),
		isEventResult,
	);
}

export async function loadAnchor(
	host: PanelHost,
	sessionId: string,
	eventId: string,
): Promise<EventAnchorResult> {
	return checked(await host.query(EVENT_ANCHOR, { sessionId, eventId }), isAnchorResult);
}

export async function searchTrace(
	host: PanelHost,
	sessionId: string,
	query: string,
	signal: AbortSignal,
): Promise<TraceSearchResult> {
	return checked(await host.query(TRACE_SEARCH, { sessionId, query }, signal), isSearchResult);
}

export async function loadTimeline(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionTimelineResult> {
	return checked(await host.query(SESSION_TIMELINE, { sessionId }, signal), isTimelineResult);
}

export async function loadAnalysis(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionAnalysisResult> {
	return checked(await host.query(SESSION_ANALYSIS, { sessionId }, signal), isAnalysisResult);
}

export async function loadSubagents(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionSubagentsResult> {
	return checked(await host.query(SESSION_SUBAGENTS, { sessionId }, signal), isSubagentsResult);
}

export async function loadSubagent(
	host: PanelHost,
	sessionId: string,
	childId: string,
	signal: AbortSignal,
): Promise<SubagentGetResult> {
	return checked(await host.query(SUBAGENT_GET, { sessionId, childId }, signal), isSubagentResult);
}

export async function loadErrorDetail(
	host: PanelHost,
	sessionId: string,
	chain: number,
	signal: AbortSignal,
): Promise<ErrorDetailResult> {
	return checked(await host.query(ERROR_DETAIL, { sessionId, chain }, signal), isErrorDetailResult);
}

export async function loadContext(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionContextResult> {
	return checked(await host.query(SESSION_CONTEXT, { sessionId }, signal), isContextResult);
}

export async function loadRequestDiff(
	host: PanelHost,
	sessionId: string,
	callId: string,
	signal: AbortSignal,
): Promise<RequestDiffResult> {
	return checked(
		await host.query(REQUEST_DIFF, { sessionId, callId }, signal),
		isRequestDiffResult,
	);
}

export async function loadCost(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionCostResult> {
	return checked(await host.query(SESSION_COST, { sessionId }, signal), isCostResult);
}

export async function loadFiles(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionFilesResult> {
	return checked(await host.query(SESSION_FILES, { sessionId }, signal), isFilesResult);
}

export async function loadFileDetail(
	host: PanelHost,
	sessionId: string,
	path: string,
	signal: AbortSignal,
): Promise<FileDetailResult> {
	return checked(await host.query(FILE_DETAIL, { sessionId, path }, signal), isFileDetailResult);
}
