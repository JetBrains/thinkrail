import { parseChildId } from "./analysis.ts";
import {
	type EventGetParams,
	SESSION_INSIGHTS_API_VERSION,
	type SessionTraceParams,
	type SessionTraceResult,
	TRACE_PAGE_EVENTS,
	type TraceSearchParams,
} from "./core.ts";
import { parseSessionParams } from "./list.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";

const EVENT_ID_MAX = 400;
const REVISION_MAX = 100;
const QUERY_MIN = 2;
const QUERY_MAX = 200;

function invalid(method: string): Error {
	return new Error(`Invalid ${method} params`);
}

function optionalCount(value: unknown, method: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
	throw invalid(method);
}

export function parseTraceParams(value: unknown): SessionTraceParams {
	const method = "session.trace";
	const { sessionId } = parseSessionParams(value, method);
	const record = isRecord(value) ? value : {};
	const cursor = optionalCount(record.cursor, method);
	const limit = optionalCount(record.limit, method);
	if (limit === 0) throw invalid(method);
	const childId = parseChildId(value, method);
	const revision = parseRevision(record.revision, method);
	return {
		sessionId,
		...(childId !== undefined ? { childId } : {}),
		...(cursor !== undefined ? { cursor } : {}),
		...(limit !== undefined ? { limit } : {}),
		...(revision !== undefined ? { revision } : {}),
	};
}

/** An optional pinned revision, as a page's `meta.revision` carried it. */
export function parseRevision(value: unknown, method: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && value.length > 0 && value.length <= REVISION_MAX) return value;
	throw invalid(method);
}

export function parseEventParams(value: unknown): EventGetParams {
	const method = "event.get";
	const { sessionId } = parseSessionParams(value, method);
	const eventId = isRecord(value) ? value.eventId : undefined;
	if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > EVENT_ID_MAX)
		throw invalid(method);
	const childId = parseChildId(value, method);
	return { sessionId, eventId, ...(childId !== undefined ? { childId } : {}) };
}

export function parseSearchParams(value: unknown): TraceSearchParams {
	const method = "trace.search";
	const { sessionId } = parseSessionParams(value, method);
	const query = isRecord(value) ? value.query : undefined;
	if (typeof query !== "string") throw invalid(method);
	const trimmed = query.trim();
	if (trimmed.length < QUERY_MIN || trimmed.length > QUERY_MAX) throw invalid(method);
	return { sessionId, query: trimmed };
}

/**
 * One page of a trace in pre-order, so a parent always arrives before its children; `newerRevision`
 * when the trace is a pinned snapshot the file has moved past (`TraceStore.traceAt`).
 */
export function tracePage(
	trace: BuiltTrace | null,
	params: SessionTraceParams,
	options: { newerRevision?: boolean; pending?: boolean } = {},
): SessionTraceResult {
	const cursor = params.cursor ?? 0;
	if (!trace)
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			found: false,
			pending: options.pending === true,
			meta: null,
			cursor,
			next: null,
			events: [],
			newerRevision: false,
		};
	const limit = Math.min(params.limit ?? TRACE_PAGE_EVENTS, TRACE_PAGE_EVENTS);
	const end = Math.min(trace.events.length, cursor + limit);
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		found: true,
		pending: false,
		meta: trace.meta,
		cursor,
		next: end < trace.events.length ? end : null,
		events: trace.events.slice(cursor, end),
		newerRevision: options.newerRevision === true,
	};
}
