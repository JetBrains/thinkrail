import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getCurrentTools,
	InMemoryCredentialStore,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	createSession,
	disposeAllSessions,
	listLiveSessionRefs,
	promptSession,
	reloadSessionsForHostExtensions,
	removeSession,
	setSessionManagerFactory,
	setSessionPublisher,
	toWireModel,
} from "./agentSessionManager";
import { setHostExtensionFactorySource } from "./hostExtensions";
import { configurePiRuntime } from "./piRuntime";

const faux = createFauxCore({
	provider: "faux-host-ext",
	api: "faux-host-ext",
	models: [
		{
			id: "faux-host-ext",
			name: "faux-host-ext",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
	tokensPerSecond: 2000,
});

let factories: ExtensionFactory[] = [];
let bridgeRuns = 0;
const dirs: string[] = [];
const tmp = (prefix: string) => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
};

const probeTool: ExtensionFactory = (pi) => {
	pi.registerTool({
		name: "ext_probe",
		label: "Probe",
		description: "probe tool from a host extension",
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
	});
};

const counting: ExtensionFactory = () => {
	bridgeRuns++;
};

const probeState = (tools: { name: string }[]) =>
	tools.some((tool) => tool.name === "ext_probe") ? "PROBE_ON" : "PROBE_OFF";

const until = async (check: () => boolean) => {
	for (let i = 0; i < 400 && !check(); i++) await Bun.sleep(5);
	expect(check()).toBe(true);
};

let priorAgentDir: string | undefined;
let priorOffline: string | undefined;

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmp("trpi-hostext-agentdir-");
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("faux-host-ext", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: faux.models.map((model) => ({ ...model, api: faux.api })),
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory(() => SessionManager.inMemory());
	setSessionPublisher(() => {});
	setHostExtensionFactorySource({ factories: () => [counting, ...factories], onError: () => {} });
});

afterAll(() => {
	setHostExtensionFactorySource(undefined);
	disposeAllSessions();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
});

test("an idle session reloads at once and picks up a host extension's tool", async () => {
	factories = [];
	const { sessionId } = await createSession({
		cwd: tmp("trpi-hostext-idle-"),
		workspaceId: "ws-hostext-idle",
		model: toWireModel(faux.getModel()),
	});
	try {
		expect(listLiveSessionRefs()).toContainEqual({
			sessionId,
			workspaceId: "ws-hostext-idle",
			title: "Chat",
			isStreaming: false,
		});
		const states: string[] = [];
		const record = (context: TranscriptContext) => {
			states.push(probeState(getCurrentTools(context.messages)));
			return fauxAssistantMessage("done");
		};
		faux.setResponses([record]);
		await promptSession(sessionId, "before");

		factories = [probeTool];
		const before = bridgeRuns;
		reloadSessionsForHostExtensions();
		await until(() => bridgeRuns > before);
		faux.setResponses([record]);
		await promptSession(sessionId, "after");
		expect(states).toEqual(["PROBE_OFF", "PROBE_ON"]);
	} finally {
		factories = [];
		await removeSession(sessionId);
	}
});

test("a streaming session reloads only after agent_settled", async () => {
	factories = [];
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started = () => {};
	const requestStarted = new Promise<void>((resolve) => {
		started = resolve;
	});
	const { sessionId } = await createSession({
		cwd: tmp("trpi-hostext-streaming-"),
		workspaceId: "ws-hostext-streaming",
		model: toWireModel(faux.getModel()),
	});
	try {
		faux.setResponses([
			async () => {
				started();
				await gate;
				return fauxAssistantMessage("first");
			},
		]);
		const turn = promptSession(sessionId, "gated");
		await requestStarted;
		const before = bridgeRuns;
		factories = [probeTool];
		reloadSessionsForHostExtensions();
		await Bun.sleep(20);
		expect(bridgeRuns).toBe(before);
		release();
		await turn;
		await until(() => bridgeRuns > before);
	} finally {
		release();
		factories = [];
		await removeSession(sessionId);
	}
});
