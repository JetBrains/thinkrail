import { expect, spyOn, test } from "bun:test";
import type { McpListResult, McpServerSummary } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LoginState } from "@/auth";
import { deriveMcpServerRows, type McpServerRow } from "@/store";
import * as transport from "@/transport";
import { McpRunReview } from "./McpServerDialogs";
import {
	approveMcpServer,
	McpConfigFileErrors,
	McpConfirmBanner,
	McpEmptyState,
	McpNoWorkspace,
	McpRowMenu,
	McpServerRowView,
	McpServersPanel,
	mcpLoginFor,
	userOps,
} from "./McpSettings";
import { reviewMcpServer } from "./mcpEntries";
import { MCP_PRESETS } from "./mcpPresets";
import { mcpRowView, mcpUserRowView } from "./mcpServerView";
import { userMcpProjection } from "./useUserMcpList";

function row(overrides: Partial<McpServerRow> = {}, summary: Partial<McpServerSummary> = {}) {
	const value: McpServerRow = {
		key: `${summary.scope ?? "user"}:fixture`,
		summary: {
			name: "fixture",
			scope: "user",
			source: "/home/.pi/agent/mcp.json",
			fingerprint: "rendered",
			transport: "stdio",
			endpoint: "bun stdioServer.ts",
			exposure: "codemode",
			effectiveExposure: "deferred",
			enabled: true,
			oauth: false,
			...summary,
		},
		state: "connected",
		effective: true,
		toolCount: 2,
		sessions: { total: 1, reporting: ["s1"], connected: 1 },
		startingStalled: false,
		approvalPending: false,
		attention: false,
		...overrides,
	};
	return value;
}

function uncounted({ toolCount: _toolCount, ...value }: McpServerRow): McpServerRow {
	return value;
}

function render(value: McpServerRow, options: { readOnly?: boolean; error?: string } = {}) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<McpServerRowView
				row={value}
				view={mcpRowView(currentTranslator(), value, 0)}
				readOnly={options.readOnly ?? false}
				busy={false}
				error={options.error}
				onCommand={() => {}}
			/>
		</TooltipProvider>,
	);
}

test("a row is a list row: Details as its primary, then transport and exposure chips, status and a switch", () => {
	const html = render(row());
	expect(html).toContain('data-testid="mcp-server-row"');
	expect(html).toContain('data-focus-row="user:fixture"');
	expect(html).toContain('data-state="connected"');
	expect(html).toMatch(/<button[^>]*data-setting-primary=""[^>]*data-testid="mcp-server-details"/);
	expect(html).toMatch(/data-testid="mcp-server-status"[^>]*>Connected · 2 tools</);
	expect(html).not.toContain('data-testid="mcp-server-scope"');
	expect(html).toContain("runs on host, inherits the host environment");
	expect(html).toMatch(/data-testid="mcp-server-exposure"[^>]*data-exposure="deferred"/);
	expect(html).toMatch(/data-testid="mcp-server-exposure"[^>]*>Deferred</);
	expect(html).toMatch(/aria-checked="true"[^>]*data-testid="mcp-server-toggle"/);
	expect(html).toMatch(/<li[^>]*data-setting-row="user:fixture"[^>]*tabindex="-1"/);
	expect(html).toMatch(/tabindex="-1"[^>]*data-testid="mcp-server-toggle"/);
	expect(html.match(/<button[^>]*data-testid="mcp-server-menu"[^>]*>/)?.[0]).toContain(
		'tabindex="-1"',
	);
	expect(html).toContain('aria-label="Disable fixture in this project"');
	expect(html).not.toContain('data-testid="mcp-server-action"');
	expect(html).not.toContain("truncate");
	expect(html).not.toContain("title=");
});

test("a pending repository entry offers Review & approve and locks its switch and exposure", () => {
	const pending = uncounted(
		row(
			{ state: "pending-approval", attention: true, approvalPending: true },
			{ scope: "project", approval: { state: "pending", fingerprint: "f" } },
		),
	);
	const html = render(pending);
	expect(html).toMatch(/data-testid="mcp-server-action"[^>]*data-action="review"/);
	expect(html).toContain("Review &amp; approve");
	expect(html).toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
	expect(html).toContain('data-attention="true"');
	expect(menuProps(pending)["mcp-menu-exposure"]?.disabled).toBe(true);
	expect(menuProps(row())["mcp-menu-exposure"]?.disabled).toBe(false);
});

test("rows offer the status table's per-state actions: Reconnect and Show log, Reload now, Open a chat", () => {
	const actions = (html: string) =>
		[...html.matchAll(/data-testid="mcp-server-(action|secondary)" data-action="([a-z-]+)"/g)].map(
			([, slot, action]) => `${slot}:${action}`,
		);
	const failed = render(uncounted(row({ state: "failed", attention: true })));
	expect(actions(failed)).toEqual(["secondary:show-log", "action:reconnect"]);
	expect(failed).toContain("Show log");
	expect(failed).toContain("Reconnect");
	expect(actions(render(uncounted(row({ state: "disconnected" }))))).toEqual(["action:reconnect"]);
	const reload = render(uncounted(row({ state: "pending-reload" })));
	expect(actions(reload)).toEqual(["action:reload"]);
	expect(reload).toContain("Reload now");
	const idle = { state: "not-running" as const };
	expect(actions(render(uncounted(row(idle))))).toEqual(["action:open-chat"]);
	const http = render(uncounted(row(idle, { transport: "http" })));
	expect(actions(http)).toEqual(["secondary:test-connection", "action:open-chat"]);
	expect(http).toContain("Open a chat");
});

type MenuProps = { children?: ReactNode; disabled?: boolean; "data-testid"?: string };

function menuProps(value: McpServerRow, inProject = true): Record<string, MenuProps> {
	const items: Record<string, MenuProps> = {};
	const order: string[] = [];
	const visit = (node: ReactNode) => {
		Children.forEach(node, (child) => {
			if (isValidElement<Parameters<typeof McpRowMenu>[0]>(child) && child.type === McpRowMenu) {
				visit(McpRowMenu(child.props));
				return;
			}
			if (!isValidElement<MenuProps>(child)) return;
			const id = child.props["data-testid"];
			if (id?.startsWith("mcp-menu-")) {
				items[id] = child.props;
				order.push(id);
			}
			visit(child.props.children);
		});
	};
	let tree: ReactNode = null;
	const Capture = () => {
		tree = McpServerRowView({
			row: value,
			view: mcpRowView(currentTranslator(), value, 0),
			inProject,
			readOnly: false,
			busy: false,
			error: undefined,
			onCommand: () => {},
		});
		visit(tree);
		return null;
	};
	renderToStaticMarkup(<Capture />);
	return Object.fromEntries(order.map((id) => [id, items[id] ?? {}]));
}

function menuItems(value: McpServerRow, inProject = true): string[] {
	return Object.keys(menuProps(value, inProject));
}

test("runtime menus follow row authority while scope-specific review, edit and remove remain", () => {
	for (const admission of ["user", "project", "legacy"] as const) {
		const user = row(
			{},
			{
				transport: "http",
				endpoint: "https://user.example/mcp",
				oauth: true,
				...(admission !== "legacy" ? { effective: admission === "user" } : {}),
			},
		).summary;
		const project = {
			...user,
			scope: "project" as const,
			endpoint: "https://repo.example/mcp",
			approval: {
				state: admission === "project" ? ("approved" as const) : ("pending" as const),
				fingerprint: "f",
			},
			...(admission !== "legacy" ? { effective: admission === "project" } : {}),
		};
		const rows = deriveMcpServerRows(
			{
				servers: [user, project],
				configErrors: [],
				handledElsewhere: null,
				sessions: {},
			},
			0,
		);
		for (const value of rows) {
			const items = menuItems(value);
			for (const id of ["sign-in", "sign-out", "test-connection"]) {
				expect(items.includes(`mcp-menu-${id}`)).toBe(value.summary.scope === admission);
			}
			expect(items).toContain("mcp-menu-remove");
			expect(items).toContain(
				value.state === "pending-approval" ? "mcp-menu-review" : "mcp-menu-edit",
			);
			if (!value.effective) expect(render(value)).not.toContain('data-action="test-connection"');
		}
	}
});

test("an effective user server keeps runtime menus despite an invalid folded override", () => {
	const [value] = deriveMcpServerRows(
		{
			servers: [
				row(
					{},
					{
						effective: true,
						transport: "http",
						oauth: true,
						configError: "Invalid repository override",
						approval: { state: "approved", fingerprint: "f" },
					},
				).summary,
			],
			configErrors: [],
			handledElsewhere: null,
			sessions: {},
		},
		0,
	);
	if (!value) throw new Error("Missing user row");
	expect(menuItems(value)).toEqual([
		"mcp-menu-details",
		"mcp-menu-exposure",
		"mcp-menu-sign-in",
		"mcp-menu-sign-out",
		"mcp-menu-test-connection",
		"mcp-menu-show-log",
		"mcp-menu-edit",
		"mcp-menu-remove",
	]);
});

test("a stale approval refreshes the summary without approving changed content under the old confirmation", async () => {
	const original = row(
		{},
		{
			scope: "project",
			approval: { state: "pending", fingerprint: "old" },
		},
	).summary;
	const changed: McpServerSummary = {
		...original,
		endpoint: "bun changed.ts",
		approval: { state: "changed", fingerprint: "new" },
	};
	const refreshed: McpListResult = { servers: [changed], statuses: [] };
	let cached = original;
	const request = spyOn(transport, "requestMcpList").mockImplementation(async (method, params) => {
		if (method === "mcp.list") {
			cached = changed;
			return refreshed;
		}
		if (method === "mcp.approve" && "fingerprint" in params && params.fingerprint === "new") {
			return refreshed;
		}
		throw new Error("The repository entry changed — review it again.");
	});
	try {
		const openReview = { summary: cached };
		await expect(approveMcpServer("ws", openReview.summary)).rejects.toThrow("review it again");
		expect(request.mock.calls).toEqual([
			["mcp.approve", { workspaceId: "ws", name: "fixture", fingerprint: "old" }],
			["mcp.list", { workspaceId: "ws" }],
		]);
		expect(cached).toBe(changed);
		expect(openReview.summary.approval?.fingerprint).toBe("old");
		await expect(approveMcpServer("ws", openReview.summary)).rejects.toThrow("review it again");
		expect(request.mock.calls[2]).toEqual([
			"mcp.approve",
			{ workspaceId: "ws", name: "fixture", fingerprint: "old" },
		]);
		const reopened = { summary: cached };
		await expect(approveMcpServer("ws", reopened.summary)).resolves.toBe(refreshed);
		expect(request.mock.calls[4]).toEqual([
			"mcp.approve",
			{ workspaceId: "ws", name: "fixture", fingerprint: "new" },
		]);
		expect(request).toHaveBeenCalledTimes(5);
	} finally {
		request.mockRestore();
	}
});

test("read-only rows disable every control and row errors render as alerts", () => {
	const html = render(uncounted(row({ state: "not-running" }, { transport: "http" })), {
		readOnly: true,
		error: "MCP_CONFIG_INVALID: bad",
	});
	expect(html).toMatch(/data-testid="mcp-server-action"[^>]*disabled=""/);
	expect(html).toMatch(/data-testid="mcp-server-secondary"[^>]*disabled=""/);
	expect(html).toMatch(/data-testid="mcp-server-transport"[^>]*>HTTP</);
	expect(html).toContain('role="alert"');
	expect(html).toContain("MCP_CONFIG_INVALID: bad");
});

test("a row lists its always-allowed tools, each with its own way to ask again", () => {
	const html = render(
		row(
			{},
			{
				alwaysAllowed: [
					{ tool: "mcp__fixture__create_issue", label: "create_issue" },
					{ tool: "mcp__fixture__comment", label: "comment" },
				],
			},
		),
	);
	expect(html).toContain('data-testid="mcp-always-allowed"');
	expect(html.match(/data-testid="mcp-always-allowed-tool"/g)).toHaveLength(2);
	expect(html).toContain('aria-label="Ask again before create_issue in this project"');
	expect(render(row())).not.toContain("mcp-always-allowed");
	expect(
		render(row({}, { alwaysAllowed: [{ tool: "t", label: "t" }] }), { readOnly: true }),
	).toMatch(/data-testid="mcp-always-allowed-revoke"[^>]*disabled=""/);
});

test("the notice states the host and, in a project, the in-chat confirm; the empty state offers presets and import", () => {
	const banner = renderToStaticMarkup(<McpConfirmBanner />);
	expect(banner).toContain("inherit its environment");
	expect(banner).toContain(
		"ThinkRail asks in the chat before MCP calls that may change data. Always allow trusts a tool in every chat of this project; those tools are listed on their server below.",
	);
	expect(banner).toContain('data-variant="info"');
	const userBanner = renderToStaticMarkup(<McpConfirmBanner inProject={false} />);
	expect(userBanner).toContain("inherit its environment");
	expect(userBanner).not.toContain("mcp-confirm-text");
	const empty = renderToStaticMarkup(
		<McpEmptyState
			disabled={false}
			focusList="mcp:user"
			settingId="mcp-add"
			onAdd={() => {}}
			onImport={() => {}}
			onPreset={() => {}}
		/>,
	);
	expect(empty).toContain('data-testid="mcp-empty-import"');
	expect(empty).toMatch(/data-testid="mcp-empty-add"[^>]*data-focus-fallback="mcp:user"/);
	expect(empty).toContain('data-setting-row="mcp-add/add"');
	expect(empty.match(/data-setting-row="mcp-add\/preset\//g)).toHaveLength(MCP_PRESETS.length);
	expect(empty).toContain('data-setting-id="mcp-add"');
	expect(MCP_PRESETS.length).toBeGreaterThan(0);
	expect(empty).toContain('data-testid="mcp-empty-presets"');
	expect(empty).toContain("Enabled for this project only.");
	const userEmpty = renderToStaticMarkup(
		<McpEmptyState
			disabled={false}
			userOnly
			onAdd={() => {}}
			onImport={() => {}}
			onPreset={() => {}}
		/>,
	);
	expect(userEmpty).not.toContain("this project");
	expect(userEmpty).toContain("Added switched off");
});

test("an older host without a workspace keeps the open-a-workspace text", () => {
	const html = renderToStaticMarkup(<McpNoWorkspace />);
	expect(html).toContain('data-testid="settings-mcp"');
	expect(html).toMatch(
		/data-testid="mcp-no-workspace"[^>]*>Open a workspace to manage its MCP servers\.</,
	);
	expect(html).not.toContain("mcp-user-servers");
});

const userSummary = (overrides: Partial<McpServerSummary> = {}): McpServerSummary => ({
	...row().summary,
	transport: "http",
	endpoint: "https://docs.example/mcp",
	...overrides,
});

function renderPanel(
	servers: McpServerSummary[],
	options: { workspace?: boolean; trusted?: boolean } = {},
) {
	const workspace = options.workspace
		? {
				id: "ws-panel",
				projectId: "p-panel",
				name: "main",
				branch: "main",
				worktreePath: "/tmp/panel",
				baseBranch: "main",
			}
		: null;
	return renderToStaticMarkup(
		<TooltipProvider>
			<McpServersPanel
				ops={userOps((work) => work())}
				workspace={workspace}
				projectName={undefined}
				trusted={options.trusted ?? false}
				projection={userMcpProjection({ servers, statuses: [] })}
				readFailure={null}
				onRetry={() => {}}
			/>
		</TooltipProvider>,
	);
}

test("with no workspace the page lists only the user servers, configuration only, then the project-servers line", () => {
	const html = renderPanel([userSummary(), userSummary({ name: "linear", oauth: true })]);
	expect(html).toMatch(/data-testid="mcp-user-servers"[\s\S]*data-scope="allProjects"/);
	expect(html).not.toContain('data-testid="mcp-project-servers"');
	expect(html).toMatch(
		/data-testid="mcp-project-servers-hint"[^>]*>Project servers appear when a workspace is open\.</,
	);
	expect(html).toContain('data-focus-list="mcp:user"');
	expect(html).toContain('data-setting-id="mcp-user-servers"');
	expect(html).toContain("With no workspace open, they go to your user servers.");
	expect(html).not.toContain("mcp-confirm-text");
	expect(html.match(/data-testid="mcp-server-status"[^>]*>On</g)).toHaveLength(2);
	expect(html).toContain('aria-label="Disable fixture"');
	expect(html).not.toContain("in this project");
	expect(html).not.toContain('data-action="open-chat"');
	expect(html).toMatch(/data-name="fixture"[\s\S]*?data-action="test-connection"/);
	expect(html).toMatch(/data-name="linear"[\s\S]*?data-action="sign-in"/);
	expect(html).toContain('data-action="show-log"');
});

test("an empty user list without a workspace offers presets, Add and Import under the user group", () => {
	const html = renderPanel([]);
	expect(html).toMatch(/data-testid="mcp-user-servers"[\s\S]*data-testid="mcp-empty"/);
	expect(html).not.toContain('data-testid="mcp-add"');
	expect(html).toContain('data-testid="mcp-project-servers-hint"');
});

test("inside a trusted workspace the page has the user and the project group, each its own list", () => {
	const html = renderPanel(
		[
			userSummary(),
			userSummary({
				name: "repo",
				scope: "project",
				approval: { state: "approved", fingerprint: "f" },
			}),
		],
		{ workspace: true, trusted: true },
	);
	const user = html.slice(
		html.indexOf('data-testid="mcp-user-servers"'),
		html.indexOf('data-testid="mcp-project-servers"'),
	);
	const project = html.slice(html.indexOf('data-testid="mcp-project-servers"'));
	expect(user).toContain('data-scope="allProjects"');
	expect(user).toContain('data-focus-list="mcp:user"');
	expect(user).toContain('data-name="fixture"');
	expect(user).not.toContain('data-name="repo"');
	expect(project).toContain('data-scope="project"');
	expect(project).toContain('data-focus-list="mcp:project"');
	expect(project).toContain('data-name="repo"');
	expect(html).toContain('data-testid="mcp-confirm-text"');
	expect(html).not.toContain("mcp-project-servers-hint");
	expect(html).toMatch(/data-testid="mcp-add"[^>]*data-focus-fallback="mcp:project"/);
});

test("an untrusted workspace says why its project group lists nothing", () => {
	const html = renderPanel([userSummary()], { workspace: true, trusted: false });
	expect(html).toMatch(/data-testid="mcp-project-servers"[\s\S]*data-testid="mcp-untrusted"/);
	expect(renderPanel([userSummary()], { workspace: true, trusted: true })).toContain(
		'data-testid="mcp-project-empty"',
	);
});

test("without a workspace Remove, the switch and exposure write the user entry by its rendered fingerprint", async () => {
	const summary = userSummary({ fingerprint: "fp-1" });
	const result = { servers: [], statuses: [] };
	const request = spyOn(transport, "requestUserMcpList").mockImplementation(async () => result);
	const writes: string[] = [];
	const ops = userOps((work) => {
		writes.push("write");
		return work();
	});
	const [value] = deriveMcpServerRows(userMcpProjection({ servers: [summary], statuses: [] }), 0);
	if (!value) throw new Error("Missing user row");
	try {
		await ops.remove(summary);
		await ops.setting(value, { enabled: false });
		await ops.setting(value, { exposure: "direct" });
		await ops.add("user", "docs", { url: "https://docs.example/mcp" });
		expect(request.mock.calls).toEqual([
			["mcp.remove", { scope: "user", name: "fixture", expectedFingerprint: "fp-1" }],
			["mcp.setUserServer", { name: "fixture", expectedFingerprint: "fp-1", enabled: false }],
			["mcp.setUserServer", { name: "fixture", expectedFingerprint: "fp-1", exposure: "direct" }],
			["mcp.add", { scope: "user", name: "docs", entry: { url: "https://docs.example/mcp" } }],
		]);
		expect(writes).toHaveLength(4);
		expect(ops.feedback(result)).toContain("pi CLI");
	} finally {
		request.mockRestore();
	}
});

test("the user list's row menu offers Remove and a no-workspace switch never mentions the project", () => {
	const [value] = deriveMcpServerRows(
		userMcpProjection({ servers: [userSummary({ oauth: true, enabled: false })], statuses: [] }),
		0,
	);
	if (!value) throw new Error("Missing user row");
	const items = menuItems(value, false);
	expect(items).toContain("mcp-menu-remove");
	expect(items).toContain("mcp-menu-sign-in");
	expect(items).toContain("mcp-menu-show-log");
	expect(items).not.toContain("mcp-menu-share");
	const view = mcpUserRowView(currentTranslator(), value, 0);
	expect(view.reason).toBe("Turned off.");
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<McpServerRowView
				row={value}
				view={view}
				inProject={false}
				readOnly={false}
				busy={false}
				error={undefined}
				onCommand={() => {}}
			/>
		</TooltipProvider>,
	);
	expect(html).toContain('aria-label="Enable fixture"');
});

test("the sign-in dialog shows a login started with no workspace only on the no-workspace page", () => {
	const login = (workspaceId?: string): LoginState => ({
		loginId: "l",
		providerId: "mcp:docs",
		status: "active",
		target: { kind: "mcp", serverName: "docs", ...(workspaceId ? { workspaceId } : {}) },
	});
	expect(mcpLoginFor(login(), undefined)).toEqual(login());
	expect(mcpLoginFor(login(), "ws")).toBeNull();
	expect(mcpLoginFor(login("ws"), "ws")).toEqual(login("ws"));
	expect(mcpLoginFor(login("ws"), undefined)).toBeNull();
	expect(
		mcpLoginFor({ loginId: "p", providerId: "anthropic", status: "active" }, undefined),
	).toBeNull();
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
