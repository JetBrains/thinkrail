import type { McpServerState } from "@thinkrail/contracts";

export type McpStateTone = "success" | "working" | "warning" | "error" | "info" | "neutral";

export const MCP_STATE_LABEL: Readonly<Record<McpServerState, string>> = {
	starting: "Starting",
	connected: "Connected",
	"needs-sign-in": "Needs sign-in",
	failed: "Failed",
	disconnected: "Disconnected",
	disabled: "Disabled",
	"disabled-in-project": "Disabled in this project",
	"disabled-in-chat": "Disabled in this chat",
	"pending-approval": "Pending approval",
	"invalid-config": "Invalid config",
	"pending-reload": "Pending reload",
	"not-running": "Not running",
	"handled-elsewhere": "Handled elsewhere",
	unknown: "Unknown",
};

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

export function mcpToolCountLabel(count: number): string {
	return `${count} tool${count === 1 ? "" : "s"}`;
}

export function mcpStatusLabel(state: McpServerState, toolCount?: number): string {
	return state === "connected" && toolCount !== undefined
		? `${MCP_STATE_LABEL.connected} · ${mcpToolCountLabel(toolCount)}`
		: MCP_STATE_LABEL[state];
}
