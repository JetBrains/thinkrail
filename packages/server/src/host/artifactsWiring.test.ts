import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { WorkspaceArtifactsSnapshot } from "@thinkrail/contracts";
import {
	configurePiRuntime,
	configurePiRuntimeFactory,
	createSession,
	promptSession,
	setSessionManagerFactory,
	setSessionPublisher,
	toWireModel,
} from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { listArtifacts } from "../artifacts";
import { resetJbcentralStateForTests } from "../auth";
import { saveWorkspaces } from "../persistence";
import { resetConfigCache } from "../settings";
import * as watch from "../watch";
import { createServer, type RunningServer } from "./server";

const saved = {
	THINKRAIL_DATA_DIR: process.env.THINKRAIL_DATA_DIR,
	PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
	PI_OFFLINE: process.env.PI_OFFLINE,
};
let directory: string;
let repo: string;
let outside: string;
let server: RunningServer | undefined;

function sh(...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "ignore", stderr: "pipe" });
	if (!result.success) throw new Error(result.stderr.toString());
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-artifacts-wiring-"));
	process.env.THINKRAIL_DATA_DIR = join(directory, "data");
	process.env.PI_CODING_AGENT_DIR = join(directory, "pi");
	process.env.PI_OFFLINE = "1";
	repo = join(directory, "repo");
	outside = mkdtempSync(join(tmpdir(), "thinkrail-artifacts-outside-"));
	mkdirSync(repo);
	sh("init", "-b", "main");
	sh("config", "user.email", "t@thinkrail.test");
	sh("config", "user.name", "test");
	sh("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, ".gitignore"), "out/\n");
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
	mock.restore();
	await server?.shutdown();
	server = undefined;
	setSessionPublisher(() => {});
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	resetAnalyticsForTests();
	resetConfigCache();
	await resetJbcentralStateForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	rmSync(directory, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("an agent run fills the artifact index: its writes, its ignored outputs, and never a temp folder", async () => {
	const model = {
		id: "artifacts",
		name: "Artifacts",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
	const faux = createFauxCore({
		provider: "artifacts",
		api: "artifacts",
		models: [model],
		tokensPerSecond: 2000,
	});
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("write", { path: join(outside, "summary.md"), content: "hello\n" }),
		),
		fauxAssistantMessage(
			fauxToolCall("write", { path: ".thinkrail/context/summary.md", content: "hello\n" }),
		),
		fauxAssistantMessage(
			fauxToolCall("bash", { command: "mkdir -p out && echo built > out/result.txt" }),
		),
		fauxAssistantMessage("Done"),
	]);
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("artifacts", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(null);
	configurePiRuntimeFactory(async () => runtime);
	server = await createServer({ port: 0, analytics: { mute: true } });
	const watched = spyOn(watch, "ensureWatch");
	const { sessionId } = await createSession({
		cwd: repo,
		workspaceId: "w1",
		model: toWireModel(faux.getModel()),
	});
	await promptSession(sessionId, "Save a summary and build");

	let snapshot: WorkspaceArtifactsSnapshot | undefined;
	for (const deadline = Date.now() + 10_000; Date.now() < deadline; await Bun.sleep(50)) {
		snapshot = await listArtifacts("w1");
		if (snapshot.outputs?.length) break;
	}
	expect(existsSync(join(outside, "summary.md"))).toBe(false);
	expect(snapshot?.artifacts).toEqual([
		expect.objectContaining({ path: ".thinkrail/context/summary.md", state: "live", sessionId }),
	]);
	expect(snapshot?.outputs).toEqual([
		expect.objectContaining({ path: "out", kind: "dir", files: 1, sessionId }),
	]);
	expect(watched.mock.calls).toContainEqual(["w1", { prewarm: true }]);
	expect(watched.mock.calls.filter(([, options]) => options?.prewarm !== true)).toEqual([]);
});
