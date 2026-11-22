import type { PanelChatTarget, PanelHost } from "@thinkrail/extension-api/web";
import type {
	SessionInsightsApiVersion,
	SessionListRow,
	SessionsListParams,
	SessionsListQuery,
	SessionsListResult,
	SessionsListScope,
} from "@thinkrail/pi-session-insights/core";

export const SESSIONS_LIST: SessionsListQuery = "sessions.list";
export const API_VERSION: SessionInsightsApiVersion = 11;
export const SESSION_PANEL = "session";
export const COMPARE_PANEL = "compare";

export type ScopeKind = SessionsListScope["kind"];

export type ListFailure = "disabled" | "updateHost" | "failed";

export type ListOutcome = { kind: "ok"; result: SessionsListResult } | { kind: "version" };

export function hostServesThisVersion(host: PanelHost): boolean {
	return host.hostApiVersion === API_VERSION;
}

export function listScope(host: PanelHost, kind: ScopeKind): SessionsListScope {
	return kind === "all" ? { kind: "all" } : { kind: "project", projectId: host.scope.projectId };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSessionsList(value: unknown): value is SessionsListResult {
	return (
		isObject(value) &&
		value.apiVersion === API_VERSION &&
		isObject(value.state) &&
		Array.isArray(value.projects) &&
		Array.isArray(value.rows) &&
		isObject(value.sources)
	);
}

/** `fresh`: revalidate the host's index now (the panel's mount and Refresh), not on its own schedule. */
export async function loadSessions(
	host: PanelHost,
	scope: SessionsListScope,
	signal: AbortSignal,
	fresh = false,
): Promise<ListOutcome> {
	const params: SessionsListParams = fresh ? { scope, fresh } : { scope };
	const value = await host.query(SESSIONS_LIST, params, signal);
	return isSessionsList(value) ? { kind: "ok", result: value } : { kind: "version" };
}

export function listFailure(error: unknown): ListFailure {
	const code = isObject(error) ? error.code : undefined;
	if (code === "EXTENSION_DISABLED") return "disabled";
	if (code === "UNKNOWN_EXTENSION_QUERY") return "updateHost";
	return "failed";
}

export function chatTarget(row: SessionListRow): PanelChatTarget | null {
	if (row.workspaceState !== "open" || row.projectId === null || row.workspaceId === null)
		return null;
	return { projectId: row.projectId, workspaceId: row.workspaceId, sessionId: row.sessionId };
}

export function openSession(host: PanelHost, row: SessionListRow): boolean {
	const target = chatTarget(row);
	if (target) host.openChat(target);
	return target !== null;
}

/** Opens the session's analysis in its own tab, named after the session. */
export function openAnalysis(host: PanelHost, row: SessionListRow, title: string): void {
	host.openPanel(SESSION_PANEL, { sessionId: row.sessionId }, title);
}

/** Opens two sessions side by side in their own tab (one tab per ordered pair). */
export function openComparison(host: PanelHost, a: string, b: string, title: string): void {
	host.openPanel(COMPARE_PANEL, { a, b }, title);
}
