import { expect, test } from "bun:test";
import type { McpServerState } from "@thinkrail/contracts";
import {
	isMcpActiveState,
	isMcpAttentionState,
	MCP_STATE_LABEL,
	mcpStateTone,
	mcpStatusLabel,
	mcpToolCountLabel,
} from "./mcpState";

const STATES = Object.keys(MCP_STATE_LABEL) as McpServerState[];

test("attention is exactly sign-in, failure and approval; active is connected or starting", () => {
	expect(STATES.filter(isMcpAttentionState).sort()).toEqual([
		"failed",
		"needs-sign-in",
		"pending-approval",
	]);
	expect(STATES.filter(isMcpActiveState).sort()).toEqual(["connected", "starting"]);
});

test("a connected server with zero tools warns, and the status label carries the tool count", () => {
	expect(mcpStateTone("connected", 2)).toBe("success");
	expect(mcpStateTone("connected", 0)).toBe("warning");
	expect(mcpStateTone("failed")).toBe("error");
	expect(mcpStatusLabel("connected", 2)).toBe("Connected · 2 tools");
	expect(mcpStatusLabel("connected", 1)).toBe("Connected · 1 tool");
	expect(mcpStatusLabel("connected")).toBe("Connected");
	expect(mcpStatusLabel("disabled-in-chat", 3)).toBe("Disabled in this chat");
	expect(mcpToolCountLabel(0)).toBe("0 tools");
});
