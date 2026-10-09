import { describe, expect, test } from "bun:test";
import type { McpServerStatus, McpServerSummary } from "@thinkrail/contracts";
import { deriveMcpServerStatuses, parseMcpAttentionNotice, parseMcpStatusText } from "./status";

describe("pi's headless /mcp text", () => {
	test("every state line, indented errors, config errors and overrides", () => {
		const parsed = parseMcpStatusText(
			[
				"docs: connected, 2 tools (deferred)",
				"empty: connected, 0 tools (direct)",
				"linear: needs sign-in, run /mcp login linear (deferred)",
				"off: disabled (deferred)",
				"flaky: disconnected, reconnects on next call (direct)",
				"slow: connecting (deferred)",
				"cold: starting (deferred)",
				"broken: failed (deferred)",
				"    spawn npx ENOENT",
				"    stderr: command not found",
				'config error: /home/u/.pi/agent/mcp.json: server "bad" needs either "command" or "url"',
				'overridden: "jira" registered by ext.ts is overridden by "jira" in mcp.json',
			].join("\n"),
		);
		expect(parsed).not.toBeNull();
		const state = (name: string) => parsed?.servers.get(name);
		expect(state("docs")).toMatchObject({ state: "connected", toolCount: 2 });
		expect(state("empty")).toMatchObject({ state: "connected", toolCount: 0 });
		expect(state("linear")?.state).toBe("needs-sign-in");
		expect(state("off")?.state).toBe("disabled");
		expect(state("flaky")?.state).toBe("disconnected");
		expect(state("slow")?.state).toBe("starting");
		expect(state("cold")?.state).toBe("starting");
		expect(state("broken")).toMatchObject({ state: "failed" });
		expect(state("broken")?.detail).toContain("stderr: command not found");
		expect(parsed?.configErrors).toHaveLength(1);
		expect(parsed?.servers.has("jira")).toBe(false);
	});

	test("the empty report parses; anything else is not status text", () => {
		expect(
			parseMcpStatusText("No MCP servers configured. Add them to x or .pi/mcp.json.")?.servers.size,
		).toBe(0);
		expect(
			parseMcpStatusText('Reconnected to MCP server "docs" (connected · 2 tools).'),
		).toBeNull();
	});

	test("details are redacted: pi reports connection errors and stderr tails verbatim", () => {
		const parsed = parseMcpStatusText(
			[
				"remote: failed (deferred)",
				'    MCP HTTP request failed with status 400: {"error":"rejected","api_key":"sk-live-abcdefgh1234"}',
				"local: disconnected, reconnects on next call (deferred)",
				"    Connection closed",
				"    GITHUB_TOKEN=ghp_abcdefghijklmnop1234 POST https://ada:pw@api.example/mcp",
			].join("\n"),
		);
		expect(parsed?.servers.get("remote")).toMatchObject({
			state: "failed",
			detail:
				'remote: failed (deferred)\nMCP HTTP request failed with status 400: {"error":"rejected","api_key":"***"}',
		});
		expect(parsed?.servers.get("local")?.detail).toBe(
			"local: disconnected, reconnects on next call (deferred)\nConnection closed\nGITHUB_TOKEN=*** POST https://***:***@api.example/mcp",
		);
		const notice = parseMcpAttentionNotice(
			"MCP servers need attention:\n  remote: failed: 401 for Bearer abc123\n  config: token=abc\nRun /mcp to fix.",
		);
		expect(notice?.servers.get("remote")?.detail).toBe("remote: failed: 401 for Bearer ***");
		expect(notice?.configErrors).toEqual(["token=***"]);
	});

	test("the startup attention notice has its own format", () => {
		const notice = parseMcpAttentionNotice(
			"MCP servers need attention:\n  config: bad file\n  linear: needs sign-in\n  broken: failed: spawn ENOENT\nRun /mcp to fix.",
		);
		expect(notice?.servers.get("linear")?.state).toBe("needs-sign-in");
		expect(notice?.servers.get("broken")).toMatchObject({ state: "failed" });
		expect(notice?.configErrors).toEqual(["bad file"]);
		expect(parseMcpAttentionNotice("something else")).toBeNull();
	});
});

const summary = (over: Partial<McpServerSummary> & { name: string }): McpServerSummary => ({
	scope: "user",
	source: "/agent/mcp.json",
	transport: "http",
	endpoint: "https://x",
	exposure: "deferred",
	effectiveExposure: "deferred",
	enabled: true,
	oauth: false,
	...over,
});

test("statuses explain what pi does not run and keep the last report when pi did not answer", () => {
	const summaries = [
		summary({ name: "chat-off" }),
		summary({ name: "project-off", projectOverride: { enabled: false } }),
		summary({ name: "repo", scope: "project", approval: { state: "pending", fingerprint: "f" } }),
		summary({ name: "invalid", configError: 'server "invalid" needs either "command" or "url"' }),
	];
	const reported = parseMcpStatusText(
		"chat-off: disabled (deferred)\nproject-off: disabled (deferred)",
	);
	const derived = deriveMcpServerStatuses({
		summaries,
		reported,
		disabledInChat: new Set(["chat-off"]),
		previous: [],
		now: 1,
	});
	expect(Object.fromEntries(derived.map((status) => [status.name, status.state]))).toEqual({
		"chat-off": "disabled-in-chat",
		"project-off": "disabled-in-project",
		repo: "pending-approval",
		invalid: "invalid-config",
	});
	const previous: McpServerStatus[] = [
		{ name: "chat-off", state: "connected", toolCount: 3, updatedAt: 1 },
	];
	const stale = deriveMcpServerStatuses({
		summaries: [summary({ name: "chat-off" })],
		reported: null,
		disabledInChat: new Set(),
		previous,
		now: 2,
	});
	expect(stale).toEqual(previous);
});
