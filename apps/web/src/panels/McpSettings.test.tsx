import { expect, test } from "bun:test";
import type { McpServerSummary } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpServerRow } from "@/store";
import { McpRunReview } from "./McpServerDialogs";
import {
	McpConfigFileErrors,
	McpConfirmBanner,
	McpEmptyState,
	McpServerRowView,
} from "./McpSettings";
import { reviewMcpServer } from "./mcpEntries";
import { MCP_PRESETS } from "./mcpPresets";
import { mcpRowView } from "./mcpServerView";

function row(overrides: Partial<McpServerRow> = {}, summary: Partial<McpServerSummary> = {}) {
	const value: McpServerRow = {
		key: `${summary.scope ?? "user"}:fixture`,
		summary: {
			name: "fixture",
			scope: "user",
			source: "/home/.pi/agent/mcp.json",
			transport: "stdio",
			endpoint: "bun stdioServer.ts",
			exposure: "codemode",
			effectiveExposure: "deferred",
			enabled: true,
			oauth: false,
			...summary,
		},
		state: "connected",
		toolCount: 2,
		sessions: { total: 1, reporting: ["s1"], connected: 1 },
		startingStalled: false,
		approvalPending: false,
		attention: false,
		...overrides,
	};
	return value;
}

function render(value: McpServerRow, options: { readOnly?: boolean; error?: string } = {}) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<McpServerRowView
				row={value}
				view={mcpRowView(value, 0)}
				readOnly={options.readOnly ?? false}
				busy={false}
				error={options.error}
				onCommand={() => {}}
			/>
		</TooltipProvider>,
	);
}

test("a row shows the status, scope and transport chips, exposure, and an enable switch", () => {
	const html = render(row());
	expect(html).toContain('data-testid="mcp-server-row"');
	expect(html).toContain('data-state="connected"');
	expect(html).toMatch(/data-testid="mcp-server-status"[^>]*>Connected · 2 tools</);
	expect(html).toMatch(/data-testid="mcp-server-scope"[^>]*>User</);
	expect(html).toContain("runs on host, inherits the host environment");
	expect(html).toMatch(/data-testid="mcp-server-exposure"[^>]*data-exposure="deferred"/);
	expect(html).toMatch(/data-testid="mcp-server-exposure"[^>]*>Deferred</);
	expect(html).toMatch(/aria-checked="true"[^>]*data-testid="mcp-server-toggle"/);
	expect(html).toContain('aria-label="Disable fixture in this project"');
	expect(html).not.toContain('data-testid="mcp-server-action"');
});

test("a pending repository entry offers Review & approve and locks its switch and exposure", () => {
	const html = render(
		row(
			{ state: "pending-approval", toolCount: undefined, attention: true, approvalPending: true },
			{ scope: "project", approval: { state: "pending", fingerprint: "f" } },
		),
	);
	expect(html).toMatch(/data-testid="mcp-server-action"[^>]*data-action="review"/);
	expect(html).toContain("Review &amp; approve");
	expect(html).toMatch(/data-testid="mcp-server-exposure"[^>]*disabled=""/);
	expect(html).toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
	expect(html).toContain('data-attention="true"');
});

test("rows offer the status table's per-state actions: Reconnect and Show log, Reload now, Open a chat", () => {
	const actions = (html: string) =>
		[...html.matchAll(/data-testid="mcp-server-(action|secondary)" data-action="([a-z-]+)"/g)].map(
			([, slot, action]) => `${slot}:${action}`,
		);
	const failed = render(row({ state: "failed", toolCount: undefined, attention: true }));
	expect(actions(failed)).toEqual(["secondary:show-log", "action:reconnect"]);
	expect(failed).toContain("Show log");
	expect(failed).toContain("Reconnect");
	expect(actions(render(row({ state: "disconnected", toolCount: undefined })))).toEqual([
		"action:reconnect",
	]);
	const reload = render(row({ state: "pending-reload", toolCount: undefined }));
	expect(actions(reload)).toEqual(["action:reload"]);
	expect(reload).toContain("Reload now");
	const idle = { state: "not-running" as const, toolCount: undefined };
	expect(actions(render(row(idle)))).toEqual(["action:open-chat"]);
	const http = render(row(idle, { transport: "http" }));
	expect(actions(http)).toEqual(["secondary:test-connection", "action:open-chat"]);
	expect(http).toContain("Open a chat");
});

test("read-only rows disable every control and row errors render as alerts", () => {
	const html = render(row({ state: "not-running", toolCount: undefined }, { transport: "http" }), {
		readOnly: true,
		error: "MCP_CONFIG_INVALID: bad",
	});
	expect(html).toMatch(/data-testid="mcp-server-action"[^>]*disabled=""/);
	expect(html).toMatch(/data-testid="mcp-server-secondary"[^>]*disabled=""/);
	expect(html).toMatch(/data-testid="mcp-server-transport"[^>]*>HTTP</);
	expect(html).toContain('role="alert"');
	expect(html).toContain("MCP_CONFIG_INVALID: bad");
});

test("the banner states the per-chat confirm and the empty state offers import and the host notice", () => {
	expect(renderToStaticMarkup(<McpConfirmBanner />)).toContain(
		"ThinkRail asks before MCP calls that may change data (per chat); no saved rules yet.",
	);
	const empty = renderToStaticMarkup(
		<McpEmptyState disabled={false} onAdd={() => {}} onImport={() => {}} onPreset={() => {}} />,
	);
	expect(empty).toContain('data-testid="mcp-empty-import"');
	expect(empty).toContain("inherit its environment");
	expect(MCP_PRESETS.length).toBeGreaterThan(0);
	expect(empty).toContain('data-testid="mcp-empty-presets"');
});

test("file-level config problems render one error notice per file with its path and the edit hint", () => {
	expect(renderToStaticMarkup(<McpConfigFileErrors errors={[]} />)).toBe("");
	const html = renderToStaticMarkup(
		<McpConfigFileErrors
			errors={[
				{ source: "/home/u/.pi/agent/mcp.json", message: "JSON Parse error: Expected '}'" },
				{
					source: "/repo/.pi/mcp.json",
					message: 'expected an object with an "mcpServers" object',
				},
			]}
		/>,
	);
	expect(html.match(/data-testid="mcp-config-error"/g)).toHaveLength(2);
	expect(html).toContain('role="alert"');
	expect(html).toContain("Problem in /home/u/.pi/agent/mcp.json");
	expect(html).toContain('data-source="/repo/.pi/mcp.json"');
	expect(html).toContain("JSON Parse error: Expected &#x27;}&#x27;");
	expect(html.match(/Edit the file directly to fix it/g)).toHaveLength(2);
});

test("the run review lists each command and !command, and says when nothing runs", () => {
	const html = renderToStaticMarkup(
		<McpRunReview
			reviews={[
				reviewMcpServer("fixture", {
					command: "/usr/bin/bun",
					args: ["/abs/stdioServer.ts"],
					env: { TOKEN: "!gh auth token", API_KEY: `\${API_KEY}` },
				}),
				reviewMcpServer("docs", { url: "https://example.com/mcp" }),
			]}
			modifiesData="Sentry"
		/>,
	);
	expect(html.match(/data-testid="mcp-run-item"/g)).toHaveLength(2);
	expect(html).toContain("/usr/bin/bun /abs/stdioServer.ts");
	expect(html).toContain("gh auth token");
	expect(html).toContain("Nothing runs on this host.");
	expect(html).toContain("This server can modify data in Sentry.");
	expect(html).not.toContain("plain text");
	expect(html).toContain('data-testid="mcp-command-hint"');
	expect(html).toContain(
		"run on the host each time a chat connects; keep them fast (e.g. read a cached token).",
	);
	const commandOnly = renderToStaticMarkup(
		<McpRunReview reviews={[reviewMcpServer("fixture", { command: "bun", args: ["x.ts"] })]} />,
	);
	expect(commandOnly).not.toContain('data-testid="mcp-command-hint"');
});
