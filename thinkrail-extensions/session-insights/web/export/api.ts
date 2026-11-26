import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	ExportCut,
	ExportFixtureParams,
	ExportFixtureQuery,
	ExportHtmlQuery,
	ExportKind,
	ExportResult,
	ExportTraceQuery,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";
import { VersionSkew } from "../session/api";

export const EXPORT_HTML: ExportHtmlQuery = "export.html";
export const EXPORT_TRACE: ExportTraceQuery = "export.trace";
export const EXPORT_FIXTURE: ExportFixtureQuery = "export.fixture";

const QUERY = {
	html: EXPORT_HTML,
	trace: EXPORT_TRACE,
	fixture: EXPORT_FIXTURE,
} as const satisfies Record<ExportKind, string>;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isExport(value: unknown): value is ExportResult {
	return isObject(value) && value.apiVersion === API_VERSION && typeof value.ok === "boolean";
}

export interface ExportRequest {
	kind: ExportKind;
	sessionId: string;
	includeLabels: boolean;
	/** The fixture's cut; the server's default (the end of the last turn) when omitted. */
	cut?: ExportCut;
	name?: string;
}

/** Asks the server half to write an export into the panel's workspace's artifacts folder. */
export async function runExport(host: PanelHost, request: ExportRequest): Promise<ExportResult> {
	const params: ExportFixtureParams = {
		sessionId: request.sessionId,
		workspaceId: host.scope.workspaceId,
		includeLabels: request.includeLabels,
		...(request.kind === "fixture" && request.cut ? { cut: request.cut } : {}),
		...(request.kind === "fixture" && request.name ? { name: request.name } : {}),
	};
	const value = await host.query(QUERY[request.kind], params);
	if (!isExport(value)) throw new VersionSkew();
	return value;
}
