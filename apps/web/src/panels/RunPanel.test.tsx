import { expect, test } from "bun:test";
import type { ProjectRun, RunWorkspaceState } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { RunPanelView } from "./RunPanel";

const run: ProjectRun = {
	document: {
		recipe: {
			version: 1,
			ports: { PORT: 5173 },
			prepare: ["bun install"],
			targets: [
				{
					id: "dev",
					command: "bun run dev",
					kind: "serve",
					ports: ["PORT"],
					url: `http://localhost:\${PORT}/`,
				},
				{ id: "test", title: "Unit tests", command: "bun test", kind: "task" },
			],
			primary: "dev",
			notes: "Needs docker.",
		},
		revision: 2,
		learnedAt: Date.now() - 60_000,
		learnedBy: { sessionId: "s1", workspaceId: "ws-1" },
	},
	settings: { autoOpen: false, agentMayRun: true },
	ports: { "ws-1": { PORT: 5174 } },
};

const state: RunWorkspaceState = {
	workspaceId: "ws-1",
	executions: [
		{
			runId: "r1",
			targetId: "dev",
			tabKey: "thinkrail-run:dev",
			status: "listening",
			startedAt: 1,
			url: "http://localhost:5174/",
			ports: { PORT: 5174 },
			origin: "user",
		},
		{
			runId: "r2",
			targetId: "test",
			tabKey: "thinkrail-run:test",
			status: "exited",
			exitCode: 1,
			startedAt: 2,
			endedAt: 3,
			ports: { PORT: 5174 },
			origin: "agent",
		},
	],
};

const actions = {
	run: () => {},
	openUrl: () => {},
	setPrimary: () => {},
	setSetting: () => {},
	edit: () => {},
};

const render = (overrides: Partial<Parameters<typeof RunPanelView>[0]> = {}) =>
	renderToStaticMarkup(
		<TooltipProvider>
			<RunPanelView
				workspaceId="ws-1"
				supported
				hostPlatform="darwin"
				run={run}
				state={state}
				actions={actions}
				now={Date.now()}
				{...overrides}
			/>
		</TooltipProvider>,
	);

test("the Run tab lists targets with their state, prepare, recipe facts and the project switches", () => {
	const markup = render();
	expect(markup).toContain('data-testid="run-panel"');
	expect(markup.match(/data-testid="run-target"/g)).toHaveLength(2);
	expect(markup).toContain('data-target="dev"');
	expect(markup).toContain("Unit tests");
	expect(markup).toContain('data-status="listening"');
	expect(markup).toContain("Running · :5174");
	expect(markup).toContain("Exited 1");
	expect(markup).toContain('data-testid="run-target-open"');
	expect(markup).toContain("bun install");
	expect(markup).toContain("PORT=5174");
	expect(markup).toContain("Needs docker.");
	expect(markup).toContain("by the agent");
	expect(markup).toContain('data-testid="run-panel-auto-open"');
	expect(markup).toContain('data-testid="run-panel-agent-may-run"');
	expect(markup).toContain('data-testid="run-panel-edit"');
});

test("without a recipe the Run tab explains and offers set-up", () => {
	const markup = render({ run: { ...run, document: null } });
	expect(markup).toContain('data-testid="run-panel-empty"');
	expect(markup).toContain('data-testid="run-panel-setup"');
	expect(markup).not.toContain('data-testid="run-target"');
});

test("an older host and a Windows host get an explanation instead of controls", () => {
	expect(render({ supported: false })).toContain("This host is too old for project runs");
	expect(render({ hostPlatform: "win32" })).toContain("not available on Windows yet");
});
