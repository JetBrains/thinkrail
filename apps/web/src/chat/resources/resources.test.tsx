import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type {
	BackgroundCommandSummary,
	McpServerResourceSummary,
	SubagentResourceSummary,
} from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as resources from "./index";
import { mcpRowActions } from "./mcpRow";
import { elapsedLabel, formatElapsed, resourceState, sortLive } from "./resourceRow";

const NOW = 10 * 60_000;
const command: BackgroundCommandSummary = {
	id: "build",
	sessionId: "chat",
	name: "Build <script>",
	command: "echo '<img src=x onerror=bad()>'",
	status: "running",
	startedAt: NOW - 4 * 60_000,
};
const child: SubagentResourceSummary = {
	childSessionId: "child",
	parentSessionId: "chat",
	roleName: "scout",
	task: "<b>Inspect</b> the registry",
	status: "queued",
	createdAt: new Date(NOW - 30_000).toISOString(),
};
const inspectorProps: ComponentProps<typeof resources.ResourcesInspector> = {
	open: true,
	onOpenChange: () => {},
	commands: [],
	subagents: [],
	finishedCommands: [],
	finishedSubagents: [],
	now: NOW,
	authoritative: true,
	loading: false,
	stale: false,
	error: null,
	actions: {},
	selectedId: null,
	onSelect: () => {},
	onRetry: () => {},
	onStopCommand: () => {},
	onStopSubagent: () => {},
	onStopAll: () => {},
	detail: <div data-testid="detail-slot">slot</div>,
};
const dockProps: ComponentProps<typeof resources.ResourcesDock> = {
	commands: [],
	subagents: [],
	now: NOW,
	authoritative: true,
	actions: {},
	onInspect: () => {},
	onStopCommand: () => {},
	onStopSubagent: () => {},
};

test("resource primitives keep their props-only import boundary", () => {
	for (const file of readdirSync(import.meta.dir).filter(
		(file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."),
	)) {
		const source = readFileSync(`${import.meta.dir}/${file}`, "utf8");
		for (const [, dependency] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
			expect(dependency).toMatch(
				/^(?:@thinkrail\/contracts|react|@remixicon\/react|@thinkrail\/ui\/|@\/lib$|\.\/)/,
			);
		}
		expect(source).not.toMatch(
			/(?<![.\w])(?:store|transport)\b|xterm|dangerouslySetInnerHTML|Markdown/,
		);
	}
});

test("the row vocabulary collapses wire statuses into one live and three settled states, sorts live rows oldest-first and reports run time per kind", () => {
	const state = (overrides: Partial<BackgroundCommandSummary>) =>
		resourceState({ kind: "command", summary: { ...command, ...overrides } });
	expect(state({})).toBe("working");
	expect(state({ status: "stopping" })).toBe("stopping");
	expect(state({ status: "completed", exitCode: 0 })).toBe("done");
	expect(state({ status: "completed", exitCode: 2 })).toBe("failed");
	expect(state({ status: "error", exitCode: 1 })).toBe("failed");
	expect(state({ status: "stopped", exitCode: 130 })).toBe("stopped");
	const childState = (status: SubagentResourceSummary["status"]) =>
		resourceState({ kind: "subagent", summary: { ...child, status } });
	expect(childState("queued")).toBe("queued");
	expect(childState("running")).toBe("working");
	expect(childState("completed")).toBe("done");
	expect(childState("error")).toBe("failed");
	expect(childState("aborted")).toBe("stopped");
	expect(formatElapsed(20_000)).toBe("<1 min");
	expect(formatElapsed(4 * 60_000 + 5_000)).toBe("4 min");
	expect(formatElapsed(125 * 60_000)).toBe("2 h 5 min");
	const elapsed = (resource: Parameters<typeof elapsedLabel>[0]) => elapsedLabel(resource, NOW);
	expect(elapsed({ kind: "command", summary: command })).toBe("4 min");
	expect(
		elapsed({
			kind: "command",
			summary: { ...command, status: "completed", exitCode: 0, finishedAt: NOW - 60_000 },
		}),
	).toBe("3 min");
	expect(elapsed({ kind: "subagent", summary: child })).toBeNull();
	expect(elapsed({ kind: "subagent", summary: { ...child, status: "running" } })).toBe("<1 min");
	expect(
		elapsed({
			kind: "subagent",
			summary: { ...child, status: "completed", durationMs: 7 * 60_000 },
		}),
	).toBe("7 min");
	expect(elapsed({ kind: "subagent", summary: { ...child, status: "aborted" } })).toBeNull();
	const order = sortLive([
		{ kind: "subagent", summary: child },
		{ kind: "command", summary: { ...command, id: "late", startedAt: NOW - 1000 } },
		{
			kind: "command",
			summary: { ...command, id: "stopping", status: "stopping", startedAt: NOW - 3 * 60_000 },
		},
		{ kind: "command", summary: command },
	]).map((resource) => (resource.kind === "command" ? resource.summary.id : "child"));
	expect(order).toEqual(["build", "stopping", "child", "late"]);
});

test("resource trigger distinguishes an authoritative count from an unknown count and breathes only while live", () => {
	const render = (activeCount: number | null, open = false) =>
		renderToStaticMarkup(
			<TooltipProvider>
				<resources.ResourcesButton activeCount={activeCount} open={open} />
			</TooltipProvider>,
		);
	const current = render(3, true);
	expect(current).toContain('data-active-count="3"');
	expect(current).toContain('aria-label="Resources, 3 active"');
	expect(current).toContain('aria-expanded="true"');
	expect(current).toContain('data-live="true"');
	expect(current).toContain("animate-working");
	expect(current).toContain(">3</span>");

	const idle = render(0);
	expect(idle).not.toContain("data-live");
	expect(idle).not.toContain("animate-working");

	const unknown = render(null);
	expect(unknown).toContain('data-active-count="unknown"');
	expect(unknown).toContain('aria-label="Resources, active count unavailable"');
	expect(unknown).toContain(">—</span>");
	expect(unknown).not.toContain("null active");
	expect(unknown).not.toContain("animate-working");
});

test("ChatView mounts the trigger, dock and inspector and retires resource-only layers", () => {
	const source = readFileSync(`${import.meta.dir}/../ChatView.tsx`, "utf8");
	expect(source).toContain("<ResourcesDock");
	expect(source).toContain("<ResourcesInspector");
	expect(source).toContain("if (!resources.knownUnsupported) return;");
	expect(source).toContain("resources.visible && !inspectorOpen ? (");
});

test("the dock lists live rows oldest-first with escaped text, one inspect control and stop, and collapses past four", () => {
	const empty = renderToStaticMarkup(<resources.ResourcesDock {...dockProps} />);
	expect(empty).toBe("");

	const html = renderToStaticMarkup(
		<resources.ResourcesDock
			{...dockProps}
			commands={[
				{ ...command, id: "stopping", status: "stopping", startedAt: NOW - 6 * 60_000 },
				command,
			]}
			subagents={[child]}
		/>,
	);
	expect(html).toContain('data-testid="resources-dock"');
	expect(html).not.toContain("data-collapsed");
	expect(html.indexOf('data-resource-id="stopping"')).toBeLessThan(
		html.indexOf('data-resource-id="build"'),
	);
	expect(html.indexOf('data-resource-id="build"')).toBeLessThan(
		html.indexOf('data-resource-id="child"'),
	);
	expect(html).toMatch(
		/data-testid="resource-inspect"[^>]*>[\s\S]*?Build &lt;script&gt;[\s\S]*?echo/,
	);
	expect(html).toContain('data-status="running"');
	expect(html).toContain('data-state="working"');
	expect(html).toContain("4 min");
	expect(html).toContain('data-testid="resource-inspect"');
	expect(html).toMatch(/data-testid="resource-stop"[^>]*disabled/);
	expect(html).toContain("3 active");
	expect(html).not.toContain("<img");
	expect(html).not.toContain("<b>");
	expect(html).toContain("&lt;script&gt;");

	const many = renderToStaticMarkup(
		<resources.ResourcesDock
			{...dockProps}
			commands={[1, 2, 3, 4, 5].map((n) => ({ ...command, id: `c${n}` }))}
		/>,
	);
	expect(many).toContain('data-collapsed="true"');
	expect(many).not.toContain('data-resource-id="c1"');
	expect(many).toContain("5 active");
	expect(many).toContain('aria-expanded="false"');

	const stale = renderToStaticMarkup(
		<resources.ResourcesDock {...dockProps} commands={[command]} authoritative={false} />,
	);
	expect(stale).toMatch(/data-testid="resource-stop"[^>]*disabled/);
	expect(stale).toContain("reconnecting");
});

test("the inspector renders a listbox of options whose accessible names carry the activity, selects the first live row, and keeps Stop beside the option", () => {
	const html = renderToStaticMarkup(
		<resources.ResourcesInspector
			{...inspectorProps}
			commands={[command]}
			subagents={[child]}
			finishedCommands={[
				{ ...command, id: "finished", status: "completed", finishedAt: NOW - 60_000, exitCode: 1 },
			]}
			finishedSubagents={[{ ...child, status: "aborted", abortReason: "Stopped by user" }]}
		/>,
	);
	expect(html).toContain('data-testid="resources-inspector"');
	expect(html).toContain('role="listbox"');
	expect(html).toContain('data-testid="resources-active"');
	expect(html).toContain('data-testid="resources-finished"');
	expect(html).toMatch(/data-resource-id="build"[^>]*data-selected="true"/);
	expect(html).not.toMatch(/data-resource-id="child"[^>]*data-selected="true"/);
	expect(html).toContain('aria-selected="true"');
	expect(html).toContain(
		'aria-label="Build &lt;script&gt;: echo &#x27;&lt;img src=x onerror=bad()&gt;&#x27;, Running"',
	);
	expect(html).toContain('aria-label="scout: &lt;b&gt;Inspect&lt;/b&gt; the registry, Queued"');
	expect(html.match(/&lt;b&gt;Inspect&lt;\/b&gt; the registry/g)?.length).toBeGreaterThanOrEqual(2);
	const options = html.match(/<div role="option"[^>]*>(?:(?!<\/div>)[\s\S])*<\/div>/g) ?? [];
	expect(options.length).toBe(4);
	for (const option of options) expect(option).not.toContain("resource-stop");
	expect(html.match(/data-testid="resource-stop"/g)?.length).toBe(2);
	expect(html).toContain('data-testid="resource-detail-stop"');
	expect(html).toContain('data-testid="detail-slot"');
	expect(html).toContain('aria-label="Stop all subagents"');
	expect(html).toContain("exit 1");
	expect(html).toContain('data-state="failed"');
	expect(html).toContain('data-state="stopped"');
	expect(html).toContain("2 active");
	expect(html).not.toContain("<img");
	expect(html).not.toContain("<b>");
});

test("the inspector keeps the selected finished row, disables controls when stale, and surfaces failures with retry", () => {
	const html = renderToStaticMarkup(
		<resources.ResourcesInspector
			{...inspectorProps}
			commands={[command]}
			finishedCommands={[{ ...command, id: "done", status: "completed", exitCode: 0 }]}
			selectedId="done"
			authoritative={false}
			stale
			error="Read failed"
			actions={{ "command:build": { pending: false, error: "Stop failed" } }}
		/>,
	);
	expect(html).toMatch(/data-resource-id="done"[^>]*data-selected="true"/);
	expect(html).toContain("Snapshot is stale");
	expect(html).toContain("reconnecting");
	expect(html).toMatch(/data-testid="resource-stop"[^>]*disabled/);
	expect(html).not.toContain('data-testid="resource-detail-stop"');
	expect(html).toContain("Stop failed");
	expect(html).toContain("Read failed");
	expect(html).toContain('role="alert"');
	expect(html).toContain('data-testid="resources-retry"');
	expect(html).not.toContain('data-testid="resources-stop-all"');
	expect(html).toContain("Done");
});

test("command logs distinguish loading, empty, retry, permanent unavailability, stale and truncated plain text", () => {
	const log = (overrides: Partial<ComponentProps<typeof resources.CommandLogView>>) =>
		renderToStaticMarkup(
			<resources.CommandLogView
				result={null}
				error={null}
				stale={false}
				onRetry={() => {}}
				{...overrides}
			/>,
		);
	expect(log({})).toContain("Loading logs…");
	expect(log({ result: { available: false } })).toContain('data-testid="command-log-unavailable"');
	expect(log({ error: "Try again", stale: true })).toContain('role="alert"');
	expect(log({ error: "Try again" })).toContain('data-testid="resources-retry"');
	expect(log({ stale: true })).toContain("Logs are stale.");
	expect(
		log({ result: { available: true, command, output: { text: "", truncated: false } } }),
	).toContain("No output yet.");
	const html = log({
		result: {
			available: true,
			command,
			output: { text: "<script>bad()</script>\n**not markdown**\u001b[31m", truncated: true },
		},
	});
	expect(html).toContain("Output truncated");
	expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
	expect(html).toContain("**not markdown**");
	expect(html).not.toContain("<script>");
	expect(html).not.toContain("<strong>");
});

test("the trigger counts connected MCP servers without breathing, and the attention marker names what needs the user", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<resources.ResourcesButton activeCount={2} open={false} working={false} />
			<resources.ResourcesAttention count={2} onOpen={() => {}} />
		</TooltipProvider>,
	);
	expect(html).toContain('data-active-count="2"');
	expect(html).not.toContain("data-live");
	expect(html).not.toContain("animate-working");
	expect(html).toContain('data-testid="resources-mcp-attention"');
	expect(html).toContain('aria-label="2 MCP servers need attention — open MCP settings"');
	expect(
		renderToStaticMarkup(
			<TooltipProvider>
				<resources.ResourcesButton activeCount={3} open={false} working />
			</TooltipProvider>,
		),
	).toContain('data-live="true"');
});

test("MCP rows offer per-chat actions by state: disable, enable, reconnect, and Settings for sign-in or approval", () => {
	const actions = (state: McpServerResourceSummary["state"]) =>
		mcpRowActions({ name: "docs", state, transport: "stdio" }).map((action) => action.id);
	expect(actions("connected")).toEqual(["disable"]);
	expect(actions("starting")).toEqual(["disable"]);
	expect(actions("disabled-in-chat")).toEqual(["enable"]);
	expect(actions("failed")).toEqual(["reconnect", "disable"]);
	expect(actions("disconnected")).toEqual(["reconnect", "disable"]);
	expect(actions("needs-sign-in")).toEqual(["settings", "disable"]);
	expect(actions("pending-approval")).toEqual(["settings"]);
	expect(actions("pending-reload")).toEqual([]);
	expect(actions("disabled-in-project")).toEqual([]);
	const registered = (state: McpServerResourceSummary["state"]) =>
		mcpRowActions({ name: "ext", state, transport: "http", registered: true }).map(
			(action) => action.id,
		);
	expect(registered("connected")).toEqual([]);
	expect(registered("failed")).toEqual(["reconnect"]);
	expect(registered("needs-sign-in")).toEqual(["settings"]);
});

test("the inspector lists the chat's MCP servers as a third section and hides it for older hosts", () => {
	const mcpServers: McpServerResourceSummary[] = [
		{ name: "linear", state: "needs-sign-in", transport: "http" },
		{ name: "fixture", state: "connected", toolCount: 2, transport: "stdio" },
		{ name: "quiet", state: "disabled-in-chat", transport: "stdio" },
	];
	const html = renderToStaticMarkup(
		<resources.ResourcesInspector
			{...inspectorProps}
			mcpServers={mcpServers}
			actions={{ "mcp:fixture": { pending: false, error: "Disable failed" } }}
		/>,
	);
	expect(html).toContain('data-testid="resources-mcp"');
	expect(html.match(/data-testid="resource-mcp"/g)).toHaveLength(3);
	expect(html).toMatch(/data-testid="resource-mcp-state"[^>]*>Connected · 2 tools</);
	expect(html).toMatch(/data-name="quiet" data-state="disabled-in-chat"/);
	expect(html).toContain('data-testid="resource-mcp-enable"');
	expect(html).toContain("Disable in this chat");
	expect(html).toContain("Disabling applies when the chat is idle — restarts this chat");
	expect(html).toContain("Disable failed");
	expect(html).toContain('data-testid="resources-mcp-settings"');
	expect(html).toContain("stdio · runs on host");
	const stale = renderToStaticMarkup(
		<resources.ResourcesInspector
			{...inspectorProps}
			mcpServers={mcpServers}
			authoritative={false}
		/>,
	);
	expect(stale).toMatch(/data-testid="resource-mcp-disable"[^>]*disabled=""/);
	const empty = renderToStaticMarkup(
		<resources.ResourcesInspector {...inspectorProps} mcpServers={[]} />,
	);
	expect(empty).toContain("No MCP servers in this chat.");
	expect(renderToStaticMarkup(<resources.ResourcesInspector {...inspectorProps} />)).not.toContain(
		'data-testid="resources-mcp"',
	);
});
