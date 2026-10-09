import { expect, test } from "bun:test";
import type { McpListResult, McpServerSummary } from "@thinkrail/contracts";
import type { McpServerRow } from "@/store";
import {
	formatStartingElapsed,
	mcpChatFailureText,
	mcpConfiguredExposureText,
	mcpEntryUpdate,
	mcpHandledElsewhereText,
	mcpRowView,
	mcpSaveFeedback,
	mcpSettingWrite,
} from "./mcpServerView";

const NOW = 5_000_000;

function summary(overrides: Partial<McpServerSummary> = {}): McpServerSummary {
	return {
		name: "docs",
		scope: "user",
		source: "/home/.pi/agent/mcp.json",
		transport: "stdio",
		endpoint: "bun docs.ts",
		exposure: "deferred",
		effectiveExposure: "deferred",
		enabled: true,
		oauth: false,
		...overrides,
	};
}

function row(overrides: Partial<McpServerRow> = {}, summaryOverrides = {}): McpServerRow {
	return {
		key: "user:docs",
		summary: summary(summaryOverrides),
		state: "connected",
		sessions: { total: 1, reporting: ["s1"], connected: 1 },
		startingStalled: false,
		approvalPending: false,
		attention: false,
		...overrides,
	};
}

test("connected rows carry tool counts, partial chat coverage, and warn at zero tools", () => {
	expect(mcpRowView(row({ toolCount: 2 }), NOW)).toEqual({
		label: "Connected · 2 tools",
		tone: "success",
	});
	expect(
		mcpRowView(
			row({ toolCount: 2, sessions: { total: 3, reporting: ["s1", "s2"], connected: 2 } }),
			NOW,
		).label,
	).toBe("Connected in 2 of 3 chats · 2 tools");
	expect(mcpRowView(row({ toolCount: 0 }), NOW)).toEqual({
		label: "Connected · 0 tools",
		tone: "warning",
		reason: "The server reports no tools.",
	});
});

test("each non-green state has one reason line, at most one action and one secondary action", () => {
	const view = (overrides: Partial<McpServerRow>, summaryOverrides = {}) =>
		mcpRowView(row(overrides, summaryOverrides), NOW);
	expect(view({ state: "starting", startingSince: NOW - 90_000 })).toMatchObject({
		label: "Starting · 1 min",
		tone: "working",
	});
	expect(view({ state: "unknown", startingStalled: true }).reason).toContain("Still starting");
	expect(
		view({ state: "needs-sign-in" }, { transport: "http", oauth: true, endpoint: "https://x" }),
	).toMatchObject({ label: "Needs sign-in", action: "sign-in" });
	expect(view({ state: "failed", detail: "docs: failed (deferred)\n    spawn ENOENT" })).toEqual({
		label: "Failed",
		tone: "error",
		reason: "spawn ENOENT",
		action: "reconnect",
		secondary: "show-log",
	});
	expect(view({ state: "failed", detail: "docs: failed: timed out" }).reason).toBe("timed out");
	expect(view({ state: "failed", detail: "docs: failed (deferred)" }).reason).toBe(
		"The server failed to start.",
	);
	expect(view({ state: "failed" }, { transport: "http" }).action).toBe("reconnect");
	expect(view({ state: "disconnected" })).toMatchObject({
		reason: "Reconnects on the next call.",
		action: "reconnect",
	});
	expect(view({ state: "disconnected" }).secondary).toBeUndefined();
	expect(view({ state: "disabled-in-project" }).label).toBe("Disabled in this project");
	expect(
		view({ state: "disabled-in-chat", sessions: { total: 3, reporting: ["a", "b"], connected: 1 } })
			.label,
	).toBe("Disabled in 2 of 3 chats");
	expect(
		view(
			{ state: "pending-approval" },
			{ scope: "project", approval: { state: "pending", fingerprint: "f" } },
		),
	).toMatchObject({ label: "Pending approval", action: "review" });
	expect(
		view(
			{ state: "pending-approval" },
			{ scope: "project", approval: { state: "changed", fingerprint: "f" } },
		),
	).toMatchObject({ label: "Changed since approval", action: "review" });
	expect(
		view({ state: "invalid-config" }, { scope: "project", configError: "bad url" }),
	).toMatchObject({ reason: "bad url", action: "edit" });
	expect(view({ state: "invalid-config" }, { configError: "bad url" })).toEqual({
		label: "Invalid config",
		tone: "error",
		reason: "bad url",
	});
	expect(view({ state: "pending-reload" })).toMatchObject({
		reason: "Applies when the chat is idle.",
		action: "reload",
	});
	expect(view({ state: "not-running" })).toEqual({
		label: "Not running",
		tone: "neutral",
		reason: "Starts when a chat opens in this workspace.",
		action: "open-chat",
	});
	expect(view({ state: "not-running" }, { transport: "http" })).toMatchObject({
		action: "open-chat",
		secondary: "test-connection",
	});
	expect(view({ state: "replaced" }).label).toBe("Replaced by project");
	expect(view({ state: "handled-elsewhere" }).action).toBeUndefined();
});

test("a pending repository override turns any live row into a review", () => {
	expect(
		mcpRowView(
			row(
				{ toolCount: 1, approvalPending: true },
				{ approval: { state: "pending", fingerprint: "o" } },
			),
			NOW,
		),
	).toMatchObject({ label: "Connected · 1 tool", action: "review" });
});

test("enablement and exposure route by scope: user servers write the project record, repo servers their file", () => {
	const user = summary({ projectOverride: { exposure: "direct" } });
	expect(mcpSettingWrite("ws", user, { enabled: false }, null)).toEqual({
		method: "mcp.setProjectOverride",
		params: { workspaceId: "ws", name: "docs", enabled: false, exposure: "direct" },
	});
	expect(mcpSettingWrite("ws", summary(), { exposure: "hidden" }, null)).toEqual({
		method: "mcp.setProjectOverride",
		params: { workspaceId: "ws", name: "docs", exposure: "hidden" },
	});
	const project = summary({
		scope: "project",
		approval: { state: "approved", fingerprint: "rendered" },
	});
	expect(
		mcpSettingWrite("ws", project, { enabled: false }, { command: "x", exposure: "direct" }),
	).toEqual({
		method: "mcp.update",
		params: {
			workspaceId: "ws",
			scope: "project",
			name: "docs",
			entry: { command: "x", exposure: "direct", enabled: false },
			expectedFingerprint: "rendered",
		},
	});
	expect(
		mcpSettingWrite("ws", project, { exposure: "hidden" }, { command: "x", enabled: false }).params,
	).toMatchObject({
		entry: { command: "x", enabled: false, exposure: "hidden" },
		expectedFingerprint: "rendered",
	});
	expect(
		mcpSettingWrite("ws", project, { enabled: true }, { command: "x", enabled: false }).params,
	).toMatchObject({ entry: { command: "x" } });
	expect(() => mcpSettingWrite("ws", project, { enabled: true }, null)).toThrow(".pi/mcp.json");
});

test("a repo entry update carries the fingerprint its row was rendered with; a user entry update never does", () => {
	const entry = { command: "x" };
	expect(
		mcpEntryUpdate(
			"ws",
			summary({ scope: "project", approval: { state: "changed", fingerprint: "seen" } }),
			entry,
		),
	).toEqual({
		workspaceId: "ws",
		scope: "project",
		name: "docs",
		entry,
		expectedFingerprint: "seen",
	});
	expect(
		mcpEntryUpdate(
			"ws",
			summary({ approval: { state: "approved", fingerprint: "override" } }),
			entry,
		),
	).toEqual({ workspaceId: "ws", scope: "user", name: "docs", entry });
});

test("save feedback never claims open chats already applied a change they are still reloading for", () => {
	const result = (states: string[][]): McpListResult => ({
		servers: [],
		statuses: states.map((servers, index) => ({
			workspaceId: "ws",
			sessionId: `s${index}`,
			generation: 1,
			servers: servers.map((state) => ({
				name: "docs",
				state: state as McpListResult["statuses"][number]["servers"][number]["state"],
				updatedAt: 1,
			})),
		})),
	});
	expect(mcpSaveFeedback(result([]))).toBe("Saved — applies when a chat starts in this workspace.");
	const open = "Saved — applies to open chats as they reload; a busy chat waits until it is idle.";
	expect(mcpSaveFeedback(result([["connected"], ["connected"]]))).toBe(open);
	expect(mcpSaveFeedback(result([["connected"], ["pending-reload"]]))).toBe(open);
});

test("the handled-elsewhere notice names the owning extension, or the pi setting to remove", () => {
	expect(mcpHandledElsewhereText("/home/me/.pi/agent/extensions/my-mcp.ts")).toBe(
		"MCP is handled by /home/me/.pi/agent/extensions/my-mcp.ts in this workspace; ThinkRail's MCP management is read-only.",
	);
	expect(mcpHandledElsewhereText("pi settings (-builtin:mcp)")).toBe(
		"MCP is turned off in pi settings (-builtin:mcp); remove that entry to manage servers here.",
	);
});

test("a per-chat action reports its one chat's error as is, and names the chat when it targeted several", () => {
	expect(mcpChatFailureText([], 2)).toBeNull();
	expect(mcpChatFailureText([{ chat: "Fix login", error: "spawn ENOENT" }], 1)).toBe(
		"spawn ENOENT",
	);
	expect(
		mcpChatFailureText(
			[
				{
					chat: "Fix login",
					error: "Can't reload while the chat is busy — try again after the turn.",
				},
				{ chat: "Docs", error: "timed out" },
			],
			3,
		),
	).toBe(
		"Fix login: Can't reload while the chat is busy — try again after the turn.\nDocs: timed out",
	);
});

test("configured codemode is labelled as treated like deferred", () => {
	expect(mcpConfiguredExposureText(summary({ exposure: "codemode" }))).toBe(
		"codemode — treated as deferred (codemode not available yet)",
	);
	expect(mcpConfiguredExposureText(summary({ exposure: "direct" }))).toBe("direct");
	expect(formatStartingElapsed(20_000)).toBe("<1 min");
});
