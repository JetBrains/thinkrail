import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { defaultSessionDirFor, writeFixtureSession } from "../history/testFixtures";
import {
	createSession,
	disposeAllSessions,
	getSessionMessages,
	listAvailableModels,
	promptSession,
	reconcilePiRuntimeGeneration,
	resetPiRuntimeReconciliationForTests,
	setSessionManagerFactory,
	toWireModel,
	usePiRuntime,
} from "./agentSessionManager";
import { configurePiRuntime, configurePiRuntimeFactory } from "./piRuntime";

function modelDef(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

const faux = createFauxCore({
	provider: "reconcile-faux",
	api: "reconcile-faux",
	models: [modelDef("reconcile-model")],
	tokensPerSecond: 2_000,
});

async function runtimeWithFaux(includeModel = true): Promise<ModelRuntime> {
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	if (includeModel) {
		runtime.registerProvider("reconcile-faux", {
			api: faux.api,
			baseUrl: "http://reconcile-faux.test",
			apiKey: "faux",
			streamSimple: faux.streamSimple,
			models: [{ ...modelDef("reconcile-model"), api: faux.api }],
		});
	}
	return runtime;
}

let agentDir: string;
let cwd: string;
let priorAgentDir: string | undefined;
let priorOffline: string | undefined;

beforeEach(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	priorOffline = process.env.PI_OFFLINE;
	agentDir = mkdtempSync(join(tmpdir(), "thinkrail-reconcile-agent-"));
	cwd = mkdtempSync(join(tmpdir(), "thinkrail-reconcile-cwd-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	resetPiRuntimeReconciliationForTests();
	configurePiRuntime(await runtimeWithFaux());
	setSessionManagerFactory(() => SessionManager.inMemory(cwd));
});

afterEach(() => {
	disposeAllSessions();
	resetPiRuntimeReconciliationForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

async function liveSession() {
	faux.setResponses([fauxAssistantMessage("BEFORE_RECONCILE")]);
	const session = await createSession({
		cwd,
		workspaceId: "workspace-reconcile",
		model: toWireModel(faux.getModel()),
	});
	await promptSession(session.sessionId, "persist this turn");
	return session;
}

describe("PI runtime generation reconciliation", () => {
	test("reattaches a live transcript under the same id and exact model", async () => {
		const session = await liveSession();
		const candidate = await runtimeWithFaux();
		configurePiRuntimeFactory(async () => candidate);

		const result = await reconcilePiRuntimeGeneration([]);
		expect(result.outcome).toBe("applied");
		const hydrated = await getSessionMessages(session.sessionId, "workspace-reconcile", cwd);
		expect(hydrated.summary.sessionId).toBe(session.sessionId);
		expect(hydrated.summary.model).toMatchObject({
			provider: "reconcile-faux",
			id: "reconcile-model",
		});
		expect(JSON.stringify(hydrated.messages)).toContain("BEFORE_RECONCILE");
		expect(await usePiRuntime((runtime) => runtime === candidate)).toBe(true);
	});

	test("a disk reattach rejects a missing persisted model instead of accepting PI fallback", async () => {
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		const session = await liveSession();
		disposeAllSessions();
		configurePiRuntime(await runtimeWithFaux(false));

		await expect(getSessionMessages(session.sessionId, "workspace-reconcile", cwd)).rejects.toThrow(
			"The chat's saved model is unavailable.",
		);
	});

	test("a legacy disk transcript with no persisted model may use the configured default", async () => {
		const fixture = writeFixtureSession(defaultSessionDirFor(agentDir, cwd), {
			cwd,
			messages: [{ role: "user", text: "legacy transcript", timestamp: 1_700_000_000_000 }],
		});

		const hydrated = await getSessionMessages(fixture.id, "workspace-reconcile", cwd);
		expect(hydrated.summary.live).toBe(true);
		expect(JSON.stringify(hydrated.messages)).toContain("legacy transcript");
		expect(hydrated.summary.model).toMatchObject({
			provider: "reconcile-faux",
			id: "reconcile-model",
		});
	});

	test("blocks when an exact persisted model is absent and never activates fallback", async () => {
		const session = await liveSession();
		const oldRuntime = await usePiRuntime((runtime) => runtime);
		const candidate = await runtimeWithFaux(false);
		configurePiRuntimeFactory(async () => candidate);

		expect(await reconcilePiRuntimeGeneration([])).toEqual({
			outcome: "blocked",
			affectedSessionIds: [session.sessionId],
		});
		expect(await usePiRuntime((runtime) => runtime === oldRuntime)).toBe(true);
		const hydrated = await getSessionMessages(session.sessionId, "workspace-reconcile", cwd);
		expect(hydrated.summary.model).toMatchObject({
			provider: "reconcile-faux",
			id: "reconcile-model",
		});
	});

	test("candidate construction failure leaves the old generation usable", async () => {
		const session = await liveSession();
		const oldRuntime = await usePiRuntime((runtime) => runtime);
		configurePiRuntimeFactory(async () => {
			throw new Error("synthetic loader diagnostic must not escape");
		});

		expect(await reconcilePiRuntimeGeneration([])).toEqual({
			outcome: "failed",
			reason: "candidate-failed",
		});
		expect(await usePiRuntime((runtime) => runtime === oldRuntime)).toBe(true);
		faux.appendResponses([fauxAssistantMessage("AFTER_FAILED_RECONCILE")]);
		await promptSession(session.sessionId, "still usable");
		const hydrated = await getSessionMessages(session.sessionId, "workspace-reconcile", cwd);
		expect(JSON.stringify(hydrated.messages)).toContain("AFTER_FAILED_RECONCILE");
	});

	test("marks pending, drains accepted work through settlement, then builds the candidate", async () => {
		const session = await liveSession();
		let releaseTurn: (() => void) | undefined;
		const turnRelease = new Promise<void>((resolve) => {
			releaseTurn = resolve;
		});
		faux.appendResponses([
			async () => {
				await turnRelease;
				return fauxAssistantMessage("A deliberately controlled accepted turn");
			},
		]);
		let factoryCalls = 0;
		const candidate = await runtimeWithFaux();
		configurePiRuntimeFactory(async () => {
			factoryCalls += 1;
			return candidate;
		});

		const turn = promptSession(session.sessionId, "finish before applying");
		let pending = false;
		const reconciliation = reconcilePiRuntimeGeneration([], {
			onPending: () => {
				pending = true;
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(pending).toBe(true);
		expect(factoryCalls).toBe(0);
		releaseTurn?.();
		await turn;
		expect((await reconciliation).outcome).toBe("applied");
		expect(factoryCalls).toBe(1);
	});

	test("rejects every new runtime consumer while a candidate boundary is held", async () => {
		let releaseFactory: (() => void) | undefined;
		const factoryRelease = new Promise<void>((resolve) => {
			releaseFactory = resolve;
		});
		let factoryStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			factoryStarted = resolve;
		});
		const candidate = await runtimeWithFaux();
		configurePiRuntimeFactory(async () => {
			factoryStarted?.();
			await factoryRelease;
			return candidate;
		});

		const reconciliation = reconcilePiRuntimeGeneration([]);
		await started;
		await expect(listAvailableModels()).rejects.toThrow("reconciliation is pending");
		await expect(createSession({ cwd, workspaceId: "blocked-during-boundary" })).rejects.toThrow(
			"reconciliation is pending",
		);
		releaseFactory?.();
		expect((await reconciliation).outcome).toBe("applied");
	});
});
