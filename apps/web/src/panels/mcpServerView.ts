import type {
	McpListResult,
	McpRenderedTarget,
	McpServerEntryInput,
	McpServerSummary,
	WsParams,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, t } from "@thinkrail/locales/react";
import { type McpStateTone, mcpStateLabel, mcpStateTone, mcpToolCountLabel } from "@/lib";
import type { McpServerRow } from "@/store";
import { type McpEditableExposure, withEnabled, withExposure } from "./mcpEntries";

export type McpRowAction =
	| "sign-in"
	| "review"
	| "edit"
	| "test-connection"
	| "reconnect"
	| "reload"
	| "open-chat"
	| "show-log";

export interface McpRowView {
	label: string;
	tone: McpStateTone;
	reason?: string;
	action?: McpRowAction;
	secondary?: McpRowAction;
}

const DISABLED_IN_PI_SETTINGS = "pi settings (-builtin:mcp)";

export function mcpHandledElsewhereText(t: Translator, by: string): string {
	return by === DISABLED_IN_PI_SETTINGS
		? t("mcp.handledElsewhere.piSettings")
		: t("mcp.handledElsewhere.by", { by });
}

export interface McpChatFailure {
	chat: string;
	error: string;
}

export function mcpChatFailureText(
	failures: readonly McpChatFailure[],
	targeted: number,
): string | null {
	const [first] = failures;
	if (!first) return null;
	return targeted === 1
		? first.error
		: failures.map((failure) => `${failure.chat}: ${failure.error}`).join("\n");
}

function firstLine(text: string | undefined): string | undefined {
	return text
		?.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
}

const STATUS_LINE_TAIL = / \((?:codemode|deferred|direct|hidden)\)$/;
const STATE_PREFIX = /^(?:failed|disconnected|starting|connecting…?)(?::\s*|,\s*|$)/;

function mcpDetailReason(detail: string | undefined, name: string): string | undefined {
	const [head = "", ...rest] = (detail ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (rest[0]) return rest[0];
	const body = head.startsWith(`${name}: `) ? head.slice(name.length + 2) : head;
	return body.replace(STATUS_LINE_TAIL, "").replace(STATE_PREFIX, "").trim() || undefined;
}

export function formatStartingElapsed(t: Translator, ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	return minutes < 1 ? t("mcp.elapsed.underMinute") : t("mcp.elapsed.minutes", { minutes });
}

export function mcpRowView(t: Translator, row: McpServerRow, now: number): McpRowView {
	const { summary } = row;
	const view = baseView(t, row, now);
	if (
		row.approvalPending &&
		row.state !== "pending-approval" &&
		row.state !== "handled-elsewhere"
	) {
		return {
			...view,
			reason:
				summary.approval?.state === "changed"
					? t("mcp.row.overrideChanged")
					: t("mcp.row.overridePending"),
			action: "review",
		};
	}
	return view;
}

function baseView(t: Translator, row: McpServerRow, now: number): McpRowView {
	const { summary } = row;
	const http = summary.transport === "http";
	switch (row.state) {
		case "replaced":
			return {
				label: t("mcp.row.replaced"),
				tone: "neutral",
				reason: t("mcp.row.replacedReason"),
			};
		case "handled-elsewhere":
			return { label: mcpStateLabel(t, "handled-elsewhere"), tone: "neutral" };
		case "starting":
			return {
				label: t("mcp.row.starting", {
					elapsed: formatStartingElapsed(t, now - (row.startingSince ?? now)),
				}),
				tone: "working",
				...(row.sessions.total > 1
					? {
							reason: t("mcp.row.startingInChats", {
								count: row.sessions.reporting.length,
								total: row.sessions.total,
							}),
						}
					: {}),
			};
		case "connected": {
			const tools = row.toolCount === undefined ? "" : ` · ${mcpToolCountLabel(t, row.toolCount)}`;
			const connected =
				row.sessions.total > 1
					? t("mcp.row.connectedInChats", {
							count: row.sessions.connected,
							total: row.sessions.total,
						})
					: t("mcp.row.connected");
			return {
				label: `${connected}${tools}`,
				tone: mcpStateTone("connected", row.toolCount),
				...(row.toolCount === 0 ? { reason: t("mcp.row.noTools") } : {}),
			};
		}
		case "needs-sign-in":
			return {
				label: mcpStateLabel(t, "needs-sign-in"),
				tone: "warning",
				reason: t("mcp.row.signInReason"),
				...(row.effective && summary.oauth ? { action: "sign-in" as const } : {}),
			};
		case "failed":
			return {
				label: mcpStateLabel(t, "failed"),
				tone: "error",
				reason: mcpDetailReason(row.detail, summary.name) ?? t("mcp.row.failedReason"),
				action: "reconnect",
				secondary: "show-log",
			};
		case "disconnected":
			return {
				label: mcpStateLabel(t, "disconnected"),
				tone: "warning",
				reason: t("mcp.row.disconnectedReason"),
				action: "reconnect",
			};
		case "disabled":
			return {
				label: mcpStateLabel(t, "disabled"),
				tone: "neutral",
				reason: t("mcp.row.disabledReason"),
			};
		case "disabled-in-project":
			return {
				label: mcpStateLabel(t, "disabled-in-project"),
				tone: "neutral",
				reason: t("mcp.row.disabledInProjectReason"),
			};
		case "disabled-in-chat":
			return {
				label:
					row.sessions.total > 1
						? t("mcp.row.disabledInChats", {
								count: row.sessions.reporting.length,
								total: row.sessions.total,
							})
						: t("mcp.row.disabledInOneChat"),
				tone: "neutral",
				reason: t("mcp.row.disabledInChatReason"),
			};
		case "pending-approval":
			return summary.approval?.state === "changed"
				? {
						label: t("mcp.row.changedSinceApproval"),
						tone: "warning",
						reason: t("mcp.row.changedSinceApprovalReason"),
						action: "review",
					}
				: {
						label: mcpStateLabel(t, "pending-approval"),
						tone: "warning",
						reason: t("mcp.row.pendingApprovalReason"),
						action: "review",
					};
		case "invalid-config":
			return {
				label: mcpStateLabel(t, "invalid-config"),
				tone: "error",
				reason: firstLine(summary.configError ?? row.detail) ?? t("mcp.row.invalidConfigReason"),
				...(summary.scope === "project" ? { action: "edit" as const } : {}),
			};
		case "pending-reload":
			return {
				label: mcpStateLabel(t, "pending-reload"),
				tone: "info",
				reason: t("mcp.row.pendingReloadReason"),
				action: "reload",
			};
		case "not-running":
			return {
				label: mcpStateLabel(t, "not-running"),
				tone: "neutral",
				reason: t("mcp.row.notRunningReason"),
				action: "open-chat",
				...(row.effective && http ? { secondary: "test-connection" as const } : {}),
			};
		case "unknown":
			return {
				label: mcpStateLabel(t, "unknown"),
				tone: "neutral",
				reason: row.startingStalled ? t("mcp.row.stalledReason") : t("mcp.row.unknownReason"),
			};
	}
}

export type McpSettingChange = { enabled: boolean } | { exposure: McpEditableExposure };

type McpSettingWrite =
	| { method: "mcp.setProjectOverride"; params: WsParams<"mcp.setProjectOverride"> }
	| { method: "mcp.update"; params: WsParams<"mcp.update"> };

/** The row's identity for a rewrite or removal: its scope and the fingerprint it was rendered with. */
export function mcpRenderedTarget(summary: McpServerSummary): McpRenderedTarget {
	return { scope: summary.scope, expectedFingerprint: summary.fingerprint };
}

export function mcpEntryUpdate(
	workspaceId: string,
	summary: McpServerSummary,
	entry: McpServerEntryInput,
): WsParams<"mcp.update"> {
	return { workspaceId, name: summary.name, entry, ...mcpRenderedTarget(summary) };
}

export function mcpSettingWrite(
	workspaceId: string,
	summary: McpServerSummary,
	change: McpSettingChange,
	projectEntry: McpServerEntryInput | null,
): McpSettingWrite {
	if (summary.scope === "user") {
		return {
			method: "mcp.setProjectOverride",
			params: { workspaceId, name: summary.name, ...change },
		};
	}
	if (!projectEntry) throw new Error(`Read "${summary.name}" from .pi/mcp.json first.`);
	return {
		method: "mcp.update",
		params: mcpEntryUpdate(
			workspaceId,
			summary,
			"enabled" in change
				? withEnabled(projectEntry, change.enabled)
				: withExposure(projectEntry, change.exposure),
		),
	};
}

export function mcpSaveFeedback(result: McpListResult): string {
	return result.statuses.length === 0
		? t("mcp.saveFeedback.noChats")
		: t("mcp.saveFeedback.openChats");
}

const EXPOSURE_LABEL = {
	deferred: "mcp.exposure.deferred",
	direct: "mcp.exposure.direct",
	hidden: "mcp.exposure.hidden",
} as const satisfies Record<McpEditableExposure, MessageKey>;

export function mcpExposureLabel(t: Translator, exposure: McpEditableExposure): string {
	return t(EXPOSURE_LABEL[exposure]);
}

export function mcpConfiguredExposureText(t: Translator, summary: McpServerSummary): string {
	return summary.exposure === "codemode" ? t("mcp.exposure.codemodeConfigured") : summary.exposure;
}
