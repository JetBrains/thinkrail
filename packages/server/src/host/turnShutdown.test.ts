import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { PiEvent } from "@thinkrail/contracts";
import {
	configurePiRuntime,
	configurePiRuntimeFactory,
	createSession,
	getSessionWorkspaceId,
	promptSession,
	removeSession,
	setSessionManagerFactory,
	setSessionPublisher,
	toWireModel,
} from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import * as git from "../git";
import { loadTurns, saveWorkspaces } from "../persistence";
import { resetConfigCache } from "../settings";
import { listTurns, setTurnPublisher, TurnTracker } from "../turns";
import { getWorkspace } from "../workspaces";
import { createServer, type RunningServer } from "./server";

const saved = {
	THINKRAIL_DATA_DIR: process.env.THINKRAIL_DATA_DIR,
	PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
	PI_OFFLINE: process.env.PI_OFFLINE,
};
let directory: string;
let repo: string;
let server: RunningServer | undefined;

function sh(...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "ignore", stderr: "pipe" });
	if (!result.success) throw new Error(result.stderr.toString());
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-turn-shutdown-"));
	process.env.THINKRAIL_DATA_DIR = join(directory, "data");
	process.env.PI_CODING_AGENT_DIR = join(directory, "pi");
	process.env.PI_OFFLINE = "1";
	repo = join(directory, "repo");
	mkdirSync(repo);
	sh("init", "-b", "main");
	sh("config", "user.email", "t@thinkrail.test");
	sh("config", "user.name", "test");
	sh("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	sh("add", "-A");
	sh("commit", "-m", "init");
	saveWorkspaces([
		{
			id: "w1",
			projectId: "p1",
			kind: "default",
			name: "repo",
			branch: "main",
			baseBranch: "main",
			worktreePath: repo,
		},
	]);
	resetConfigCache();
	await resetJbcentralStateForTests();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
});

afterEach(async () => {
	await server?.shutdown();
	server = undefined;
	setSessionPublisher(() => {});
	setTurnPublisher(() => {});
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	resetAnalyticsForTests();
	resetConfigCache();
	await resetJbcentralStateForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	rmSync(directory, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test.each([
	"removeSession",
	"shutdown",
] as const)("%s preserves a completed prompt's still-recording turn receipt", async (teardown) => {
	const baseReady = Promise.withResolvers<void>();
	const releaseHead = Promise.withResolvers<void>();
	const trees: (string | null)[] = [];
	const realSnapshot = git.snapshotWorktree;
	const snapshotSpy = spyOn(git, "snapshotWorktree").mockImplementation(async (cwd) => {
		const tree = await realSnapshot(cwd);
		trees.push(tree);
		if (trees.length === 1) baseReady.resolve();
		else await releaseHead.promise;
		return tree;
	});
	const realObserve = TurnTracker.prototype.observe;
	let recording: Promise<void> | undefined;
	const observeSpy = spyOn(TurnTracker.prototype, "observe").mockImplementation(function (
		this: TurnTracker,
		sessionId: string,
		event: PiEvent,
	) {
		const job = realObserve.call(this, sessionId, event);
		if (event.type === "agent_settled") recording = job;
		return job;
	});
	try {
		const model = {
			id: "turn-shutdown",
			name: "Turn shutdown",
			reasoning: false,
			input: ["text"] as ("text" | "image")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		};
		const faux = createFauxCore({
			provider: "turn-shutdown",
			api: "turn-shutdown",
			models: [model],
			tokensPerSecond: 2000,
		});
		faux.setResponses([
			async () => {
				await baseReady.promise;
				return fauxAssistantMessage(
					fauxToolCall("write", {
						path: join(repo, "feature.ts"),
						content: "export const feature = true;\n",
					}),
				);
			},
			fauxAssistantMessage("Done"),
		]);
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		});
		runtime.registerProvider("turn-shutdown", {
			api: faux.api,
			baseUrl: "http://faux.local",
			apiKey: "faux",
			streamSimple: faux.streamSimple,
			models: [{ ...model, api: faux.api }],
		});
		configurePiRuntime(null);
		configurePiRuntimeFactory(async () => runtime);
		server = await createServer({ port: 0, analytics: { mute: true } });
		const { sessionId } = await createSession({
			cwd: repo,
			workspaceId: "w1",
			model: toWireModel(faux.getModel()),
		});
		await promptSession(sessionId, "Write feature.ts");
		expect(recording).toBeDefined();
		expect(listTurns("w1")).toEqual([]);
		if (teardown === "removeSession") {
			await removeSession(sessionId);
			expect(getSessionWorkspaceId(sessionId)).toBeUndefined();
		} else {
			const closing = server.shutdown();
			expect(server.shutdown()).toBe(closing);
			expect(
				await Promise.race([closing.then(() => "closed"), Bun.sleep(25).then(() => "recording")]),
			).toBe("recording");
		}
		releaseHead.resolve();
		if (teardown === "shutdown") await server.shutdown();
		else await recording;

		expect(trees).toHaveLength(2);
		expect(trees[0]).not.toBeNull();
		expect(trees[1]).not.toBeNull();
		expect(trees[0]).not.toBe(trees[1]);
		expect(getWorkspace("w1").worktreePath).toBe(repo);
		const turns = listTurns("w1");
		expect(turns).toHaveLength(1);
		expect(turns[0]).toMatchObject({ sessionId, workspaceId: "w1" });
		expect(turns[0]?.changes.map((change) => change.path)).toEqual(["feature.ts"]);
		expect(loadTurns().byWorkspace.w1).toEqual(turns);
	} finally {
		releaseHead.resolve();
		await recording;
		snapshotSpy.mockRestore();
		observeSpy.mockRestore();
	}
});
