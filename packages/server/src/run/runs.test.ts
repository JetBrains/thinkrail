import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, RunRecipe, RunWorkspaceState, Workspace } from "@thinkrail/contracts";
import { removeTree } from "@thinkrail/shared/removeTree";
import { loadRun, saveProjects, saveWorkspaces } from "../persistence";
import {
	listTerminals,
	resetTerminalState,
	setTerminalPublisher,
	setTerminalTabsPublisher,
} from "../terminal";
import {
	forgetWorkspaceRuns,
	getProjectRun,
	listRunState,
	readRunOutput,
	resetRunState,
	restartRun,
	setPrimaryTarget,
	setRecipe,
	setRunPublisher,
	setRunSettings,
	startRun,
	stopRun,
	stopWorkspaceRuns,
} from "./runs";
import { shellQuote } from "./script";

const PROJECT = "project-1";
const DEFAULT_WS = "ws-default";
const WORKTREE_WS = "ws-feature";
const TIMEOUT_MS = 15_000;

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let states: RunWorkspaceState[] = [];
const stateSignals = new Set<() => void>();

const recipe: RunRecipe = {
	version: 1,
	ports: { PORT: 5173 },
	prepare: ["echo PREPARED_$THINKRAIL_RUN_TARGET"],
	targets: [
		{ id: "dev", command: "echo SERVING_$PORT; sleep 1000", kind: "serve", ports: ["PORT"] },
		{ id: "test", command: "echo TESTED; exit 7", kind: "task" },
	],
	primary: "dev",
};

function executionOf(workspaceId: string, targetId: string | null) {
	return listRunState(workspaceId).executions.find((execution) => execution.targetId === targetId);
}

function waitForStatus(
	workspaceId: string,
	targetId: string | null,
	predicate: (status: string) => boolean,
): Promise<void> {
	const ready = () => {
		const status = executionOf(workspaceId, targetId)?.status;
		return status !== undefined && predicate(status);
	};
	if (ready()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			stateSignals.delete(signal);
			reject(
				new Error(
					`Timed out waiting for ${targetId} in ${workspaceId}: ${executionOf(workspaceId, targetId)?.status}`,
				),
			);
		}, TIMEOUT_MS);
		const signal = () => {
			if (!ready()) return;
			clearTimeout(timeout);
			stateSignals.delete(signal);
			resolve();
		};
		stateSignals.add(signal);
	});
}

async function waitForOutput(
	workspaceId: string,
	targetId: string | null,
	marker: string,
): Promise<string> {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const output = readRunOutput(workspaceId, targetId, undefined, 100_000)?.text ?? "";
		if (output.includes(marker)) return output;
		await Bun.sleep(20);
	}
	throw new Error(`Timed out waiting for ${marker}`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-run-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	const projectPath = join(dataDir, "project");
	const worktreePath = join(dataDir, "worktrees", "feature");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(worktreePath, { recursive: true });
	saveProjects([
		{ id: PROJECT, name: "Project", path: projectPath, slug: "project", lastOpened: 0 } as Project,
	]);
	saveWorkspaces([
		{
			id: DEFAULT_WS,
			projectId: PROJECT,
			kind: "default",
			name: "Default",
			branch: "main",
			worktreePath: projectPath,
			baseBranch: "main",
		} as Workspace,
		{
			id: WORKTREE_WS,
			projectId: PROJECT,
			name: "Feature",
			branch: "feature",
			worktreePath,
			baseBranch: "main",
		} as Workspace,
	]);
	states = [];
	stateSignals.clear();
	setTerminalPublisher(() => "delivered");
	setRunPublisher({
		recipe: () => {},
		state: (state) => {
			states.push(state);
			for (const signal of stateSignals) signal();
		},
	});
	setRecipe(PROJECT, recipe, 0, "user");
});

afterEach(async () => {
	await stopWorkspaceRuns(DEFAULT_WS, { force: true });
	await stopWorkspaceRuns(WORKTREE_WS, { force: true });
	resetRunState();
	resetTerminalState();
	setRunPublisher(null);
	setTerminalPublisher(() => "unavailable");
	setTerminalTabsPublisher(() => {});
	removeTree(dataDir);
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("recipes are revisioned, host-stamped and compare-and-set", () => {
	const run = getProjectRun(PROJECT);
	expect(run.document?.revision).toBe(1);
	expect(run.document?.learnedBy).toBe("user");
	expect(run.settings).toEqual({ autoOpen: false, agentMayRun: true });

	expect(() => setRecipe(PROJECT, recipe, 0, "user")).toThrow("revision 1");
	const next = setRecipe(PROJECT, recipe, 1, { sessionId: "s1", workspaceId: WORKTREE_WS });
	expect(next.revision).toBe(2);
	expect(next.learnedBy).toEqual({ sessionId: "s1", workspaceId: WORKTREE_WS });
	expect(() => setRecipe(PROJECT, { ...recipe, primary: "nope" }, 2, "user")).toThrow("primary");

	expect(setPrimaryTarget(PROJECT, "test", 2).recipe.primary).toBe("test");
	expect(() => setPrimaryTarget(PROJECT, "missing", 3)).toThrow("No target");
	expect(setRunSettings(PROJECT, { autoOpen: true })).toEqual({
		autoOpen: true,
		agentMayRun: true,
	});
	expect(loadRun().projects[PROJECT]?.settings.autoOpen).toBe(true);
});

test.skipIf(process.platform === "win32")(
	"a one-shot target runs prepare first and reports the target's exit code and output",
	async () => {
		const started = await startRun(WORKTREE_WS, "test", { origin: "user" });
		expect(started.status).toBe("starting");
		expect(started.ports).toEqual({ PORT: 5174 });
		expect(listTerminals(WORKTREE_WS)).toEqual([
			{ tabKey: "thinkrail-run:test", title: "Run: test", kind: "command" },
		]);

		await waitForStatus(WORKTREE_WS, "test", (status) => status === "exited");
		const ended = executionOf(WORKTREE_WS, "test");
		expect(ended?.exitCode).toBe(7);
		const output = readRunOutput(WORKTREE_WS, "test", ended?.runId, 100_000)?.text ?? "";
		expect(output).toContain("$ echo PREPARED_$THINKRAIL_RUN_TARGET");
		expect(output).toContain("PREPARED_test");
		expect(output).toContain("TESTED");
		expect(output.indexOf("PREPARED_test")).toBeLessThan(output.indexOf("TESTED"));
		expect(loadRun().lastRuns[WORKTREE_WS]?.test).toMatchObject({ status: "exited", exitCode: 7 });
	},
	TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"a serve target leases its port, becomes listening, and stops by intent",
	async () => {
		const server = `${shellQuote(process.execPath)} -e ${shellQuote(
			'Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response("ok") }); setInterval(() => {}, 1000);',
		)}`;
		const serving: RunRecipe = {
			...recipe,
			targets: [
				{
					id: "dev",
					command: server,
					kind: "serve",
					ports: ["PORT"],
					url: `http://localhost:\${PORT}/`,
				},
			],
		};
		setRecipe(PROJECT, serving, 1, "user");
		const started = await startRun(DEFAULT_WS, "dev", { origin: "user" });
		expect(started.url).toBe(`http://localhost:${started.ports.PORT}/`);
		await waitForStatus(DEFAULT_WS, "dev", (status) => status === "listening");

		const stopped = stopRun(DEFAULT_WS, "dev");
		expect(stopped.status).toBe("stopping");
		await waitForStatus(DEFAULT_WS, "dev", (status) => status === "stopped");
		expect(executionOf(DEFAULT_WS, "dev")?.exitCode).toBeNull();
		expect(() => stopRun(DEFAULT_WS, "dev")).toThrow("not running");
	},
	TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"a second start of a live target is refused and restart replaces it under the same tab",
	async () => {
		const first = await startRun(WORKTREE_WS, "dev", { origin: "user" });
		await waitForOutput(WORKTREE_WS, "dev", "SERVING_5174");
		await expect(startRun(WORKTREE_WS, "dev", { origin: "agent" })).rejects.toMatchObject({
			code: "RUN_ALREADY_RUNNING",
		});

		const second = await restartRun(WORKTREE_WS, "dev", { origin: "agent" });
		expect(second.runId).not.toBe(first.runId);
		expect(second.origin).toBe("agent");
		expect(listTerminals(WORKTREE_WS)).toHaveLength(1);
		await waitForOutput(WORKTREE_WS, "dev", "SERVING_5174");
		expect(readRunOutput(WORKTREE_WS, "dev", first.runId, 100_000)?.text).toContain("SERVING_5174");
		expect(listRunState(WORKTREE_WS).executions).toHaveLength(1);
	},
	TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"the Default workspace keeps the natural port while a worktree gets the next one, and leases persist",
	async () => {
		await startRun(DEFAULT_WS, "dev", { origin: "user" });
		await startRun(WORKTREE_WS, "dev", { origin: "user" });
		expect(executionOf(DEFAULT_WS, "dev")?.ports).toEqual({ PORT: 5173 });
		expect(executionOf(WORKTREE_WS, "dev")?.ports).toEqual({ PORT: 5174 });
		expect(getProjectRun(PROJECT).ports).toEqual({
			[DEFAULT_WS]: { PORT: 5173 },
			[WORKTREE_WS]: { PORT: 5174 },
		});

		await expect(startRun(WORKTREE_WS, "test", { origin: "user" })).resolves.toMatchObject({
			ports: { PORT: 5174 },
		});
	},
	TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"concurrent starts in two workspaces during a slow prepare get distinct ports, and one workspace prepares one run at a time",
	async () => {
		setRecipe(
			PROJECT,
			{
				...recipe,
				prepare: [
					"echo PREPARE_START_$THINKRAIL_RUN_TARGET; sleep 0.7; echo PREPARE_END_$THINKRAIL_RUN_TARGET",
				],
			},
			1,
			"user",
		);
		const [a, b] = await Promise.all([
			startRun(DEFAULT_WS, "test", { origin: "user" }),
			startRun(WORKTREE_WS, "test", { origin: "user" }),
		]);
		expect(new Set([a.ports.PORT, b.ports.PORT]).size).toBe(2);

		// The worktree's `test` is still preparing: `dev` may only spawn once that prepare is over.
		const dev = await startRun(WORKTREE_WS, "dev", { origin: "user" });
		expect(dev.status).toBe("starting");
		const testOutputAtDevSpawn = readRunOutput(WORKTREE_WS, "test", undefined, 100_000)?.text ?? "";
		expect(testOutputAtDevSpawn).toContain("PREPARE_END_test");
		await waitForOutput(WORKTREE_WS, "dev", "PREPARE_START_dev");
	},
	TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"an unknown target, a missing recipe and a removed workspace are refused with codes",
	async () => {
		await expect(startRun(WORKTREE_WS, "nope", { origin: "user" })).rejects.toMatchObject({
			code: "RUN_TARGET_UNKNOWN",
		});
		await startRun(WORKTREE_WS, "dev", { origin: "user" });
		await waitForOutput(WORKTREE_WS, "dev", "SERVING");
		await stopWorkspaceRuns(WORKTREE_WS, { force: true });
		expect(executionOf(WORKTREE_WS, "dev")?.status).toBe("stopped");
		await expect(startRun(WORKTREE_WS, "dev", { origin: "user" })).rejects.toThrow("removed");
		forgetWorkspaceRuns(WORKTREE_WS);
		expect(listRunState(WORKTREE_WS).executions).toEqual([]);
		expect(loadRun().ports[WORKTREE_WS]).toBeUndefined();
	},
	TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"a recipe edit during a run leaves the live execution alone and applies to the next start",
	async () => {
		await startRun(WORKTREE_WS, "dev", { origin: "user" });
		await waitForStatus(WORKTREE_WS, "dev", (status) => status === "running");
		setRecipe(
			PROJECT,
			{
				...recipe,
				targets: [{ id: "dev", command: "echo CHANGED", kind: "task" }],
				primary: "dev",
			},
			1,
			"user",
		);
		expect(executionOf(WORKTREE_WS, "dev")?.status).toBe("running");
		stopRun(WORKTREE_WS, "dev", { force: true });
		await waitForStatus(WORKTREE_WS, "dev", (status) => status === "stopped");
		await startRun(WORKTREE_WS, "dev", { origin: "user" });
		await waitForStatus(WORKTREE_WS, "dev", (status) => status === "exited");
		expect(readRunOutput(WORKTREE_WS, "dev", undefined, 100_000)?.text).toContain("CHANGED");
	},
	TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"an interrupted run is reconstructed after a restart as ended with an unknown outcome",
	async () => {
		await startRun(WORKTREE_WS, "dev", { origin: "user" });
		await waitForOutput(WORKTREE_WS, "dev", "SERVING");
		expect(loadRun().lastRuns[WORKTREE_WS]?.dev?.status).toBe("interrupted");

		// A crash never reports an end: drop the run module first, then the terminals.
		resetRunState();
		resetTerminalState();
		const revived = executionOf(WORKTREE_WS, "dev");
		expect(revived?.status).toBe("exited");
		expect(revived?.exitCode).toBeNull();
		expect(revived?.endedAt).toBeDefined();
	},
	TIMEOUT_MS,
);
