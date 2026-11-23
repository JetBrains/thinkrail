import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	SessionsSearchParams,
	SessionsSearchQuery,
	SessionsSearchResult,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";
import { VersionSkew } from "../session/api";

export const SESSIONS_SEARCH: SessionsSearchQuery = "search";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSearch(value: unknown): value is SessionsSearchResult {
	return (
		isObject(value) &&
		value.apiVersion === API_VERSION &&
		typeof value.seq === "number" &&
		typeof value.status === "string" &&
		isObject(value.state) &&
		isObject(value.digests) &&
		isObject(value.query) &&
		Array.isArray(value.sessions) &&
		Array.isArray(value.groups) &&
		isObject(value.total) &&
		isObject(value.facets)
	);
}

/** One answer of the panel's search job (`search`); a payload of another version is a skew. */
export async function loadSearch(
	host: PanelHost,
	params: SessionsSearchParams,
	signal: AbortSignal,
): Promise<SessionsSearchResult> {
	const value = await host.query(SESSIONS_SEARCH, params, signal);
	if (!isSearch(value)) throw new VersionSkew();
	return value;
}
