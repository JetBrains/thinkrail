import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
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
	type ProviderConfig,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createDelegationService, type DelegationService } from "pi-delegation";
import { boundedText, createSubagentsExtension, SUBAGENT_COMPLETION_MESSAGE } from "./extension";

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
let bgRunnerPath: string;
const liveParents = new Map<string, AgentSession>();

const BG_RUNNER_DEFINITION =
	"---\nname: bg-runner\ndescription: Background test runner\nmodel: fauxb\n---\n\nRun the delegated task.\n";

function fauxConfig(core: typeof fauxA, id: string): ProviderConfig {
	return {
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
	};
}

function registerFaux(core: typeof fauxA, id: string): void {
	runtime.registerProvider(id, fauxConfig(core, id));
}

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = tmpDir("pi-subagents-agentdir-");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	mkdirSync(join(agentDir, "agents"), { recursive: true });
	bgRunnerPath = join(agentDir, "agents", "bg-runner.md");
	writeFileSync(bgRunnerPath, BG_RUNNER_DEFINITION);
	writeFileSync(
		join(agentDir, "agents", "capped.md"),
		"---\nname: capped\ndescription: Turn-capped test agent\ntools: read, ls\nmax_turns: 1\n---\n\nWork until stopped.\n",
	);
	writeFileSync(
		join(agentDir, "agents", "extension-provider.md"),
		"---\nname: extension-provider\ndescription: Extension-provider test agent\nmodel: extension-faux\n---\n\nRun through the extension-registered provider.\n",
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
		resolveParent: (id) => {
			const live = liveParents.get(id);
			return live
				? { cwd: parentCwd, model: live.model, thinkingLevel: live.thinkingLevel }
				: undefined;
		},
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
	liveParents.set(parent.sessionId, parent);
	await parent.bindExtensions({ mode: "print" });
});

beforeEach(async () => {
	if (parent) await service.disposeChildrenOf(parent.sessionId);
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

function lastToolResultText(session: AgentSession = parent): string {
	const message = session.messages.filter((m) => m.role === "toolResult").at(-1) as
		| { content: Array<{ type: string; text?: string }> }
		| undefined;
	return (message?.content ?? [])
		.map((block) => (block.type === "text" ? (block.text ?? "") : ""))
		.join("\n");
}

async function makeSession(): Promise<AgentSession> {
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
	const model = runtime.getModel("fauxa", "fauxa") as Model<string> | undefined;
	if (!model) throw new Error("fauxa not registered");
	const created = await createAgentSession({
		cwd: parentCwd,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(parentCwd),
		settingsManager,
		resourceLoader,
		model,
	});
	liveParents.set(created.session.sessionId, created.session);
	await created.session.bindExtensions({ mode: "print" });
	return created.session;
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
		fauxAssistantMessage("SCOUT_REPORT"),
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

test("a per-call model runs an unpinned agent on a different model than the parent", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "scout",
				task: "Use the requested model.",
				model: "fauxb/fauxb",
			}),
		),
		fauxAssistantMessage("PARENT_USED_CALL_MODEL"),
	]);
	fauxB.setResponses([fauxAssistantMessage("CALL_MODEL_CHILD_OK")]);

	await parent.prompt("Delegate on fauxb.");

	expect(transcript()).toContain("CALL_MODEL_CHILD_OK");
	expect(transcript()).toContain("PARENT_USED_CALL_MODEL");
	const child = service.childrenOf(parent.sessionId)[0];
	expect(child?.snapshot?.details.model).toBe("fauxb/fauxb");
	await service.disposeChildrenOf(parent.sessionId);
});

test("a definition-pinned model silently wins over the per-call model", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "bg-runner",
				task: "Keep the definition pin.",
				model: "unobtanium",
			}),
		),
		fauxAssistantMessage("PARENT_USED_PINNED_MODEL"),
	]);
	fauxB.setResponses([fauxAssistantMessage("PINNED_MODEL_CHILD_OK")]);

	await parent.prompt("Delegate with a redundant model.");

	expect(transcript()).toContain("PINNED_MODEL_CHILD_OK");
	expect(transcript()).toContain("PARENT_USED_PINNED_MODEL");
	const child = service.childrenOf(parent.sessionId)[0];
	expect(child?.snapshot?.details.model).toBe("fauxb/fauxb");
	await service.disposeChildrenOf(parent.sessionId);
});

test("a live definition edit refreshes advertised and effective model policy together", async () => {
	try {
		writeFileSync(bgRunnerPath, BG_RUNNER_DEFINITION.replace("model: fauxb", "model: fauxa"));
		fauxA.setResponses([
			fauxAssistantMessage(
				fauxToolCall("Agent", {
					subagent_type: "bg-runner",
					task: "Use the refreshed definition pin.",
					model: "unobtanium",
				}),
			),
			fauxAssistantMessage("REFRESHED_PIN_CHILD_OK"),
			fauxAssistantMessage("PARENT_USED_REFRESHED_PIN"),
		]);

		await parent.prompt("Delegate after the definition changes.");

		expect(transcript()).toContain("REFRESHED_PIN_CHILD_OK");
		expect(transcript()).toContain("PARENT_USED_REFRESHED_PIN");
		expect(parent.getToolDefinition("Agent")?.description).toContain("model: pinned fauxa");
		const child = service.childrenOf(parent.sessionId)[0];
		expect(child?.snapshot?.details.model).toBe("fauxa/fauxa");
	} finally {
		writeFileSync(bgRunnerPath, BG_RUNNER_DEFINITION);
		await service.disposeChildrenOf(parent.sessionId);
	}
});

test("zero-config fallback mirrors a provider registered by another extension", async () => {
	const extensionFaux = fauxCore("extension-faux");
	const settingsManager = SettingsManager.inMemory({});
	const standaloneDelegationRoot = tmpDir("pi-subagents-standalone-delegation-");
	const resourceLoader = new DefaultResourceLoader({
		cwd: parentCwd,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [
			(pi) => pi.registerProvider("extension-faux", fauxConfig(extensionFaux, "extension-faux")),
			createSubagentsExtension({
				delegationRoot: standaloneDelegationRoot,
				scope: "standalone",
			}),
		],
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const model = runtime.getModel("fauxa", "fauxa") as Model<string> | undefined;
	if (!model) throw new Error("fauxa not registered");
	const standalone = (
		await createAgentSession({
			cwd: parentCwd,
			modelRuntime: runtime,
			sessionManager: SessionManager.inMemory(parentCwd),
			settingsManager,
			resourceLoader,
			model,
		})
	).session;

	try {
		await standalone.bindExtensions({ mode: "print" });
		fauxA.setResponses([
			fauxAssistantMessage(
				fauxToolCall("Agent", {
					subagent_type: "extension-provider",
					task: "Use the mirrored provider.",
				}),
			),
			fauxAssistantMessage("PARENT_USED_EXTENSION_PROVIDER"),
		]);
		extensionFaux.setResponses([fauxAssistantMessage("EXTENSION_PROVIDER_CHILD_OK")]);

		await standalone.prompt("Delegate through the extension provider.");

		expect(JSON.stringify(standalone.messages)).toContain("EXTENSION_PROVIDER_CHILD_OK");
		expect(JSON.stringify(standalone.messages)).toContain("PARENT_USED_EXTENSION_PROVIDER");
	} finally {
		await standalone.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		standalone.dispose();
		runtime.unregisterProvider("extension-faux");
	}
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
	expect(text).toContain("model: call or parent");
	expect(text).toContain("model: pinned fauxb");
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
	expect(transcript()).toContain("in the background:");

	await waitFor(() => transcript().includes("GOT_COMPLETION"));
	expect(transcript()).toContain(SUBAGENT_COMPLETION_MESSAGE);
	expect(transcript()).toContain("BG_RESULT");

	const child = service.childrenOf(parent.sessionId)[0];
	expect(child?.collectResult()?.finalText).toBe("BG_RESULT");
	expect(child?.snapshot?.collected).toBe(true);
	await service.disposeChildrenOf(parent.sessionId);
});

test("a foreground error outcome surfaces as a tool error carrying the reason", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(fauxToolCall("Agent", { subagent_type: "scout", task: "Fail." })),
		fauxAssistantMessage("partial", { stopReason: "error", errorMessage: "boom" }),
		fauxAssistantMessage("PARENT_SAW_ERROR"),
	]);

	await parent.prompt("Send a doomed scout.");

	const text = lastToolResultText();
	expect(text).toContain("failed: boom");

	const child = service.childrenOf(parent.sessionId).at(-1);
	if (!child) throw new Error("no child spawned");
	const result = parent.messages.filter((m) => m.role === "toolResult").at(-1) as {
		isError: boolean;
		details?: { childSessionId?: string; status?: string };
	};
	expect(result.isError).toBe(true);
	expect(result.details?.childSessionId).toBe(child.sessionId);
	expect(result.details?.status).toBe("error");
	await service.disposeChildrenOf(parent.sessionId);
});

test("max_turns flows from the definition into the run: the cap steers the wrap-up", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(fauxToolCall("Agent", { subagent_type: "capped", task: "Loop." })),
		fauxAssistantMessage(fauxToolCall("ls", {})),
		fauxAssistantMessage("WRAPPED_UP"),
		fauxAssistantMessage("PARENT_OK"),
	]);

	await parent.prompt("Run the capped agent.");

	expect(lastToolResultText()).toContain("WRAPPED_UP");
	const child = service.childrenOf(parent.sessionId).at(-1);
	expect(child?.snapshot?.status).toBe("completed");
	expect(child?.snapshot?.details.usage.turns).toBe(2);
	await service.disposeChildrenOf(parent.sessionId);
});

test("a detached run SURVIVES a parent-turn abort (only awaited runs ride the tool signal)", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "bg-runner",
				task: "Slow job.",
				run_in_background: true,
			}),
		),
		async () => {
			await Bun.sleep(150);
			return fauxAssistantMessage("SLOW_ACK");
		},
		fauxAssistantMessage("POST_ABORT_COMPLETION"),
	]);
	fauxB.setResponses([
		async () => {
			await Bun.sleep(250);
			return fauxAssistantMessage("SURVIVED");
		},
	]);

	const prompted = parent.prompt("Run it, then get interrupted.");
	await waitFor(() => transcript().includes("in the background:"));
	await Bun.sleep(30);
	await parent.abort();
	await prompted;

	const child = service.childrenOf(parent.sessionId).at(-1);
	await waitFor(() => child?.snapshot?.status === "completed");
	expect(child?.snapshot?.finalText).toBe("SURVIVED");
	await waitFor(() => transcript().includes("POST_ABORT_COMPLETION"));
	expect(transcript()).toContain(SUBAGENT_COMPLETION_MESSAGE);
	await service.disposeChildrenOf(parent.sessionId);
});

test("boundedText: reason-first errors, terminal fallbacks, and the 50k bound (every report path)", () => {
	expect(boundedText({ status: "error", errorMessage: "boom", finalText: "partial" })).toBe(
		"boom\n\npartial",
	);
	expect(boundedText({ status: "error" })).toBe("unknown error");
	expect(boundedText({ status: "completed" })).toBe("(no output)");
	expect(boundedText({ status: "aborted" })).toBe("Run aborted.");
	const huge = boundedText({ status: "completed", finalText: "Y".repeat(60_000) });
	expect(huge.endsWith("[truncated]")).toBe(true);
	expect(huge.length).toBeLessThan(50_100);
});

test("get_subagent_result collects a detached ERROR through the same reason-first shaping", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "bg-runner",
				task: "Doomed job.",
				run_in_background: true,
			}),
		),
		fauxAssistantMessage("ACK_BG"),
		fauxAssistantMessage("SAW_FAILURE"),
	]);
	fauxB.setResponses([
		fauxAssistantMessage("partial work", { stopReason: "error", errorMessage: "child exploded" }),
	]);

	await parent.prompt("Run the doomed job.");
	await waitFor(() => transcript().includes("SAW_FAILURE"));
	const child = service.childrenOf(parent.sessionId).at(-1);
	if (!child) throw new Error("no child spawned");

	fauxA.setResponses([
		fauxAssistantMessage(fauxToolCall("get_subagent_result", { session_id: child.sessionId })),
		fauxAssistantMessage("COLLECTED"),
	]);
	await parent.prompt("Collect it.");

	const text = lastToolResultText();
	expect(text).toContain("Run error: child exploded");
	expect(text).toContain("partial work");
	await service.disposeChildrenOf(parent.sessionId);
});

test("get_subagent_result rejects another parent's child — lineage is enforced on the shared service", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", { subagent_type: "bg-runner", task: "Mine.", run_in_background: true }),
		),
		fauxAssistantMessage("OWNER_ACK"),
		fauxAssistantMessage("OWNER_SAW_COMPLETION"),
	]);
	fauxB.setResponses([fauxAssistantMessage("OWNER_RESULT")]);
	await parent.prompt("Run mine.");
	await waitFor(() => transcript().includes("OWNER_SAW_COMPLETION"));
	const child = service.childrenOf(parent.sessionId).at(-1);
	if (!child) throw new Error("no child spawned");

	const other = await makeSession();
	try {
		fauxA.setResponses([
			fauxAssistantMessage(fauxToolCall("get_subagent_result", { session_id: child.sessionId })),
			fauxAssistantMessage("OTHER_HANDLED"),
		]);
		await other.prompt("Collect someone else's child.");
		expect(lastToolResultText(other)).toContain(`Unknown subagent session ${child.sessionId}`);
		expect(child.snapshot?.collected).toBe(false);
	} finally {
		other.dispose();
		await service.disposeChildrenOf(parent.sessionId);
	}
});

test("session_shutdown suppresses a detached run's completion delivery into the dying session", async () => {
	const session = await makeSession();
	try {
		fauxA.setResponses([
			fauxAssistantMessage(
				fauxToolCall("Agent", {
					subagent_type: "bg-runner",
					task: "Outlive the session.",
					run_in_background: true,
				}),
			),
			fauxAssistantMessage("SHUTDOWN_ACK"),
			fauxAssistantMessage("COMPLETION_TURN_MUST_NOT_HAPPEN"),
		]);
		fauxB.setResponses([
			async () => {
				await Bun.sleep(200);
				return fauxAssistantMessage("LATE_RESULT");
			},
		]);

		await session.prompt("Run it, then shut the session down.");
		expect(JSON.stringify(session.messages)).toContain("in the background:");

		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });

		const child = service.childrenOf(session.sessionId).at(-1);
		if (!child) throw new Error("no child spawned");
		await waitFor(() => child.snapshot?.status === "completed");
		await Bun.sleep(100);
		expect(JSON.stringify(session.messages)).not.toContain(SUBAGENT_COMPLETION_MESSAGE);
	} finally {
		session.dispose();
		await service.disposeChildrenOf(session.sessionId);
	}
});

test("get_subagent_result on an unknown id explains the restart-loss case", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(fauxToolCall("get_subagent_result", { session_id: "bogus" })),
		fauxAssistantMessage("OK_HANDLED"),
	]);

	await parent.prompt("Collect bogus.");

	expect(lastToolResultText()).toContain("Unknown subagent session bogus");
});
