import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	SessionOverviewParams,
	SessionOverviewQuery,
	SessionOverviewResult,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";
import { PENDING, type Pending, VersionSkew } from "../session/api";
import type { Query } from "../useKeyedQuery";

export const SESSION_OVERVIEW: SessionOverviewQuery = "session.overview";

function isOverviewResult(value: unknown): value is SessionOverviewResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"apiVersion" in value &&
		value.apiVersion === API_VERSION &&
		"found" in value &&
		typeof value.found === "boolean" &&
		"overview" in value &&
		"sources" in value
	);
}

/**
 * The session's cards, of `revision` when given; `null`: the host does not have it, `PENDING`: its index
 * has not reached it yet.
 */
export async function loadSessionOverview(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
	revision?: string,
): Promise<SessionOverviewResult | Pending | null> {
	const params: SessionOverviewParams =
		revision === undefined ? { sessionId } : { sessionId, revision };
	const value = await host.query(SESSION_OVERVIEW, params, signal);
	if (!isOverviewResult(value)) throw new VersionSkew();
	if (value.overview) return value;
	return value.pending ? PENDING : null;
}

/** The revision a poll pins: the one its last answer's cards read (none before the first). */
export function answeredRevision(
	last: SessionOverviewResult | Pending | null | undefined,
): string | undefined {
	return last === undefined || last === null || last === PENDING
		? undefined
		: last.overview?.revision;
}

/** The cards answered read another revision of the session than its trace (`null` while unknown). */
export function readsOtherRevision(
	query: Query<SessionOverviewResult | Pending | null>,
	traceRevision: string | null,
): boolean {
	if (query.kind !== "ready" || query.value === null || query.value === PENDING) return false;
	const cards = query.value.overview;
	return cards !== null && traceRevision !== null && cards.revision !== traceRevision;
}

/** Ask again while the index has not reached the session, or the scope's findings are still being counted. */
export function overviewPending(value: SessionOverviewResult | Pending | null): boolean {
	return value === PENDING || value?.overview?.findings === null;
}
