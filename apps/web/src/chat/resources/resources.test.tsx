import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type {
	BackgroundCommandSummary,
	McpServerResourceSummary,
	SubagentResourceSummary,
} from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as resources from "./index";
import { mcpRowActions } from "./mcpRow";
import { elapsedLabel, formatElapsed, resourceState, sortLive } from "./resourceRow";

const NOW = 10 * 60_000;
const renderInspector = (node: ReactNode) =>
	renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
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
const noTally = { done: 0, failed: 0, stopped: 0, interrupted: 0 };
const inspectorProps: ComponentProps<typeof resources.ResourcesInspector> = {
	open: true,
	onOpenChange: () => {},
	commands: [],
	subagents: [],
	finishedCommands: [],
	finishedSubagents: [],
	history: { commands: noTally, subagents: noTally },
	expanded: {},
	onExpandedChange: () => {},
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
	finishedCount: 0,
	now: NOW,
	authoritative: true,
	actions: {},
	onInspect: () => {},
	onOpenFinished: () => {},
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
				/^(?:@thinkrail\/contracts|@thinkrail\/locales(?:\/react)?$|react|@remixicon\/react|@thinkrail\/ui\/|@\/lib$|\.\/)/,
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
	expect(formatElapsed(currentTranslator(), 20_000)).toBe("<1 min");
	expect(formatElapsed(currentTranslator(), 4 * 60_000 + 5_000)).toBe("4 min");
	expect(formatElapsed(currentTranslator(), 125 * 60_000)).toBe("2 h 5 min");
	const elapsed = (resource: Parameters<typeof elapsedLabel>[1]) =>
		elapsedLabel(currentTranslator(), resource, NOW);
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

test("the dock lists live rows oldest-first with escaped text, one inspect control and stop, and collapses past four behind an active toggle", () => {
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
	expect(html).not.toContain('data-testid="resources-dock-toggle"');
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
	const html = renderInspector(
		<resources.ResourcesInspector
			{...inspectorProps}
			commands={[command]}
			subagents={[child]}
			finishedCommands={[
				{ ...command, id: "finished", status: "completed", finishedAt: NOW - 60_000, exitCode: 1 },
			]}
			finishedSubagents={[
				{
					...child,
					childSessionId: "child-done",
					status: "aborted",
					abortReason: "Stopped by user",
				},
			]}
		/>,
	);
	expect(html).toContain('data-testid="resources-inspector"');
	expect(html).toContain('role="listbox"');
	expect(html.indexOf('data-testid="resources-commands"')).toBeLessThan(
		html.indexOf('data-testid="resources-subagents"'),
	);
	expect(html).toContain('data-testid="resources-finished"');
	expect(html).toContain("1 active · 1 finished");
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
	const html = renderInspector(
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

test("the inspector groups work by kind and folds finished rows past the newest five, never hiding a new result", () => {
	const finished = Array.from({ length: 8 }, (_, index) => ({
		...command,
		id: `done-${index}`,
		name: `done ${index}`,
		status: "completed" as const,
		exitCode: index === 6 ? 1 : 0,
		finishedAt: NOW - index * 60_000,
	}));
	const html = renderInspector(
		<resources.ResourcesInspector
			{...inspectorProps}
			commands={[command]}
			finishedCommands={finished}
			history={{
				commands: { done: 25, failed: 3, stopped: 1, interrupted: 1 },
				subagents: noTally,
			}}
			remaining={{ command: 22 }}
			newIds={new Set(["done-7"])}
			onLoadMore={() => {}}
			retained
		/>,
	);
	expect(html).toContain('data-testid="resources-commands"');
	expect(html).not.toContain('data-testid="resources-subagents"');
	expect(html).toContain("1 active · 30 finished");
	const shown = [...html.matchAll(/data-resource-id="([^"]+)"/g)].map((match) => match[1]);
	expect(shown).toEqual(["build", "done-0", "done-1", "done-2", "done-3", "done-4", "done-7"]);
	expect(html).toMatch(/data-resource-id="done-7"[^>]*data-fresh="true"/);
	expect(html).toContain('aria-label="done 7: echo');
	expect(html).toMatch(/aria-label="done 7: [^"]*, Done, new"/);
	expect(html).toMatch(
		/data-testid="resources-fold"[^>]*aria-expanded="false"[^>]*aria-label="24 more finished: 19 done, 3 failed, 2 stopped or interrupted"/,
	);
	expect(html).toContain("24 more finished");
	expect(html).not.toContain('data-testid="resources-show-more"');
	expect(html).toContain("History and logs are kept until this workspace is archived.");
});

test("expanded, the fold reveals the rest in order, offers the next page with what is left, and collapses back", () => {
	const finished = Array.from({ length: 8 }, (_, index) => ({
		...child,
		childSessionId: `child-${index}`,
		status: "completed" as const,
		finishedAt: NOW - index * 60_000,
	}));
	const props = {
		...inspectorProps,
		finishedSubagents: finished,
		history: { commands: noTally, subagents: { ...noTally, done: 30 } },
		remaining: { subagent: 22 },
		newIds: new Set(["child-7"]),
		expanded: { subagent: true },
		selectedId: "child-6",
		onLoadMore: () => {},
	};
	const html = renderInspector(<resources.ResourcesInspector {...props} />);
	const shown = [...html.matchAll(/data-resource-id="([^"]+)"/g)].map((match) => match[1]);
	expect(shown).toEqual(finished.map((item) => item.childSessionId));
	expect(html.indexOf('data-testid="resources-fold"')).toBeLessThan(
		html.indexOf('data-resource-id="child-5"'),
	);
	expect(html).toMatch(/data-testid="resources-fold"[^>]*aria-expanded="true"/);
	expect(html).toMatch(/data-testid="resources-show-more"[^>]*>Show 20 more · 22 left/);
	expect(html).toContain('data-testid="resources-collapse"');

	const loading = renderInspector(
		<resources.ResourcesInspector
			{...props}
			actions={{ "history:subagent": { pending: true, error: null } }}
		/>,
	);
	expect(loading).toMatch(/data-testid="resources-show-more"[^>]*disabled[^>]*>Loading…/);
	const failed = renderInspector(
		<resources.ResourcesInspector
			{...props}
			actions={{ "history:subagent": { pending: false, error: "History read failed" } }}
		/>,
	);
	expect(failed).toMatch(/role="alert"[^>]*>History read failed/);

	const older = renderInspector(
		<resources.ResourcesInspector {...props} remaining={{}} onLoadMore={undefined} />,
	);
	expect(older).not.toContain('data-testid="resources-show-more"');
	expect(older).toContain('data-testid="resources-collapse"');
});

test("a collapsed fold keeps the selected row visible, and a chat with no work says so once", () => {
	const finished = Array.from({ length: 7 }, (_, index) => ({
		...command,
		id: `run-${index}`,
		status: "completed" as const,
		exitCode: 0,
		finishedAt: NOW - index * 60_000,
	}));
	const html = renderInspector(
		<resources.ResourcesInspector
			{...inspectorProps}
			finishedCommands={finished}
			selectedId="run-6"
		/>,
	);
	expect(html).toMatch(/data-resource-id="run-6"[^>]*data-selected="true"/);
	expect(html).not.toContain('data-resource-id="run-5"');
	expect(html).toContain("1 more finished");

	const empty = renderInspector(<resources.ResourcesInspector {...inspectorProps} />);
	expect(empty).toContain('data-testid="resources-empty"');
	expect(empty).toContain("Nothing has run in the background in this chat yet.");
	expect(empty).not.toContain('data-testid="resources-commands"');
	expect(empty).toContain("kept for this host session only");
});

test("an interrupted run reads Interrupted, never live, and its detail says why", () => {
	const cut: BackgroundCommandSummary = {
		...command,
		id: "cut",
		status: "stopped",
		interrupted: true,
	};
	expect(resourceState({ kind: "command", summary: cut })).toBe("interrupted");
	expect(
		resourceState({
			kind: "subagent",
			summary: { ...child, status: "aborted", interrupted: true },
		}),
	).toBe("interrupted");
	const html = renderInspector(
		<resources.ResourcesInspector
			{...inspectorProps}
			finishedCommands={[cut]}
			history={{ commands: { ...noTally, interrupted: 1 }, subagents: noTally }}
		/>,
	);
	expect(html).toMatch(/data-resource-id="cut"[^>]*data-state="interrupted"/);
	expect(html).toContain("Interrupted");
	expect(html).toContain('data-testid="resource-detail-interrupted"');
	expect(html).not.toContain('data-testid="resource-detail-stop"');
	expect(html).not.toContain('data-testid="resource-stop"');
});

test("the detail header shows a subagent's model through the parent's label and omits it when the host sent none", () => {
	const withModel = { ...child, model: "openai/gpt-6", thinkingLevel: "max" as const };
	const labelled = renderInspector(
		<resources.ResourcesInspector
			{...inspectorProps}
			subagents={[withModel]}
			renderSubagentModel={(summary) => (
				<span data-testid="label">{`${summary.model} @ ${summary.thinkingLevel}`}</span>
			)}
		/>,
	);
	expect(labelled).toContain('data-testid="resource-detail-model"');
	expect(labelled).toContain(">Model<");
	expect(labelled).toContain("openai/gpt-6 @ max");

	const older = renderInspector(
		<resources.ResourcesInspector
			{...inspectorProps}
			subagents={[child]}
			renderSubagentModel={() => <span>never</span>}
		/>,
	);
	expect(older).not.toContain('data-testid="resource-detail-model"');
	expect(older).not.toContain("never");
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
	expect(log({ result: { available: false } })).toContain("retained only for recent work");
	expect(log({ result: { available: false }, retained: true })).toContain(
		"This command’s log is not available.",
	);
	expect(log({ result: { available: false }, retained: true, interrupted: true })).toContain(
		"The log wasn’t saved",
	);
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

test("the result row maps a completion to the shared states, teases the last output line and stays collapsed unless told", () => {
	const finished = {
		id: "bg-1",
		sessionId: "chat",
		name: "full e2e <b>",
		status: "completed" as const,
		startedAt: 0,
		finishedAt: 12 * 60_000 + 4_000,
		exitCode: 1,
		output: { text: "  1 failed\n\u001b[32m141 passed (12.1m)\u001b[39m\n\n", truncated: true },
	};
	const row = (overrides: Partial<ComponentProps<typeof resources.ResultRow>>) =>
		renderToStaticMarkup(
			<resources.ResultRow
				source={{ kind: "command", details: finished }}
				expanded={false}
				{...overrides}
			>
				<pre>BODY</pre>
			</resources.ResultRow>,
		);
	const collapsed = row({ onToggle: () => {} });
	expect(collapsed).toContain("Failed");
	expect(collapsed).toContain("12 min");
	expect(collapsed).toContain("exit 1");
	expect(collapsed).toContain("full e2e &lt;b&gt;");
	expect(collapsed).toContain('data-testid="background-result-teaser"');
	expect(collapsed).toContain(">141 passed (12.1m)<");
	expect(collapsed).toContain('aria-expanded="false"');
	expect(collapsed).not.toContain("BODY");
	expect(collapsed).not.toContain('data-testid="background-result-open"');

	const open = row({ onToggle: () => {}, expanded: true, onOpen: () => {} });
	expect(open).toContain("BODY");
	expect(open).not.toContain('data-testid="background-result-teaser"');
	expect(open).toContain("Open log");

	expect(row({})).not.toContain('data-testid="background-result-toggle"');
	expect(row({ source: { kind: "command", details: { ...finished, exitCode: 0 } } })).toContain(
		"Done",
	);
	expect(
		row({
			source: { kind: "command", details: { ...finished, status: "stopped", exitCode: null } },
		}),
	).toContain("Stopped");

	const subagent = renderToStaticMarkup(
		<resources.ResultRow
			source={{
				kind: "subagent",
				details: {
					childSessionId: "child",
					roleName: "reviewer",
					task: "review",
					status: "aborted",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0,
						turns: 0,
						contextTokens: 0,
					},
					durationMs: 0,
				},
			}}
			expanded={false}
			metaLead={<span data-testid="meta-lead">gpt-6 · max</span>}
			meta="12 turns"
			teaser="Verdict: approve"
			onOpen={() => {}}
		/>,
	);
	expect(subagent).toContain("Subagent");
	expect(subagent).toContain("reviewer");
	expect(subagent).toContain("Stopped");
	expect(subagent).toMatch(/data-testid="meta-lead"[\s\S]*12 turns/);
	expect(subagent).toContain("Verdict: approve");
	expect(subagent).toContain("Transcript");
	expect(subagent).not.toContain("min<");
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
	const html = renderInspector(
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
	const stale = renderInspector(
		<resources.ResourcesInspector
			{...inspectorProps}
			mcpServers={mcpServers}
			authoritative={false}
		/>,
	);
	expect(stale).toMatch(/data-testid="resource-mcp-disable"[^>]*disabled=""/);
	const empty = renderInspector(
		<resources.ResourcesInspector {...inspectorProps} mcpServers={[]} />,
	);
	expect(empty).toContain("No MCP servers in this chat.");
	expect(renderInspector(<resources.ResourcesInspector {...inspectorProps} />)).not.toContain(
		'data-testid="resources-mcp"',
	);
});

test("the dock lists only live work and sums finished work into one line that opens Resources", () => {
	const idle = renderToStaticMarkup(
		<resources.ResourcesDock {...dockProps} finishedCount={90} freshCount={2} />,
	);
	expect(idle).toContain('data-testid="resources-dock"');
	expect(idle).not.toContain('data-testid="resource-command"');
	expect(idle).not.toContain('data-testid="resource-dismiss"');
	expect(idle).toMatch(
		/data-testid="resources-dock-finished"[\s\S]*90 finished[\s\S]*2 new[\s\S]*Open Resources/,
	);
	expect(idle).not.toContain("active");
	expect(idle).not.toContain("animate-working");

	const seen = renderToStaticMarkup(<resources.ResourcesDock {...dockProps} finishedCount={3} />);
	expect(seen).toContain("3 finished");
	expect(seen).not.toContain('data-testid="resources-dock-fresh"');

	const working = renderToStaticMarkup(
		<resources.ResourcesDock
			{...dockProps}
			commands={[command]}
			finishedCount={4}
			freshCount={1}
		/>,
	);
	expect(working.indexOf('data-resource-id="build"')).toBeLessThan(
		working.indexOf('data-testid="resources-dock-finished"'),
	);
	expect(working).not.toContain('data-testid="resources-dock-toggle"');

	const crowded = renderToStaticMarkup(
		<resources.ResourcesDock
			{...dockProps}
			commands={[1, 2, 3, 4, 5].map((n) => ({ ...command, id: `c${n}` }))}
			finishedCount={7}
		/>,
	);
	expect(crowded).toContain('data-collapsed="true"');
	expect(crowded).toMatch(
		/data-testid="resources-dock-toggle"[^>]*aria-expanded="false"[\s\S]*5 active/,
	);
	expect(crowded).toContain("7 finished");
});

test("a jump to what finished lands on the newest finish across kinds", () => {
	const done = (id: string, finishedAt: number): BackgroundCommandSummary => ({
		...command,
		id,
		status: "completed",
		exitCode: 0,
		finishedAt,
	});
	const reviewed: SubagentResourceSummary = {
		...child,
		childSessionId: "reviewed",
		status: "completed",
		finishedAt: NOW - 30_000,
	};
	expect(resources.newestResourceId([], [])).toBeNull();
	expect(resources.newestResourceId([done("old", NOW - 90_000)], [reviewed])).toBe("reviewed");
	expect(resources.newestResourceId([done("new", NOW - 10_000)], [reviewed])).toBe("new");
});

test("the trigger shows how many finished results are new", () => {
	const render = (freshCount?: number) =>
		renderToStaticMarkup(
			<TooltipProvider>
				<resources.ResourcesButton
					activeCount={1}
					open={false}
					{...(freshCount ? { freshCount } : {})}
				/>
			</TooltipProvider>,
		);
	const fresh = render(2);
	expect(fresh).toContain('data-testid="resources-trigger-fresh"');
	expect(fresh).toContain("2 new");
	expect(fresh).toContain('aria-label="Resources, 1 active, 2 new"');
	expect(render()).not.toContain("resources-trigger-fresh");
});
