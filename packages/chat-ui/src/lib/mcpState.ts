import type { McpServerState } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

export type McpStateTone = "success" | "working" | "warning" | "error" | "info" | "neutral";

export const MCP_STATE_KEY: Readonly<Record<McpServerState, MessageKey>> = {
	starting: "lib.mcpState.starting",
	connected: "lib.mcpState.connected",
	"needs-sign-in": "lib.mcpState.needsSignIn",
	failed: "lib.mcpState.failed",
	disconnected: "lib.mcpState.disconnected",
	disabled: "lib.mcpState.disabled",
	"disabled-in-project": "lib.mcpState.disabledInProject",
	"disabled-in-chat": "lib.mcpState.disabledInChat",
	"pending-approval": "lib.mcpState.pendingApproval",
	"invalid-config": "lib.mcpState.invalidConfig",
	"pending-reload": "lib.mcpState.pendingReload",
	"not-running": "lib.mcpState.notRunning",
	"handled-elsewhere": "lib.mcpState.handledElsewhere",
	unknown: "common.unknown",
};

export function mcpStateLabel(t: Translator, state: McpServerState): string {
	return t(MCP_STATE_KEY[state]);
}

const MCP_STATE_TONE: Readonly<Record<McpServerState, McpStateTone>> = {
	starting: "working",
	connected: "success",
	"needs-sign-in": "warning",
	failed: "error",
	disconnected: "warning",
	disabled: "neutral",
	"disabled-in-project": "neutral",
	"disabled-in-chat": "neutral",
	"pending-approval": "warning",
	"invalid-config": "error",
	"pending-reload": "info",
	"not-running": "neutral",
	"handled-elsewhere": "neutral",
	unknown: "neutral",
};

export function mcpStateTone(state: McpServerState, toolCount?: number): McpStateTone {
	return state === "connected" && toolCount === 0 ? "warning" : MCP_STATE_TONE[state];
}

export function isMcpAttentionState(state: McpServerState): boolean {
	return state === "needs-sign-in" || state === "failed" || state === "pending-approval";
}

export function isMcpActiveState(state: McpServerState): boolean {
	return state === "connected" || state === "starting";
}

export function mcpToolCountLabel(t: Translator, count: number): string {
	return t("lib.mcpState.toolCount", { count });
}

export function mcpStatusLabel(t: Translator, state: McpServerState, toolCount?: number): string {
	return state === "connected" && toolCount !== undefined
		? t("lib.mcpState.connectedWithTools", { count: toolCount })
		: mcpStateLabel(t, state);
}
