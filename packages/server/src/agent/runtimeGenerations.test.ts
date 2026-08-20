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
	setSessionManagerFactory,
	setSessionModel,
	toWireModel,
	usePiRuntime,
} from "./agentSessionManager";
import {
	activatePiRuntimeGeneration,
	configurePiRuntime,
	configurePiRuntimeFactory,
	preparePiRuntimeGeneration,
} from "./piRuntime";

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
	provider: "generation-faux",
	api: "generation-faux",
	models: [modelDef("generation-model")],
	tokensPerSecond: 2_000,
});

async function runtimeWithFaux(includeModel = true): Promise<ModelRuntime> {
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	if (includeModel) {
		runtime.registerProvider("generation-faux", {
			api: faux.api,
			baseUrl: "http://generation-faux.test",
			apiKey: "faux",
			streamSimple: faux.streamSimple,
			models: [{ ...modelDef("generation-model"), api: faux.api }],
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
	agentDir = mkdtempSync(join(tmpdir(), "thinkrail-generation-agent-"));
	cwd = mkdtempSync(join(tmpdir(), "thinkrail-generation-cwd-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	configurePiRuntime(await runtimeWithFaux());
	setSessionManagerFactory(() => SessionManager.inMemory(cwd));
});

afterEach(() => {
	disposeAllSessions();
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
	faux.setResponses([fauxAssistantMessage("BEFORE_GENERATION_SWAP")]);
	const session = await createSession({
		cwd,
		workspaceId: "workspace-generation",
		model: toWireModel(faux.getModel()),
	});
	await promptSession(session.sessionId, "persist this turn");
	return session;
}

async function activateRuntime(runtime: ModelRuntime): Promise<void> {
	configurePiRuntimeFactory(async () => runtime);
	const prepared = await preparePiRuntimeGeneration([]);
	if (prepared.outcome !== "prepared") throw new Error("candidate was not prepared");
	activatePiRuntimeGeneration(prepared.generation);
}

describe("PI runtime generations", () => {
	test("publishes a candidate for new work while a live chat retains its old runtime", async () => {
		const session = await liveSession();
		const candidate = await runtimeWithFaux(false);
		await activateRuntime(candidate);

		expect(await usePiRuntime((runtime) => runtime === candidate)).toBe(true);
		expect(await listAvailableModels()).toEqual([]);
		faux.appendResponses([fauxAssistantMessage("AFTER_GENERATION_SWAP")]);
		await promptSession(session.sessionId, "old generation remains usable");
		const hydrated = await getSessionMessages(session.sessionId, "workspace-generation", cwd);
		expect(JSON.stringify(hydrated.messages)).toContain("AFTER_GENERATION_SWAP");
		expect(hydrated.summary.model).toMatchObject({
			provider: "generation-faux",
			id: "generation-model",
		});
	});

	test("resolves live-chat model changes against that chat's retained generation", async () => {
		const session = await liveSession();
		const model = toWireModel(faux.getModel());
		await activateRuntime(await runtimeWithFaux(false));

		await expect(setSessionModel(session.sessionId, model)).resolves.toBeUndefined();
		await expect(createSession({ cwd, workspaceId: "workspace-new", model })).rejects.toThrow(
			"Unknown or unavailable model",
		);
	});

	test("does not wait for an accepted old-generation turn before activating a candidate", async () => {
		const session = await liveSession();
		let releaseTurn: (() => void) | undefined;
		const turnRelease = new Promise<void>((resolve) => {
			releaseTurn = resolve;
		});
		faux.appendResponses([
			async () => {
				await turnRelease;
				return fauxAssistantMessage("OLD_TURN_SETTLED");
			},
		]);
		const turn = promptSession(session.sessionId, "keep running during swap");
		const candidate = await runtimeWithFaux(false);
		await activateRuntime(candidate);
		expect(await usePiRuntime((runtime) => runtime === candidate)).toBe(true);
		releaseTurn?.();
		await turn;
	});

	test("a disk reattach rejects a missing persisted model instead of accepting PI fallback", async () => {
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		const session = await liveSession();
		disposeAllSessions();
		configurePiRuntime(await runtimeWithFaux(false));

		await expect(
			getSessionMessages(session.sessionId, "workspace-generation", cwd),
		).rejects.toThrow("The chat's saved model is unavailable.");
	});

	test("a legacy disk transcript with no persisted model may use the current default", async () => {
		const fixture = writeFixtureSession(defaultSessionDirFor(agentDir, cwd), {
			cwd,
			messages: [{ role: "user", text: "legacy transcript", timestamp: 1_700_000_000_000 }],
		});

		const hydrated = await getSessionMessages(fixture.id, "workspace-generation", cwd);
		expect(hydrated.summary.live).toBe(true);
		expect(JSON.stringify(hydrated.messages)).toContain("legacy transcript");
		expect(hydrated.summary.model).toMatchObject({
			provider: "generation-faux",
			id: "generation-model",
		});
	});

	test("candidate construction failure leaves the current generation unchanged", async () => {
		const current = await usePiRuntime((runtime) => runtime);
		configurePiRuntimeFactory(async () => {
			throw new Error("synthetic loader diagnostic must not escape");
		});

		expect(await preparePiRuntimeGeneration([])).toEqual({
			outcome: "failed",
			reason: "candidate-failed",
		});
		expect(await usePiRuntime((runtime) => runtime === current)).toBe(true);
	});
});
