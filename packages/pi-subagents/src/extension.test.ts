// The extension end to end against REAL sessions — the parent loads the extension through a real
// resource loader, faux providers script both sides (parent on fauxa, background child on fauxb so
// the two response queues never race), and the child runs through the real delegation core.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createDelegationService, type DelegationService } from "pi-delegation";
import { createSubagentsExtension, SUBAGENT_COMPLETION_MESSAGE } from "./extension";

function fauxCore(provider: string) {
	return createFauxCore({
		provider,
		api: provider,
		models: [
			{
				id: provider,
				name: provider,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
		tokensPerSecond: 4000,
	});
}

const fauxA = fauxCore("fauxa");
const fauxB = fauxCore("fauxb");

const tmpDirs: string[] = [];
function tmpDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let runtime: ModelRuntime;
let parent: AgentSession;
let parentCwd: string;
let service: DelegationService;

function registerFaux(core: typeof fauxA, id: string): void {
	runtime.registerProvider(id, {
		api: core.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: core.streamSimple,
		models: [
			{
				id,
				name: id,
				api: core.api,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});
}

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = tmpDir("pi-subagents-agentdir-");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	// A personal definition pinned to the SECOND provider — the background test's child streams
	// from its own queue, so parent/child response order can never race.
	mkdirSync(join(agentDir, "agents"), { recursive: true });
	writeFileSync(
		join(agentDir, "agents", "bg-runner.md"),
		"---\nname: bg-runner\ndescription: Background test runner\nmodel: fauxb\n---\n\nRun the delegated task.\n",
	);

	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	registerFaux(fauxA, "fauxa");
	registerFaux(fauxB, "fauxb");

	parentCwd = tmpDir("pi-subagents-parent-");
	const model = runtime.getModel("fauxa", "fauxa") as Model<string> | undefined;
	if (!model) throw new Error("fauxa not registered");

	service = createDelegationService({
		resolveParent: (id) =>
			id === parent?.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot: tmpDir("pi-subagents-delegation-"),
		scope: "ws-sub",
		modelRuntime: runtime,
	});

	const settingsManager = SettingsManager.inMemory({});
	const resourceLoader = new DefaultResourceLoader({
		cwd: parentCwd,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [createSubagentsExtension({ service })],
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	const created = await createAgentSession({
		cwd: parentCwd,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(parentCwd),
		settingsManager,
		resourceLoader,
		model,
	});
	parent = created.session;
	// session_start (where the tools register) fires from bindExtensions.
	await parent.bindExtensions({ mode: "print" });
});

afterAll(() => {
	parent?.dispose();
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function transcript(): string {
	return JSON.stringify(parent.messages);
}

/** The plain text of the last toolResult message (no JSON escaping in the way of assertions). */
function lastToolResultText(): string {
	const message = parent.messages.filter((m) => m.role === "toolResult").at(-1) as
		| { content: Array<{ type: string; text?: string }> }
		| undefined;
	return (message?.content ?? [])
		.map((block) => (block.type === "text" ? (block.text ?? "") : ""))
		.join("\n");
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for condition");
		await Bun.sleep(20);
	}
}

test("foreground: one Agent call runs a builtin scout and returns its report to the parent", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", { subagent_type: "scout", task: "Map the auth module." }),
		),
		fauxAssistantMessage("SCOUT_REPORT"), // consumed by the child (same provider as the parent)
		fauxAssistantMessage("PARENT_SUMMARY"),
	]);

	await parent.prompt("Send a scout.");

	expect(transcript()).toContain("SCOUT_REPORT");
	const last = parent.messages.filter((m) => m.role === "assistant").at(-1);
	expect(JSON.stringify(last)).toContain("PARENT_SUMMARY");

	const children = service.childrenOf(parent.sessionId);
	expect(children.length).toBe(1);
	expect(children[0]?.record.info).toEqual({
		createdBy: "tool:Agent",
		roleName: "scout",
		roleSource: "builtin",
	});
	expect(children[0]?.snapshot?.status).toBe("completed");
	await service.disposeChildrenOf(parent.sessionId);
});

test("an unknown subagent_type surfaces as a tool error listing the available types", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(fauxToolCall("Agent", { subagent_type: "nope", task: "x" })),
		fauxAssistantMessage("PARENT_RECOVERED"),
	]);

	await parent.prompt("Send a nope.");

	const text = lastToolResultText();
	expect(text).toContain('Unknown subagent type "nope"');
	expect(text).toContain('"scout" (builtin)');
	expect(service.childrenOf(parent.sessionId)).toEqual([]);
});

test("background: run_in_background returns immediately, completion arrives as a custom message", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "bg-runner",
				task: "Long job.",
				run_in_background: true,
			}),
		),
		fauxAssistantMessage("ACK_STARTED"),
		fauxAssistantMessage("GOT_COMPLETION"),
	]);
	fauxB.setResponses([fauxAssistantMessage("BG_RESULT")]);

	await parent.prompt("Run it in the background.");
	// The tool result came back before the child finished.
	expect(transcript()).toContain("Started background subagent");

	// The child completes → a subagent-completion custom message triggers a parent turn.
	await waitFor(() => transcript().includes("GOT_COMPLETION"));
	expect(transcript()).toContain(SUBAGENT_COMPLETION_MESSAGE);
	expect(transcript()).toContain("BG_RESULT");

	// Collection semantics ride the core registry.
	const child = service.childrenOf(parent.sessionId)[0];
	expect(child?.collectResult()?.finalText).toBe("BG_RESULT");
	expect(child?.snapshot?.collected).toBe(true);
	await service.disposeChildrenOf(parent.sessionId);
});

test("get_subagent_result on an unknown id explains the restart-loss case", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(fauxToolCall("get_subagent_result", { session_id: "bogus" })),
		fauxAssistantMessage("OK_HANDLED"),
	]);

	await parent.prompt("Collect bogus.");

	expect(lastToolResultText()).toContain("Unknown subagent session bogus");
});
