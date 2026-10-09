import type {
	McpListResult,
	McpServerEntryInput,
	McpServerSummary,
	WsParams,
} from "@thinkrail/contracts";
import { MCP_STATE_LABEL, type McpStateTone, mcpStateTone, mcpToolCountLabel } from "@/lib";
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

export function mcpHandledElsewhereText(by: string): string {
	return by === DISABLED_IN_PI_SETTINGS
		? "MCP is turned off in pi settings (-builtin:mcp); remove that entry to manage servers here."
		: `MCP is handled by ${by} in this workspace; ThinkRail's MCP management is read-only.`;
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

export function formatStartingElapsed(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	return minutes < 1 ? "<1 min" : `${minutes} min`;
}

function inChats(row: McpServerRow, count: number): string {
	return row.sessions.total > 1 ? ` in ${count} of ${row.sessions.total} chats` : "";
}

export function mcpRowView(row: McpServerRow, now: number): McpRowView {
	const { summary } = row;
	const view = baseView(row, now);
	if (
		row.approvalPending &&
		row.state !== "pending-approval" &&
		row.state !== "handled-elsewhere"
	) {
		return {
			...view,
			reason:
				summary.approval?.state === "changed"
					? "The repository's override changed since you approved it — review it again."
					: "The repository overrides this server's settings — review the change.",
			action: "review",
		};
	}
	return view;
}

function baseView(row: McpServerRow, now: number): McpRowView {
	const { summary } = row;
	const http = summary.transport === "http";
	switch (row.state) {
		case "replaced":
			return {
				label: "Replaced by project",
				tone: "neutral",
				reason: "This project's own entry runs instead.",
			};
		case "handled-elsewhere":
			return { label: MCP_STATE_LABEL["handled-elsewhere"], tone: "neutral" };
		case "starting":
			return {
				label: `Starting · ${formatStartingElapsed(now - (row.startingSince ?? now))}`,
				tone: "working",
				...(row.sessions.total > 1
					? { reason: `Starting${inChats(row, row.sessions.reporting.length)}.` }
					: {}),
			};
		case "connected": {
			const tools = row.toolCount === undefined ? "" : ` · ${mcpToolCountLabel(row.toolCount)}`;
			return {
				label: `Connected${inChats(row, row.sessions.connected)}${tools}`,
				tone: mcpStateTone("connected", row.toolCount),
				...(row.toolCount === 0 ? { reason: "The server reports no tools." } : {}),
			};
		}
		case "needs-sign-in":
			return {
				label: MCP_STATE_LABEL["needs-sign-in"],
				tone: "warning",
				reason: "Sign in to let chats use this server.",
				...(summary.oauth ? { action: "sign-in" as const } : {}),
			};
		case "failed":
			return {
				label: MCP_STATE_LABEL.failed,
				tone: "error",
				reason: mcpDetailReason(row.detail, summary.name) ?? "The server failed to start.",
				action: "reconnect",
				secondary: "show-log",
			};
		case "disconnected":
			return {
				label: MCP_STATE_LABEL.disconnected,
				tone: "warning",
				reason: "Reconnects on the next call.",
				action: "reconnect",
			};
		case "disabled":
			return { label: MCP_STATE_LABEL.disabled, tone: "neutral", reason: "Turned off." };
		case "disabled-in-project":
			return {
				label: MCP_STATE_LABEL["disabled-in-project"],
				tone: "neutral",
				reason: "Turned off for this project only.",
			};
		case "disabled-in-chat":
			return {
				label: `Disabled in ${row.sessions.total > 1 ? `${row.sessions.reporting.length} of ${row.sessions.total} chats` : "1 chat"}`,
				tone: "neutral",
				reason: "Turned off from a chat's Resources.",
			};
		case "pending-approval":
			return summary.approval?.state === "changed"
				? {
						label: "Changed since approval",
						tone: "warning",
						reason: "The entry changed since you approved it — review it again.",
						action: "review",
					}
				: {
						label: MCP_STATE_LABEL["pending-approval"],
						tone: "warning",
						reason: "Defined by this repository — review what it runs before it starts.",
						action: "review",
					};
		case "invalid-config":
			return {
				label: MCP_STATE_LABEL["invalid-config"],
				tone: "error",
				reason: firstLine(summary.configError ?? row.detail) ?? "pi rejected this entry.",
				...(summary.scope === "project" ? { action: "edit" as const } : {}),
			};
		case "pending-reload":
			return {
				label: MCP_STATE_LABEL["pending-reload"],
				tone: "info",
				reason: "Applies when the chat is idle.",
				action: "reload",
			};
		case "not-running":
			return {
				label: MCP_STATE_LABEL["not-running"],
				tone: "neutral",
				reason: "Starts when a chat opens in this workspace.",
				action: "open-chat",
				...(http ? { secondary: "test-connection" as const } : {}),
			};
		case "unknown":
			return {
				label: MCP_STATE_LABEL.unknown,
				tone: "neutral",
				reason: row.startingStalled
					? "Still starting after a minute — pi has not answered."
					: "pi has not reported this server yet.",
			};
	}
}

export type McpSettingChange = { enabled: boolean } | { exposure: McpEditableExposure };

type McpSettingWrite =
	| { method: "mcp.setProjectOverride"; params: WsParams<"mcp.setProjectOverride"> }
	| { method: "mcp.update"; params: WsParams<"mcp.update"> };

export function mcpEntryUpdate(
	workspaceId: string,
	summary: McpServerSummary,
	entry: McpServerEntryInput,
): WsParams<"mcp.update"> {
	return {
		workspaceId,
		scope: summary.scope,
		name: summary.name,
		entry,
		...(summary.scope === "project" && summary.approval
			? { expectedFingerprint: summary.approval.fingerprint }
			: {}),
	};
}

export function mcpSettingWrite(
	workspaceId: string,
	summary: McpServerSummary,
	change: McpSettingChange,
	projectEntry: McpServerEntryInput | null,
): McpSettingWrite {
	if (summary.scope === "user") {
		const override = { ...summary.projectOverride, ...change };
		return {
			method: "mcp.setProjectOverride",
			params: {
				workspaceId,
				name: summary.name,
				...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
				...(override.exposure !== undefined ? { exposure: override.exposure } : {}),
			},
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
		? "Saved — applies when a chat starts in this workspace."
		: "Saved — applies to open chats as they reload; a busy chat waits until it is idle.";
}

export function mcpExposureLabel(exposure: McpEditableExposure): string {
	return exposure.charAt(0).toUpperCase() + exposure.slice(1);
}

export function mcpConfiguredExposureText(summary: McpServerSummary): string {
	return summary.exposure === "codemode"
		? "codemode — treated as deferred (codemode not available yet)"
		: summary.exposure;
}
