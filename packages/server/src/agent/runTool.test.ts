import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProjectRun, RunExecution, RunRecipeDocument } from "@thinkrail/contracts";
import {
	executeRunProject,
	type RunToolContext,
	type RunToolHost,
	runRecipeRule,
	setRunToolHost,
} from "./runTool";

const document: RunRecipeDocument = {
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
			{ id: "test", command: "bun test", kind: "task" },
		],
		primary: "dev",
	},
	revision: 3,
	learnedAt: 1_700_000_000_000,
	learnedBy: "user",
};

function execution(partial: Partial<RunExecution> & { runId: string }): RunExecution {
	return {
		targetId: "dev",
		tabKey: "thinkrail-run:dev",
		status: "running",
		startedAt: 1,
		ports: { PORT: 5174 },
		origin: "agent",
		...partial,
	};
}

interface FakeHost extends RunToolHost {
	calls: string[];
	run: ProjectRun;
	executions: RunExecution[];
	platformSupported: boolean;
}

function fakeHost(): FakeHost {
	const host: FakeHost = {
		calls: [],
		run: {
			document,
			settings: { autoOpen: false, agentMayRun: true },
			ports: { "ws-1": { PORT: 5174 } },
		},
		executions: [],
		platformSupported: true,
		workspaceOf: (sessionId) => (sessionId === "orphan" ? undefined : "ws-1"),
		context: (workspaceId): RunToolContext => ({
			projectId: "p1",
			workspaceId,
			workspaceName: "Feature",
			isDefaultWorkspace: false,
			projectPath: "/repo",
			run: host.run,
			platformSupported: host.platformSupported,
		}),
		setRecipe: (_workspaceId, sessionId, recipe, expectedRevision) => {
			host.calls.push(`set_recipe:${sessionId}:${expectedRevision}`);
			return {
				...document,
				recipe: recipe as RunRecipeDocument["recipe"],
				revision: expectedRevision + 1,
			};
		},
		start: async (_workspaceId, targetId, prepare) => {
			host.calls.push(`start:${targetId}:${prepare}`);
			const started = execution({ runId: "run-1", targetId, status: "starting" });
			host.executions = [started];
			return started;
		},
		stop: (_workspaceId, targetId) => {
			host.calls.push(`stop:${targetId}`);
			return execution({ runId: "run-1", targetId, status: "stopping" });
		},
		state: () => ({ workspaceId: "ws-1", executions: host.executions }),
		output: (_workspaceId, targetId, runId) => ({
			runId: runId ?? "run-1",
			text: `tail of ${targetId}`,
		}),
	};
	return host;
}

let host: FakeHost;

beforeEach(() => {
	host = fakeHost();
	setRunToolHost(host);
});

afterEach(() => {
	setRunToolHost(null);
});

describe("run_project", () => {
	test("needs a workspace chat and reads the recipe with its contract", async () => {
		await expect(executeRunProject("orphan", { action: "recipe" })).rejects.toThrow(
			"workspace chat",
		);
		const text = await executeRunProject("s1", { action: "recipe" });
		expect(text).toContain('"revision": 3');
		expect(text).toContain("POSIX sh");
		expect(text).toContain("assigned ports: PORT=5174");
		host.run = { ...host.run, document: null };
		expect(await executeRunProject("s1", { action: "recipe" })).toContain(
			"No recipe yet (revision 0)",
		);
	});

	test("set_recipe defaults the expected revision to the current one and stamps the session", async () => {
		const text = await executeRunProject("s1", { action: "set_recipe", recipe: document.recipe });
		expect(text).toBe("Recipe saved (revision 4): targets dev, test; primary dev.");
		expect(host.calls).toEqual(["set_recipe:s1:3"]);
		await expect(executeRunProject("s1", { action: "set_recipe" })).rejects.toThrow(
			"needs the recipe",
		);
	});

	test("run and stop respect the per-project switch and the platform; reads still work", async () => {
		host.run = { ...host.run, settings: { autoOpen: false, agentMayRun: false } };
		await expect(executeRunProject("s1", { action: "run", target: "dev" })).rejects.toThrow(
			"RUN_AGENT_FORBIDDEN",
		);
		await expect(executeRunProject("s1", { action: "stop", target: "dev" })).rejects.toThrow(
			"RUN_AGENT_FORBIDDEN",
		);
		expect(await executeRunProject("s1", { action: "output", target: "dev" })).toContain(
			"tail of dev",
		);
		host.run = { ...host.run, settings: { autoOpen: false, agentMayRun: true } };
		host.platformSupported = false;
		await expect(executeRunProject("s1", { action: "run", target: "dev" })).rejects.toThrow(
			"RUN_UNSUPPORTED_PLATFORM",
		);
		expect(host.calls).toEqual([]);
	});

	test("run returns at start by default and requires a target", async () => {
		await expect(executeRunProject("s1", { action: "run" })).rejects.toThrow("needs a target");
		const text = await executeRunProject("s1", { action: "run", target: "test", prepare: false });
		expect(host.calls).toEqual(["start:test:false"]);
		expect(text).toContain('"runId": "run-1"');
	});

	test("wait: exit returns the code and tail once the run ends", async () => {
		const pending = executeRunProject("s1", { action: "run", target: "test", wait: "exit" });
		await Bun.sleep(50);
		host.executions = [
			execution({ runId: "run-1", targetId: "test", status: "exited", exitCode: 3 }),
		];
		const text = await pending;
		expect(text).toContain("Exited with code 3.");
		expect(text).toContain("tail of test");
	});

	test("wait: listening rejects a target that cannot listen and reports a server that came up", async () => {
		await expect(
			executeRunProject("s1", { action: "run", target: "test", wait: "listening" }),
		).rejects.toThrow('wait: "listening" needs a serve target');
		const pending = executeRunProject("s1", { action: "run", target: "dev", wait: "listening" });
		await Bun.sleep(50);
		host.executions = [
			execution({ runId: "run-1", status: "listening", url: "http://localhost:5174/" }),
		];
		expect(await pending).toContain("Listening at http://localhost:5174/.");
	});

	test("the tool's abort signal ends the wait but not the run, and a timeout says so", async () => {
		const controller = new AbortController();
		const pending = executeRunProject(
			"s1",
			{ action: "run", target: "dev", wait: "exit", timeoutSec: 60 },
			controller.signal,
		);
		await Bun.sleep(20);
		controller.abort();
		expect(await pending).toContain("The wait was cancelled; the run keeps going.");
		expect(host.calls.filter((call) => call.startsWith("stop"))).toEqual([]);

		host.executions = [];
		const timedOut = await executeRunProject("s1", {
			action: "run",
			target: "dev",
			wait: "exit",
			timeoutSec: 1,
		});
		expect(timedOut).toContain("Timed out waiting for exit; the run keeps going.");
	}, 10_000);

	test("the system-prompt rule names the targets only when a recipe exists", () => {
		expect(runRecipeRule(host.run)).toBe(
			"This project has a run recipe (targets: dev (primary), test). Use run_project to run a target, read its output, or update the recipe when the way the project runs changes.",
		);
		expect(runRecipeRule({ ...host.run, document: null })).toBeNull();
	});
});
