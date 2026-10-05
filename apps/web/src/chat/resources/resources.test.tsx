import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as resources from "./index";
import { formatElapsed, resourceState, sortLive } from "./resourceRow";

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
				/^(?:@thinkrail\/contracts|react|@remixicon\/react|@\/components\/ui\/|@\/lib$|\.\/)/,
			);
		}
		expect(source).not.toMatch(/store|transport|xterm|dangerouslySetInnerHTML|Markdown/);
	}
});

test("the row vocabulary collapses wire statuses into one live and three settled states", () => {
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
	const order = sortLive([
		{ kind: "subagent", summary: child },
		{ kind: "command", summary: { ...command, id: "late", startedAt: NOW - 1000 } },
		{ kind: "command", summary: { ...command, id: "stopping", status: "stopping" } },
		{ kind: "command", summary: command },
	]).map((resource) => (resource.kind === "command" ? resource.summary.id : "child"));
	expect(order).toEqual(["build", "late", "stopping", "child"]);
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

test("the dock lists live rows in state order with escaped text, inspect and stop, and collapses past four", () => {
	const empty = renderToStaticMarkup(<resources.ResourcesDock {...dockProps} />);
	expect(empty).toBe("");

	const html = renderToStaticMarkup(
		<resources.ResourcesDock
			{...dockProps}
			commands={[{ ...command, id: "stopping", status: "stopping" }, command]}
			subagents={[child]}
		/>,
	);
	expect(html).toContain('data-testid="resources-dock"');
	expect(html).not.toContain("data-collapsed");
	expect(html.indexOf('data-resource-id="build"')).toBeLessThan(
		html.indexOf('data-resource-id="stopping"'),
	);
	expect(html.indexOf('data-resource-id="stopping"')).toBeLessThan(
		html.indexOf('data-resource-id="child"'),
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

test("the inspector renders the roster as a listbox, selects the first live row, and fills the detail slot", () => {
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
	expect(html).toMatch(/aria-selected="true"[^>]*data-resource-id="build"/);
	expect(html).toMatch(/aria-selected="false"[^>]*data-resource-id="child"/);
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
	expect(html).toMatch(/aria-selected="true"[^>]*data-resource-id="done"/);
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
