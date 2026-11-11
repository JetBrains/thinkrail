import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { defaultSessionDirFor, writeFixtureSession } from "../history/testFixtures";
import {
	createSession,
	disposeAllSessions,
	getSessionMessages,
	listAvailableModels,
	piBranchSelection,
	promptSession,
	setSessionManagerFactory,
	setSessionModel,
	toWireModel,
	usePiRuntime,
} from "./agentSessionManager";
import { refreshModelListings } from "./modelAvailability";
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

const replacementFaux = createFauxCore({
	provider: "replacement-faux",
	api: "replacement-faux",
	models: [modelDef("other-model"), modelDef("replacement-model")],
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

async function runtimeWithReplacement(includeOriginal = false): Promise<ModelRuntime> {
	const runtime = await runtimeWithFaux(includeOriginal);
	runtime.registerProvider("replacement-faux", {
		api: replacementFaux.api,
		baseUrl: "http://replacement-faux.test",
		apiKey: "faux",
		streamSimple: replacementFaux.streamSimple,
		models: ["other-model", "replacement-model"].map((id) => ({
			...modelDef(id),
			api: replacementFaux.api,
		})),
	});
	return runtime;
}

function registerRouter(runtime: ModelRuntime, provider: string, id: string): void {
	runtime.registerVirtualModel({
		provider: "router-faux",
		id: "auto",
		name: "Auto",
		route: () => {
			const model = runtime.getModel(provider, id);
			if (!model) throw new Error(`${provider}/${id} is not registered`);
			return { model, thinkingLevel: "off" };
		},
	});
}

let agentDir: string;
let dataDir: string;
let cwd: string;
let priorAgentDir: string | undefined;
let priorDataDir: string | undefined;
let priorOffline: string | undefined;

beforeEach(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	priorDataDir = process.env.THINKRAIL_DATA_DIR;
	priorOffline = process.env.PI_OFFLINE;
	agentDir = mkdtempSync(join(tmpdir(), "thinkrail-generation-agent-"));
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-generation-data-"));
	cwd = mkdtempSync(join(tmpdir(), "thinkrail-generation-cwd-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = dataDir;
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
	if (priorDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = priorDataDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(dataDir, { recursive: true, force: true });
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

async function reopenAfterTeardown(sessionId: string, workspaceId: string, sessionCwd: string) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await getSessionMessages(sessionId, workspaceId, sessionCwd);
		} catch (error) {
			if (attempt >= 50) throw error;
			await Bun.sleep(10);
		}
	}
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

		await expect(setSessionModel(session.sessionId, model)).resolves.toMatchObject({
			provider: model.provider,
			id: model.id,
		});
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

	test("a disk reattach never sends on a model the user did not choose", async () => {
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		const session = await liveSession();
		disposeAllSessions();
		configurePiRuntime(await runtimeWithReplacement());
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ defaultProvider: "replacement-faux", defaultModel: "replacement-model" }),
		);

		const reopened = await getSessionMessages(session.sessionId, "workspace-generation", cwd);
		expect(JSON.stringify(reopened.messages)).toContain("BEFORE_GENERATION_SWAP");
		expect(reopened.summary.model).toBeNull();
		replacementFaux.setResponses([fauxAssistantMessage("SILENT_FALLBACK")]);
		const callsBefore = replacementFaux.state.callCount;
		await expect(promptSession(session.sessionId, "continue")).rejects.toThrow(
			"The chat's saved model generation-faux/generation-model is unavailable",
		);
		expect(replacementFaux.state.callCount).toBe(callsBefore);
	});

	test("choosing a model for a chat whose saved model is unavailable records the switch", async () => {
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		const session = await liveSession();
		disposeAllSessions();
		configurePiRuntime(await runtimeWithReplacement());
		await getSessionMessages(session.sessionId, "workspace-generation", cwd);

		const chosen = replacementFaux.getModel("replacement-model");
		if (!chosen) throw new Error("replacement model is missing");
		await setSessionModel(session.sessionId, toWireModel(chosen));
		replacementFaux.setResponses([fauxAssistantMessage("AFTER_EXPLICIT_CHOICE")]);
		await promptSession(session.sessionId, "continue on the chosen model");
		const hydrated = await getSessionMessages(session.sessionId, "workspace-generation", cwd);
		expect(JSON.stringify(hydrated.messages)).toContain("AFTER_EXPLICIT_CHOICE");
		expect(hydrated.summary.model).toMatchObject({
			provider: "replacement-faux",
			id: "replacement-model",
		});
		disposeAllSessions();
		const info = (await SessionManager.list(cwd)).find((item) => item.id === session.sessionId);
		if (!info) throw new Error("session was not persisted");
		const reopened = SessionManager.open(info.path);
		expect(reopened.buildSessionContext().model).toEqual({
			provider: "replacement-faux",
			modelId: "replacement-model",
		});
		expect(
			reopened
				.getBranch()
				.some(
					(entry) =>
						entry.type === "model_change" &&
						entry.provider === "replacement-faux" &&
						entry.modelId === "replacement-model",
				),
		).toBe(true);
	});

	test("opening a chat without sending preserves its model when the original provider returns", async () => {
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		const session = await liveSession();
		disposeAllSessions();
		configurePiRuntime(await runtimeWithReplacement());
		const reopened = await getSessionMessages(session.sessionId, "workspace-generation", cwd);
		expect(reopened.summary.model).toBeNull();
		disposeAllSessions();
		configurePiRuntime(await runtimeWithReplacement(true));
		expect(
			(await reopenAfterTeardown(session.sessionId, "workspace-generation", cwd)).summary.model,
		).toMatchObject({
			provider: "generation-faux",
			id: "generation-model",
		});
	});

	test("a disk reattach keeps a registered virtual selection whose last routed model is gone", async () => {
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		const original = await runtimeWithFaux();
		registerRouter(original, "generation-faux", "generation-model");
		configurePiRuntime(original);
		const router = original.getModel("router-faux", "auto");
		if (!router) throw new Error("router is missing");
		faux.setResponses([fauxAssistantMessage("ROUTED_BEFORE_SWAP")]);
		const session = await createSession({
			cwd,
			workspaceId: "workspace-generation",
			model: toWireModel(router),
		});
		await promptSession(session.sessionId, "route this turn");
		disposeAllSessions();
		const replacement = await runtimeWithReplacement();
		registerRouter(replacement, "replacement-faux", "replacement-model");
		configurePiRuntime(replacement);

		const reopened = await getSessionMessages(session.sessionId, "workspace-generation", cwd);
		expect(reopened.summary.model).toMatchObject({ provider: "router-faux", id: "auto" });
		replacementFaux.setResponses([fauxAssistantMessage("ROUTED_AFTER_SWAP")]);
		await promptSession(session.sessionId, "continue through the router");
		expect(
			JSON.stringify(
				(await getSessionMessages(session.sessionId, "workspace-generation", cwd)).messages,
			),
		).toContain("ROUTED_AFTER_SWAP");
	});

	test("the restored selection mirrors pi's virtual-aware branch selection", async () => {
		const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
		const pi = (await import(join(piDist, "core", "virtual-models.js"))) as {
			getBranchSelection: typeof piBranchSelection;
		};
		const runtime = await runtimeWithFaux();
		registerRouter(runtime, "generation-faux", "generation-model");
		const getModel = (provider: string, id: string) => runtime.getModel(provider, id);
		type Step = (manager: SessionManager) => void;
		const change =
			(provider: string, modelId: string): Step =>
			(manager) => {
				manager.appendModelChange(provider, modelId);
			};
		const reply =
			(provider: string, model: string, api: string = faux.api): Step =>
			(manager) => {
				manager.appendMessage({ ...fauxAssistantMessage("reply"), provider, model, api });
			};
		const routed = reply("generation-faux", "generation-model");
		const cases: [Step[], { provider: string; modelId: string } | undefined][] = [
			[[], undefined],
			[[change("router-faux", "auto"), routed], { provider: "router-faux", modelId: "auto" }],
			[
				[change("router-faux", "gone"), routed],
				{ provider: "generation-faux", modelId: "generation-model" },
			],
			[
				[change("generation-faux", "generation-model"), reply("other-faux", "other-model")],
				{ provider: "other-faux", modelId: "other-model" },
			],
			[[routed, change("router-faux", "gone")], { provider: "router-faux", modelId: "gone" }],
			[
				[change("router-faux", "auto"), routed, reply("router-faux", "auto", "pi-virtual")],
				{ provider: "router-faux", modelId: "auto" },
			],
		];
		for (const [steps, expected] of cases) {
			const manager = SessionManager.inMemory(cwd);
			for (const step of steps) step(manager);
			const branch = manager.getBranch();
			expect(piBranchSelection(branch, getModel)).toEqual(expected);
			expect(pi.getBranchSelection(branch, getModel)).toEqual(expected);
		}
	});

	test("a disk reattach does not swap a persisted model the account no longer serves", async () => {
		const listed = createFauxCore({
			provider: "listed-faux",
			api: "openai-responses",
			models: [modelDef("dropped-model"), modelDef("kept-model")],
			tokensPerSecond: 2_000,
		});
		const proxy = Bun.serve({
			port: 0,
			fetch: () => Response.json({ data: [{ id: "kept-model" }] }),
		});
		try {
			const runtime = await runtimeWithFaux(false);
			runtime.registerProvider("listed-faux", {
				api: "openai-responses",
				baseUrl: `http://127.0.0.1:${proxy.port}/v1`,
				apiKey: "faux",
				streamSimple: listed.streamSimple,
				models: ["dropped-model", "kept-model"].map((id) => ({
					...modelDef(id),
					api: "openai-responses",
				})),
			});
			configurePiRuntime(runtime);
			setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
			listed.setResponses([fauxAssistantMessage("BEFORE_LISTING")]);
			const session = await createSession({
				cwd,
				workspaceId: "workspace-generation",
				model: toWireModel(listed.getModel()),
			});
			await promptSession(session.sessionId, "persist this turn");
			disposeAllSessions();

			expect(await refreshModelListings(runtime, new Set(["listed-faux"]))).toBe(true);

			const reopened = await reopenAfterTeardown(session.sessionId, "workspace-generation", cwd);
			expect(reopened.summary.model).toBeNull();
			await expect(promptSession(session.sessionId, "continue")).rejects.toThrow(
				"The chat's saved model listed-faux/dropped-model is unavailable",
			);
		} finally {
			proxy.stop(true);
		}
	});

	test("a disk transcript stays readable when no model is available", async () => {
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		const session = await liveSession();
		disposeAllSessions();
		configurePiRuntime(await runtimeWithFaux(false));

		const reopened = await getSessionMessages(session.sessionId, "workspace-generation", cwd);
		expect(JSON.stringify(reopened.messages)).toContain("BEFORE_GENERATION_SWAP");
		const info = (await SessionManager.list(cwd)).find((item) => item.id === session.sessionId);
		if (!info) throw new Error("session was not persisted");
		expect(SessionManager.open(info.path).buildSessionContext().model).toEqual({
			provider: "generation-faux",
			modelId: "generation-model",
		});
	});

	test("a transcript saved under a provider pi renamed reattaches to the renamed provider", async () => {
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		});
		runtime.registerProvider("azure", {
			api: faux.api,
			baseUrl: "http://azure.test",
			apiKey: "faux",
			streamSimple: faux.streamSimple,
			models: [{ ...modelDef("azure-deployment"), api: faux.api }],
		});
		configurePiRuntime(runtime);
		const sessionId = `sess-${crypto.randomUUID()}`;
		const dir = defaultSessionDirFor(agentDir, cwd);
		mkdirSync(dir, { recursive: true });
		const at = new Date(1_700_000_000_000).toISOString();
		writeFileSync(
			join(dir, `1700000000000_${sessionId}.jsonl`),
			`${[
				{ type: "session", version: 3, id: sessionId, timestamp: at, cwd },
				{
					type: "model_change",
					id: "model",
					parentId: null,
					timestamp: at,
					provider: "azure-openai-responses",
					modelId: "azure-deployment",
				},
				{
					type: "message",
					id: "user",
					parentId: "model",
					timestamp: at,
					message: { role: "user", content: "azure transcript", timestamp: 1_700_000_000_000 },
				},
			]
				.map((line) => JSON.stringify(line))
				.join("\n")}\n`,
		);

		const hydrated = await getSessionMessages(sessionId, "workspace-generation", cwd);
		expect(JSON.stringify(hydrated.messages)).toContain("azure transcript");
		expect(hydrated.summary.model).toMatchObject({ provider: "azure", id: "azure-deployment" });
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
