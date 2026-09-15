import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider, envApiKeyAuth, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { TODO_NUDGE_PREFIX, type WsResult } from "@thinkrail/contracts";
import {
	activatePiRuntimeGeneration,
	configurePiRuntime,
	configurePiRuntimeFactory,
	disposeAllSessions,
	getSessionRuntimeGeneration,
	isSessionStreaming,
	preparePiRuntimeGeneration,
	setSessionCreatedPublisher,
	setSessionManagerFactory,
	setSessionPublisher,
	toWireModel,
	usePiRuntime,
} from "../agent";
import { initializeAnalytics, resetAnalyticsForTests, shutdownAnalytics } from "../analytics";
import { saveWorkspaces } from "../persistence";
import { resetConfigCache } from "../settings";
import { handleRequest } from "./handlers";
import { runObservation } from "./runAnalytics";

const PRIVATE = "private-auth-attribution";
const context = { clientKey: `${PRIVATE}-client` };
const workspaceId = `${PRIVATE}-workspace`;
const saved = {
	THINKRAIL_DATA_DIR: process.env.THINKRAIL_DATA_DIR,
	PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
	PI_OFFLINE: process.env.PI_OFFLINE,
};
let directory: string;
let credentials: InMemoryCredentialStore;
let runtime: ModelRuntime;
let faux: ReturnType<typeof createFauxCore>;
let events: { event: string; properties: Record<string, unknown> }[];
let outgoing: string[];
let sessionIds: string[];
let unexpectedAuthCalls: string[];

async function addFauxProvider(
	target: ModelRuntime,
	store: InMemoryCredentialStore,
	providerId: string,
	authMethod: "api_key" | "subscription" | "oauth",
) {
	await store.modify(providerId, async () =>
		authMethod === "api_key"
			? { type: "api_key", key: `${PRIVATE}-api-key` }
			: {
					type: "oauth",
					access: `${PRIVATE}-access-token`,
					refresh: `${PRIVATE}-refresh-token`,
					expires: Date.now() + 86_400_000,
				},
	);
	const core = createFauxCore({
		provider: providerId,
		api: `${PRIVATE}-api`,
		models: [{ id: `${PRIVATE}-model`, name: `${PRIVATE}-model-label` }],
		tokensPerSecond: 2_000,
	});
	core.setResponses([fauxAssistantMessage("Complete")]);
	target.registerNativeProvider(
		createProvider({
			id: providerId,
			name: `${PRIVATE}-provider-label`,
			auth: {
				apiKey: envApiKeyAuth(`${PRIVATE}-key-label`, []),
				oauth: {
					name: `${PRIVATE}-oauth-label`,
					isSubscription: authMethod !== "oauth",
					login: async () => {
						unexpectedAuthCalls.push("login");
						throw new Error("Preconfigured credentials must not log in");
					},
					refresh: async () => {
						unexpectedAuthCalls.push("refresh");
						throw new Error("Valid credentials must not refresh");
					},
					toAuth: async (credential) => ({ apiKey: credential.access }),
				},
			},
			models: core.models,
			api: { stream: core.stream, streamSimple: core.streamSimple },
		}),
	);
	if (authMethod === "api_key") await target.setRuntimeApiKey(providerId, `${PRIVATE}-api-key`);
	await target.refresh({ allowNetwork: false });
	return core;
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-auth-attribution-"));
	process.env.THINKRAIL_DATA_DIR = directory;
	process.env.PI_CODING_AGENT_DIR = join(directory, "pi");
	process.env.PI_OFFLINE = "1";
	events = [];
	outgoing = [];
	sessionIds = [];
	unexpectedAuthCalls = [];
	resetConfigCache();
	runObservation.reset();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	setSessionCreatedPublisher(() => {});
	setSessionPublisher(({ sessionId, event }) => runObservation.observe(sessionId, event));
	credentials = new InMemoryCredentialStore();
	runtime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	faux = await addFauxProvider(runtime, credentials, "anthropic", "api_key");
	configurePiRuntime(runtime);
	saveWorkspaces([
		{
			id: workspaceId,
			projectId: `${PRIVATE}-project`,
			kind: "default",
			name: `${PRIVATE}-workspace-label`,
			branch: "main",
			baseBranch: "main",
			worktreePath: directory,
		},
	]);
	initializeAnalytics({
		additionalEnabled: false,
		env: {},
		fetchImpl: ((url: Parameters<typeof fetch>[0], init?: RequestInit) => {
			outgoing.push(String(url), JSON.stringify(init));
			events.push(...JSON.parse(String(init?.body)).batch);
			return Promise.resolve(new Response("{}"));
		}) as typeof fetch,
	});
});

afterEach(async () => {
	disposeAllSessions();
	await shutdownAnalytics();
	resetAnalyticsForTests();
	runObservation.reset();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	setSessionCreatedPublisher(() => {});
	setSessionPublisher(() => {});
	resetConfigCache();
	rmSync(directory, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	expect(unexpectedAuthCalls).toEqual([]);
	const payload = outgoing.join("\n");
	for (const value of [PRIVATE, directory, ...sessionIds]) expect(payload).not.toContain(value);
	expect(
		events.some(({ event }) => event === "provider_login" || event.startsWith("agent_run_")),
	).toBe(false);
});

async function createChat(provider = faux): Promise<string> {
	const created = (await handleRequest(
		"session.create",
		{ workspaceId, model: toWireModel(provider.getModel()) },
		context,
	)) as WsResult<"session.create">;
	sessionIds.push(created.sessionId);
	return created.sessionId;
}

function properties(name: string) {
	return events.filter(({ event }) => event === name).map(({ properties }) => properties);
}

test("preconfigured API-key chats and accepted prompt, steer and follow-up sends report auth without optional consent", async () => {
	const sessionId = await createChat();
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	faux.setResponses([
		async () => {
			started.resolve();
			await release.promise;
			return fauxAssistantMessage("Complete");
		},
		fauxAssistantMessage("Steered"),
		fauxAssistantMessage("Followed up"),
	]);
	const prompt = handleRequest("session.prompt", { sessionId, text: `${PRIVATE}-prompt` }, context);
	try {
		await started.promise;
		expect(isSessionStreaming(sessionId)).toBe(true);
		for (const method of ["session.steer", "session.followUp"]) {
			expect(
				await handleRequest(method, { sessionId, text: `${PRIVATE}-${method}` }, context),
			).toEqual({ ok: true });
		}
	} finally {
		release.resolve();
		await prompt;
	}
	await shutdownAnalytics();
	expect(properties("chat_started")).toMatchObject([
		{ provider: "anthropic", model: "custom", auth_method: "api_key" },
	]);
	expect(properties("message_sent")).toMatchObject([
		{ mode: "steer", provider: "anthropic", auth_method: "api_key" },
		{ mode: "follow_up", provider: "anthropic", auth_method: "api_key" },
		{ mode: "prompt", provider: "anthropic", auth_method: "api_key" },
	]);
	expect(events.map(({ event }) => event)).toEqual([
		"app_started",
		"chat_started",
		"message_sent",
		"message_sent",
		"message_sent",
	]);
	expect(faux.state.callCount).toBe(3);
});

test("unmodified builtin providers report preconfigured stored keys without an in-app login", async () => {
	const builtinCredentials = new InMemoryCredentialStore();
	await builtinCredentials.modify("anthropic", async () => ({
		type: "api_key",
		key: `${PRIVATE}-stored-key`,
	}));
	const builtinRuntime = await ModelRuntime.create({
		credentials: builtinCredentials,
		modelsPath: null,
		allowModelNetwork: false,
	});
	configurePiRuntime(builtinRuntime);
	const model = builtinRuntime.getModels("anthropic")[0];
	if (!model) throw new Error("builtin fixture model missing");
	const created = (await handleRequest(
		"session.create",
		{ workspaceId, model: toWireModel(model) },
		context,
	)) as WsResult<"session.create">;
	sessionIds.push(created.sessionId);
	await shutdownAnalytics();
	expect(properties("chat_started")).toMatchObject([
		{ provider: "anthropic", auth_method: "api_key" },
	]);
	expect(properties("message_sent")).toEqual([]);
});

test("model changes affect later sends but not provider/auth captured before a delayed acknowledgement", async () => {
	const alternate = await addFauxProvider(runtime, credentials, `${PRIVATE}-provider`, "oauth");
	const sessionId = await createChat();
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	faux.setResponses([
		async () => {
			started.resolve();
			await release.promise;
			return fauxAssistantMessage("Complete");
		},
	]);
	let acknowledged = false;
	const prompt = handleRequest(
		"session.prompt",
		{ sessionId, text: `${PRIVATE}-before` },
		context,
	).then((result) => {
		acknowledged = true;
		return result;
	});
	try {
		await started.promise;
		expect(
			await handleRequest(
				"session.setModel",
				{ sessionId, model: toWireModel(alternate.getModel()) },
				context,
			),
		).toEqual({ ok: true });
		expect(acknowledged).toBe(false);
	} finally {
		release.resolve();
		await prompt;
	}
	await handleRequest("session.followUp", { sessionId, text: `${PRIVATE}-after` }, context);
	await shutdownAnalytics();
	expect(properties("chat_started")).toMatchObject([
		{ provider: "anthropic", model: "custom", auth_method: "api_key" },
	]);
	expect(properties("message_sent")).toMatchObject([
		{ mode: "prompt", provider: "anthropic", auth_method: "api_key" },
		{ mode: "follow_up", provider: "custom", auth_method: "oauth" },
	]);
	expect(alternate.state.callCount).toBe(1);
});

test("retained sessions keep their generation's API-key auth when new same-provider chats use a subscription", async () => {
	const retainedId = await createChat();
	const retainedGeneration = getSessionRuntimeGeneration(retainedId);
	const nextCredentials = new InMemoryCredentialStore();
	const nextRuntime = await ModelRuntime.create({
		credentials: nextCredentials,
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const nextFaux = await addFauxProvider(nextRuntime, nextCredentials, "anthropic", "subscription");
	configurePiRuntimeFactory(async () => nextRuntime);
	const candidate = await preparePiRuntimeGeneration([]);
	if (candidate.outcome !== "prepared") throw new Error("Candidate was not prepared");
	activatePiRuntimeGeneration(candidate.generation);
	const newId = await createChat(nextFaux);
	expect(await usePiRuntime((current) => current === nextRuntime)).toBe(true);
	expect(getSessionRuntimeGeneration(retainedId)).toBe(retainedGeneration);
	expect(getSessionRuntimeGeneration(newId)).toBe(candidate.generation);
	await handleRequest("session.prompt", { sessionId: retainedId, text: `${PRIVATE}-old` }, context);
	await handleRequest("session.prompt", { sessionId: newId, text: `${PRIVATE}-new` }, context);
	await shutdownAnalytics();
	expect(properties("chat_started")).toMatchObject([
		{ provider: "anthropic", model: "custom", auth_method: "api_key" },
		{ provider: "anthropic", model: "custom", auth_method: "subscription" },
	]);
	expect(properties("message_sent")).toMatchObject([
		{ mode: "prompt", provider: "anthropic", auth_method: "api_key" },
		{ mode: "prompt", provider: "anthropic", auth_method: "subscription" },
	]);
	expect(faux.state.callCount).toBe(1);
	expect(nextFaux.state.callCount).toBe(1);
});

test("accepted TODO nudges and rejected sends do not emit message events", async () => {
	const sessionId = await createChat();
	faux.setResponses([
		fauxAssistantMessage("Complete"),
		fauxAssistantMessage("Complete"),
		fauxAssistantMessage("Complete"),
	]);
	const methods = ["session.prompt", "session.steer", "session.followUp"];
	for (const method of methods) {
		expect(
			await handleRequest(
				method,
				{ sessionId, text: `${TODO_NUDGE_PREFIX}${PRIVATE}-control` },
				context,
			),
		).toEqual({ ok: true });
	}
	await handleRequest("session.dispose", { sessionId }, context);
	for (const method of methods) {
		await expect(
			handleRequest(method, { sessionId, text: `${PRIVATE}-rejected` }, context),
		).rejects.toThrow("Unknown session");
	}
	await shutdownAnalytics();
	expect(properties("message_sent")).toEqual([]);
	expect(events.map(({ event }) => event)).toEqual(["app_started", "chat_started"]);
});
