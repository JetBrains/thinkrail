import { describe, expect, test } from "bun:test";
import type { ProjectRun, RunExecution, RunWorkspaceState } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { browserUrl, type RunAction, type RunContext, runActions } from "./runActions";
import { fixRunPrompt, SETUP_RUN_PROMPT } from "./runPrompts";

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
				{ id: "desktop", title: "Desktop app", command: "bun run dev:desktop", kind: "serve" },
				{ id: "test", command: "bun test", kind: "task" },
			],
			primary: "dev",
		},
		revision: 1,
		learnedAt: 0,
		learnedBy: "user",
	},
	settings: { autoOpen: false, agentMayRun: true },
	ports: {},
};

function execution(partial: Partial<RunExecution> & { runId: string }): RunExecution {
	return {
		targetId: "dev",
		tabKey: "thinkrail-run:dev",
		status: "running",
		startedAt: 1,
		ports: { PORT: 5174 },
		origin: "user",
		...partial,
	};
}

function model(state: RunWorkspaceState | undefined, overrides: Partial<RunContext> = {}) {
	return runActions(currentTranslator(), {
		supported: true,
		hostPlatform: "darwin",
		run,
		state,
		...overrides,
	});
}

function kinds(actions: { action: RunAction }[]): string[] {
	return actions.map(({ action }) =>
		"targetId" in action
			? `${action.kind}:${action.targetId}${"prepare" in action && !action.prepare ? ":no-prepare" : ""}`
			: action.kind,
	);
}

describe("runActions", () => {
	test("is absent on an older host and on Windows", () => {
		expect(model(undefined, { supported: false })).toBeNull();
		expect(model(undefined, { hostPlatform: "win32" })).toBeNull();
	});

	test("without a recipe the segment offers set-up and the tab", () => {
		const m = model(undefined, { run: { ...run, document: null } });
		expect(m?.primary?.action).toEqual({ kind: "setUp" });
		expect(m?.primary?.label).toBe("Set up run");
		expect(m?.chip).toBeNull();
		expect(kinds(m?.secondary ?? [])).toEqual(["openTab"]);
	});

	test("idle: the primary target runs; the menu lists the other targets, no-prepare, prepare, fix and the tab", () => {
		const m = model(undefined);
		expect(m?.caption).toBe("Run");
		expect(m?.primary?.label).toBe("Run dev");
		expect(m?.primary?.short).toBe("Run");
		expect(kinds(m?.secondary ?? [])).toEqual([
			"start:desktop",
			"start:test",
			"start:dev:no-prepare",
			"start:null",
			"fix",
			"openTab",
		]);
	});

	test("live: the segment follows the latest started run with Stop, Restart, Open, Show terminal", () => {
		const state: RunWorkspaceState = {
			workspaceId: "ws",
			executions: [
				execution({ runId: "a", status: "exited", exitCode: 0, startedAt: 1 }),
				execution({
					runId: "b",
					targetId: "desktop",
					tabKey: "thinkrail-run:desktop",
					status: "listening",
					url: "http://localhost:5174/",
					startedAt: 2,
				}),
			],
		};
		const m = model(state);
		expect(m?.caption).toBe("Run · Desktop app");
		expect(m?.chip).toEqual({ label: "Running · :5174", tone: "success", live: true });
		expect(m?.primary?.action).toEqual({ kind: "stop", targetId: "desktop" });
		expect(m?.open).toEqual({ url: "http://localhost:5174/", label: "Open in browser" });
		expect(kinds(m?.secondary ?? [])).toEqual([
			"restart:desktop",
			"open",
			"showTerminal",
			"start:dev",
			"start:test",
			"fix",
			"openTab",
		]);
		const stopping = model({
			workspaceId: "ws",
			executions: [execution({ runId: "c", status: "stopping" })],
		});
		expect(stopping?.primary?.disabled).toBe(true);
		expect(stopping?.chip?.label).toBe("Stopping…");
	});

	test("a failed run puts Fix first and Run again second; a clean exit runs again", () => {
		const failedState: RunWorkspaceState = {
			workspaceId: "ws",
			executions: [
				execution({
					runId: "a",
					targetId: "test",
					tabKey: "thinkrail-run:test",
					status: "exited",
					exitCode: 1,
				}),
			],
		};
		const failed = model(failedState);
		expect(failed?.chip).toEqual({ label: "Exited 1", tone: "warning", live: false });
		expect(failed?.primary?.action.kind).toBe("fix");
		expect(failed?.primary?.short).toBe("Fix");
		expect(kinds(failed?.secondary ?? []).slice(0, 3)).toEqual([
			"start:test",
			"start:dev",
			"start:desktop",
		]);

		const clean = model({
			workspaceId: "ws",
			executions: [execution({ runId: "a", targetId: "test", status: "exited", exitCode: 0 })],
		});
		expect(clean?.chip).toEqual({ label: "Finished", tone: "success", live: false });
		expect(clean?.primary?.action).toEqual({ kind: "start", targetId: "test", prepare: true });

		const unknown = model({
			workspaceId: "ws",
			executions: [execution({ runId: "a", status: "exited", exitCode: null })],
		});
		expect(unknown?.chip).toEqual({ label: "Ended", tone: "neutral", live: false });
	});

	test("a later one-shot is followed even while a server runs; the live server offers Stop in the menu", () => {
		const m = model({
			workspaceId: "ws",
			executions: [
				execution({
					runId: "server",
					status: "listening",
					url: "http://localhost:5174/",
					startedAt: 1,
				}),
				execution({
					runId: "tests",
					targetId: "test",
					tabKey: "thinkrail-run:test",
					status: "exited",
					exitCode: 1,
					startedAt: 2,
				}),
			],
		});
		expect(m?.caption).toBe("Run · test");
		expect(m?.primary?.action.kind).toBe("fix");
		expect(kinds(m?.secondary ?? [])).toContain("stop:dev");
		expect(kinds(m?.secondary ?? [])).not.toContain("start:dev");
	});

	test("a prepare-only run is followed too", () => {
		const m = model({
			workspaceId: "ws",
			executions: [
				execution({
					runId: "p",
					targetId: null,
					tabKey: "thinkrail-run-prepare",
					status: "stopped",
				}),
			],
		});
		expect(m?.caption).toBe("Run · prepare");
		expect(m?.primary?.action).toEqual({ kind: "start", targetId: null, prepare: true });
	});
});

describe("browserUrl", () => {
	test("rewrites only loopback hosts, and only for a remote client", () => {
		expect(browserUrl("http://localhost:5174/app", "devbox.tail")).toBe(
			"http://devbox.tail:5174/app",
		);
		expect(browserUrl("http://127.0.0.1:3000", "devbox.tail")).toBe("http://devbox.tail:3000/");
		expect(browserUrl("http://localhost:5174/", "localhost")).toBe("http://localhost:5174/");
		expect(browserUrl("http://localhost:5174/", "127.0.0.1")).toBe("http://localhost:5174/");
		expect(browserUrl("https://preview.example.com/", "devbox.tail")).toBe(
			"https://preview.example.com/",
		);
		expect(browserUrl("not a url", "devbox.tail")).toBe("not a url");
	});
});

describe("prompts", () => {
	test("open with the skill reference and name the execution", () => {
		expect(SETUP_RUN_PROMPT.startsWith("/skill:running-the-project ")).toBe(true);
		const prompt = fixRunPrompt(
			execution({ runId: "run-9", status: "exited", exitCode: 2 }),
			"dev",
		);
		expect(prompt.startsWith("/skill:running-the-project ")).toBe(true);
		expect(prompt).toContain('"dev" (run run-9) exited with code 2');
		expect(fixRunPrompt(execution({ runId: "run-1", status: "listening" }), "dev")).toContain(
			"is running and the user asked for help",
		);
		expect(fixRunPrompt(null, null)).toContain("the primary target");
	});
});
