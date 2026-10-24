import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionUIContext,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createAskUserQuestionExtension } from "../index.ts";

const PROVIDER = "faux-ask";
const MODEL = "faux-ask-model";
const model = {
	id: MODEL,
	name: MODEL,
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: PROVIDER,
	api: PROVIDER,
	models: [model],
	tokensPerSecond: 100_000,
});

const args = {
	questions: [
		{
			question: "Which library?",
			header: "Lib",
			options: [
				{ label: "date-fns", description: "small" },
				{ label: "luxon", description: "rich" },
			],
		},
	],
};

let root: string;
let priorAgentDir: string | undefined;
const sessions: AgentSession[] = [];

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-ask-session-"));
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(root, "agent-"));
});

afterAll(() => {
	for (const session of sessions) session.dispose();
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	rmSync(root, { recursive: true, force: true });
});

function uiContext(provided: Partial<ExtensionUIContext>): ExtensionUIContext {
	return new Proxy(provided, {
		get: (target, key) =>
			key in target ? target[key as keyof ExtensionUIContext] : () => undefined,
	}) as ExtensionUIContext;
}

async function openSession(ui: Partial<ExtensionUIContext>): Promise<AgentSession> {
	const modelRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	modelRuntime.registerProvider(PROVIDER, {
		api: faux.api,
		baseUrl: "http://faux-ask.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	const cwd = mkdtempSync(join(root, "cwd-"));
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? cwd;
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [createAskUserQuestionExtension()],
	});
	await resourceLoader.reload();
	const fauxModel = modelRuntime.getModel(PROVIDER, MODEL);
	if (!fauxModel) throw new Error("the faux model is not registered");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		model: fauxModel,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
		resourceLoader,
	});
	sessions.push(session);
	await session.bindExtensions({ mode: "rpc", uiContext: uiContext(ui) });
	return session;
}

const askTurn = (extra: ReturnType<typeof fauxToolCall>[] = []) =>
	fauxAssistantMessage([...extra, fauxToolCall("ask_user_question", args, { id: "ask-1" })], {
		stopReason: "toolUse",
	});

describe("ask_user_question in a real pi session", () => {
	test("an answer goes back to the model and the run continues", async () => {
		faux.setResponses([askTurn(), fauxAssistantMessage("Going with luxon.")]);
		const calls = faux.state.callCount;
		const session = await openSession({ select: async (_title, choices) => choices[1] });
		await session.prompt("Pick a date library.");
		expect(faux.state.callCount - calls).toBe(2);
		const result = session.messages.find((message) => message.role === "toolResult");
		expect(JSON.stringify(result?.content)).toContain('\\"Which library?\\"=\\"luxon\\"');
		const last = session.messages.at(-1);
		expect(last?.role).toBe("assistant");
	});

	test("choosing to chat ends the run without another model call", async () => {
		faux.setResponses([askTurn(), fauxAssistantMessage("should not be requested")]);
		const calls = faux.state.callCount;
		const session = await openSession({ select: async (_title, choices) => choices.at(-1) });
		await session.prompt("Pick a date library.");
		expect(faux.state.callCount - calls).toBe(1);
		const last = session.messages.at(-1);
		expect(last?.role).toBe("toolResult");
		expect(last?.role === "toolResult" && last.details).toEqual({ kind: "ack" });
	});

	test("sibling tool calls of an ask are dropped from the stored assistant message", async () => {
		faux.setResponses([
			askTurn([fauxToolCall("read", { path: "README.md" }, { id: "read-1" })]),
			fauxAssistantMessage("ok"),
		]);
		const session = await openSession({ select: async (_title, choices) => choices[0] });
		await session.prompt("Pick a date library.");
		const assistant = session.messages.find((message) => message.role === "assistant");
		const calls =
			assistant?.role === "assistant"
				? assistant.content.filter((block) => block.type === "toolCall").map((block) => block.id)
				: [];
		expect(calls).toEqual(["ask-1"]);
	});
});
