import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { BackgroundCommandSummary } from "@thinkrail/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as resources from "./index";

const command: BackgroundCommandSummary = {
	id: "build",
	sessionId: "chat",
	name: "Build <script>",
	command: "echo '<img src=x onerror=bad()>'",
	status: "running",
	startedAt: 1,
};
const props: ComponentProps<typeof resources.ResourcesContent> = {
	commands: [],
	subagents: [],
	finishedCommands: [],
	finishedSubagents: [],
	authoritative: true,
	loading: false,
	stale: false,
	error: null,
	actions: {},
	onRetry: () => {},
	onLogs: () => {},
	onTranscript: () => {},
	onStopCommand: () => {},
	onStopSubagent: () => {},
	onStopAll: () => {},
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

test("active rows preserve native statuses, action hooks and escaped source text; finished rows start collapsed", () => {
	const html = renderToStaticMarkup(
		<resources.ResourcesContent
			{...props}
			commands={[command, { ...command, id: "stopping", status: "stopping" }]}
			subagents={[
				{
					childSessionId: "child",
					parentSessionId: "chat",
					task: "<b>Inspect</b>",
					status: "queued",
					createdAt: "now",
				},
			]}
			finishedCommands={[{ ...command, id: "finished", status: "completed" }]}
		/>,
	);
	expect(html).toContain('data-status="running"');
	expect(html).toContain('data-status="stopping"');
	expect(html).toContain('data-status="queued"');
	expect(html).toContain('data-resource-id="child"');
	expect(html).toContain('data-testid="resource-logs"');
	expect(html).toContain('data-testid="resource-transcript"');
	expect(html).toContain("Stop all subagents");
	expect(html).toContain("Finished · 1");
	expect(html).not.toContain('data-resource-id="finished"');
	expect(html).not.toContain("<img");
	expect(html).not.toContain("<b>");
	expect(html).toContain("&lt;script&gt;");
});

test("stale snapshots disable control authority and failures remain by their action with role alert", () => {
	const html = renderToStaticMarkup(
		<resources.ResourcesContent
			{...props}
			commands={[command]}
			authoritative={false}
			stale
			error="Read failed"
			actions={{ "command:build": { pending: false, error: "Stop failed" } }}
		/>,
	);
	expect(html).toContain("Resources are stale.");
	expect(html).toMatch(/data-testid="resource-stop" disabled/);
	expect(html).toContain("Stop failed");
	expect(html).toContain("Read failed");
	expect(html).toContain('role="alert"');
	expect(html).toContain('data-testid="resources-retry"');
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
