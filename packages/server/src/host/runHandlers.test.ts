import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunExecution, RunWorkspaceState, Workspace } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { resetRunState, setRunPublisher } from "../run";
import { resetConfigCache } from "../settings";
import { resetTerminalState, setTerminalPublisher } from "../terminal";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "test-client" };
const PROJECT = "p1";
let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

const recipe = {
	version: 1,
	ports: { PORT: 5173 },
	prepare: [],
	targets: [{ id: "test", command: "echo RAN; exit 2", kind: "task" }],
	primary: "test",
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
	try {
		await promise;
		return undefined;
	} catch (error) {
		return errorCodeOf(error);
	}
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-run-handlers-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	const repo = join(dataDir, "repo");
	mkdirSync(repo);
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: PROJECT, name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws-default",
				projectId: PROJECT,
				kind: "default",
				name: "Default",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
			} satisfies Workspace,
		]),
	);
	setTerminalPublisher(() => "delivered");
	setRunPublisher(null);
});

afterEach(() => {
	resetRunState();
	resetTerminalState();
	setTerminalPublisher(() => "unavailable");
	resetConfigCache();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("run.* handlers validate, version and scope the recipe through the wire", async () => {
	expect(await handleRequest("run.recipe", { projectId: PROJECT }, CTX)).toEqual({
		document: null,
		settings: { autoOpen: false, agentMayRun: true },
		ports: {},
	});
	await expect(handleRequest("run.recipe", { projectId: "nope" }, CTX)).rejects.toThrow(
		"Unknown project",
	);

	const invalid = handleRequest(
		"run.setRecipe",
		{ projectId: PROJECT, recipe: { ...recipe, primary: "dev" }, expectedRevision: 0 },
		CTX,
	);
	expect(await codeOf(invalid)).toBe("RUN_RECIPE_INVALID");
	await expect(
		handleRequest(
			"run.setRecipe",
			{ projectId: PROJECT, recipe: { ...recipe, primary: "dev" }, expectedRevision: 0 },
			CTX,
		),
	).rejects.toThrow("primary: must name one of the targets");

	const saved = (await handleRequest(
		"run.setRecipe",
		{ projectId: PROJECT, recipe, expectedRevision: 0 },
		CTX,
	)) as { document: { revision: number; learnedBy: unknown } };
	expect(saved.document.revision).toBe(1);
	expect(saved.document.learnedBy).toBe("user");
	expect(
		await codeOf(
			handleRequest("run.setRecipe", { projectId: PROJECT, recipe, expectedRevision: 0 }, CTX),
		),
	).toBe("RUN_RECIPE_CONFLICT");
	expect(
		await handleRequest(
			"run.setSettings",
			{ projectId: PROJECT, settings: { agentMayRun: false } },
			CTX,
		),
	).toEqual({ settings: { autoOpen: false, agentMayRun: false } });
});

test.skipIf(process.platform === "win32")(
	"run.start executes in the Default workspace and run.state reports the ended execution",
	async () => {
		await handleRequest("run.setRecipe", { projectId: PROJECT, recipe, expectedRevision: 0 }, CTX);
		await expect(handleRequest("run.state", { workspaceId: "ws-missing" }, CTX)).rejects.toThrow(
			"Unknown workspace",
		);
		expect(
			await codeOf(
				handleRequest("run.start", { workspaceId: "ws-default", targetId: "nope" }, CTX),
			),
		).toBe("RUN_TARGET_UNKNOWN");

		const { execution } = (await handleRequest(
			"run.start",
			{ workspaceId: "ws-default", targetId: "test" },
			CTX,
		)) as { execution: RunExecution };
		expect(execution.ports).toEqual({ PORT: 5173 });
		expect(execution.origin).toBe("user");

		const deadline = Date.now() + 15_000;
		let ended: RunExecution | undefined;
		while (Date.now() < deadline && !ended) {
			const state = (await handleRequest(
				"run.state",
				{ workspaceId: "ws-default" },
				CTX,
			)) as RunWorkspaceState;
			ended = state.executions.find((candidate) => candidate.status === "exited");
			if (!ended) await Bun.sleep(50);
		}
		expect(ended?.exitCode).toBe(2);
		expect(
			await codeOf(handleRequest("run.stop", { workspaceId: "ws-default", targetId: "test" }, CTX)),
		).toBe("RUN_NOT_RUNNING");
	},
	20_000,
);
