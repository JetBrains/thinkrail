import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	SessionOverviewQuery,
	SessionOverviewResult,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";
import { PENDING, type Pending, VersionSkew } from "../session/api";

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

/** The session's cards; `null`: the host does not have it, `PENDING`: its index has not reached it yet. */
export async function loadSessionOverview(
	host: PanelHost,
	sessionId: string,
	signal: AbortSignal,
): Promise<SessionOverviewResult | Pending | null> {
	const value = await host.query(SESSION_OVERVIEW, { sessionId }, signal);
	if (!isOverviewResult(value)) throw new VersionSkew();
	if (value.overview) return value;
	return value.pending ? PENDING : null;
}

/** Ask again while the index has not reached the session, or the scope's findings are still being counted. */
export function overviewPending(value: SessionOverviewResult | Pending | null): boolean {
	return value === PENDING || value?.overview?.findings === null;
}
