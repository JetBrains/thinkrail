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
	type ExtensionFactory,
	getAgentDir,
	ModelRuntime,
	type ProviderConfig,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createDelegationService, type DelegationService } from "pi-delegation";
import defaultSubagents, {
	createSubagents,
	createSubagentsExtension,
	SUBAGENT_COMPLETION_MESSAGE,
} from "../index";
import { boundedText } from "./extension";

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

async function makeSession(
	isEnabled?: () => boolean,
	boundService: DelegationService = service,
	factory?: ExtensionFactory,
	sessionManager?: SessionManager,
): Promise<AgentSession> {
	const settingsManager = SettingsManager.inMemory({});
	const resourceLoader = new DefaultResourceLoader({
		cwd: parentCwd,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [
			factory ??
				createSubagentsExtension({
					service: boundService,
					...(isEnabled ? { isEnabled } : {}),
				}),
		],
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
		sessionManager: sessionManager ?? SessionManager.inMemory(parentCwd),
		settingsManager,
		resourceLoader,
		model,
	});
	liveParents.set(created.session.sessionId, created.session);
	try {
		await created.session.bindExtensions({
			mode: "print",
			onError: (error) => {
				throw new Error(error.error);
			},
		});
		return created.session;
	} catch (error) {
		liveParents.delete(created.session.sessionId);
		created.session.dispose();
		throw error;
	}
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for condition");
		await Bun.sleep(20);
	}
}

test("an embedder can keep subagent tools registered but inactive at session start", async () => {
	const session = await makeSession(() => false);
	try {
		const configured = session.getAllTools().map((tool) => tool.name);
		expect(configured).toContain("Agent");
		expect(configured).toContain("get_subagent_result");
		expect(session.getActiveToolNames()).not.toContain("Agent");
		expect(session.getActiveToolNames()).not.toContain("get_subagent_result");
	} finally {
		liveParents.delete(session.sessionId);
		session.dispose();
	}
});

test("the live enabled predicate rejects a launch selected before embedder policy changed", async () => {
	let enabled = true;
	const session = await makeSession(() => enabled);
	try {
		enabled = false;
		fauxA.setResponses([
			fauxAssistantMessage(
				fauxToolCall("Agent", { subagent_type: "scout", task: "Should not start." }),
			),
			fauxAssistantMessage("PARENT_RECOVERED"),
		]);

		await session.prompt("Try to delegate.");

		expect(lastToolResultText(session)).toContain("Subagents are disabled");
		expect(service.childrenOf(session.sessionId)).toEqual([]);
	} finally {
		await service.disposeChildrenOf(session.sessionId);
		liveParents.delete(session.sessionId);
		session.dispose();
	}
});

test("a disable during asynchronous child creation disposes it before provider work starts", async () => {
	let enabled = true;
	let releaseChild = () => {};
	const childGate = new Promise<void>((resolve) => {
		releaseChild = resolve;
	});
	let signalChildCreated = () => {};
	const childCreated = new Promise<void>((resolve) => {
		signalChildCreated = resolve;
	});
	const gatedService: DelegationService = {
		async createChild(spec) {
			const child = await service.createChild(spec);
			signalChildCreated();
			await childGate;
			return child;
		},
		findChild: (sessionId) => service.findChild(sessionId),
		childrenOf: (parentSessionId) => service.childrenOf(parentSessionId),
		onLifecycle: (listener) => service.onLifecycle(listener),
		disposeChildrenOf: (parentSessionId) => service.disposeChildrenOf(parentSessionId),
	};
	const session = await makeSession(() => enabled, gatedService);
	const childCallsBefore = fauxB.state.callCount;
	try {
		fauxA.setResponses([
			fauxAssistantMessage(
				fauxToolCall("Agent", { subagent_type: "bg-runner", task: "Do not start." }),
			),
			fauxAssistantMessage("PARENT_RECOVERED"),
		]);
		fauxB.setResponses([fauxAssistantMessage("CHILD_SHOULD_NOT_RUN")]);
		const turn = session.prompt("Try to delegate during a policy change.");
		await childCreated;
		enabled = false;
		releaseChild();
		await turn;

		expect(lastToolResultText(session)).toContain("Subagents are disabled");
		expect(fauxB.state.callCount).toBe(childCallsBefore);
		expect(service.childrenOf(session.sessionId)).toEqual([]);
	} finally {
		releaseChild();
		await service.disposeChildrenOf(session.sessionId);
		liveParents.delete(session.sessionId);
		session.dispose();
	}
});

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

function gate() {
	let open = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

test.each([
	"user",
	undefined,
	"engine",
	"",
])("detached cancellation (%s) persists a displayed completion and only user cancellation avoids a parent turn", async (reason) => {
	const session = await makeSession();
	const started = gate();
	const finish = gate();
	const delivered = gate();
	const unsubscribe = session.subscribe((event) => {
		if (
			event.type === "message_end" &&
			event.message.role === "custom" &&
			event.message.customType === SUBAGENT_COMPLETION_MESSAGE
		) {
			delivered.open();
		}
	});
	try {
		fauxA.setResponses([
			fauxAssistantMessage(
				fauxToolCall("Agent", {
					subagent_type: "bg-runner",
					task: "Wait for cancellation.",
					run_in_background: true,
				}),
			),
			fauxAssistantMessage("ACK_STARTED"),
			fauxAssistantMessage("FOLLOW_UP"),
		]);
		fauxB.setResponses([
			async () => {
				started.open();
				await finish.opened;
				return fauxAssistantMessage("INTERRUPTED");
			},
		]);
		await session.prompt("Delegate, then wait.");
		await started.opened;
		const child = service.childrenOf(session.sessionId).at(-1);
		if (!child) throw new Error("no child spawned");
		expect(child.snapshot?.status).toBe("running");
		expect(session.isStreaming).toBe(false);
		const callsBeforeStop = fauxA.state.callCount;

		const aborting = Promise.all([child.abort(reason), child.abort("user")]);
		finish.open();
		await aborting;
		await delivered.opened;
		if (reason !== "user") {
			await waitFor(() => JSON.stringify(session.messages).includes("FOLLOW_UP"));
		}
		await Bun.sleep(20);
		expect(fauxA.state.callCount).toBe(callsBeforeStop + (reason === "user" ? 0 : 1));
		expect(session.isStreaming).toBe(false);
		expect(child.snapshot?.details.abortReason).toBe(reason);
		const completions = session.sessionManager
			.getEntries()
			.filter(
				(entry) =>
					entry.type === "custom_message" && entry.customType === SUBAGENT_COMPLETION_MESSAGE,
			);
		expect(completions).toHaveLength(1);
		expect(completions[0]).toMatchObject({
			display: true,
			content: expect.stringContaining("aborted:"),
			details: child.snapshot?.details,
		});

		if (reason === "user") {
			expect(fauxA.getPendingResponseCount()).toBe(1);
			fauxA.setResponses([
				fauxAssistantMessage(
					fauxToolCall("Agent", { subagent_type: "bg-runner", task: "Delegate again." }),
				),
				fauxAssistantMessage("PARENT_CONTINUES"),
			]);
			fauxB.setResponses([fauxAssistantMessage("NEXT_CHILD")]);
			await session.prompt("Keep working.");
			expect(lastToolResultText(session)).toBe("NEXT_CHILD");
			expect(service.childrenOf(session.sessionId)).toHaveLength(2);
		}
	} finally {
		finish.open();
		unsubscribe();
		await service.disposeChildrenOf(session.sessionId);
		liveParents.delete(session.sessionId);
		session.dispose();
	}
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

test("get_subagent_result on an unknown id explains the restart-loss case", async () => {
	fauxA.setResponses([
		fauxAssistantMessage(fauxToolCall("get_subagent_result", { session_id: "bogus" })),
		fauxAssistantMessage("OK_HANDLED"),
	]);

	await parent.prompt("Collect bogus.");

	expect(lastToolResultText()).toContain("Unknown subagent session bogus");
});

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function completions(session: AgentSession) {
	return session.messages.filter(
		(message) => message.role === "custom" && message.customType === SUBAGENT_COMPLETION_MESSAGE,
	);
}

async function launchDetached(session: AgentSession) {
	const finish = deferred();
	const entered = deferred();
	fauxA.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "bg-runner",
				task: "Retained completion",
				run_in_background: true,
			}),
		),
		fauxAssistantMessage("DETACHED_ACK"),
		fauxAssistantMessage("DELIVERED_COMPLETION"),
	]);
	fauxB.setResponses([
		async () => {
			entered.resolve();
			await finish.promise;
			return fauxAssistantMessage("RETAINED_RESULT");
		},
	]);
	await session.prompt("Delegate in the background.");
	await entered.promise;
	return finish;
}

test("retained completion waits behind a closed gate, then repeated flush accepts exactly once", async () => {
	let allowed = false;
	let enabled = true;
	const owner = createSubagents({
		service,
		canDeliverCompletion: () => allowed,
		isEnabled: () => enabled,
	});
	expect(Object.keys(owner).sort()).toEqual(["dispose", "extension", "flushCompletions"]);
	const session = await makeSession(undefined, service, owner.extension);
	let starts = 0;
	session.subscribe((event) => {
		if (event.type === "agent_start") starts++;
	});
	const finish = await launchDetached(session);
	try {
		finish.resolve();
		await waitFor(() => service.childrenOf(session.sessionId)[0]?.snapshot?.status === "completed");
		owner.flushCompletions();
		expect(completions(session)).toHaveLength(0);
		expect(
			session.sessionManager.getEntries().filter((entry) => entry.type === "custom_message"),
		).toHaveLength(0);
		expect(starts).toBe(1);
		enabled = false;
		allowed = true;
		owner.flushCompletions();
		owner.flushCompletions();
		await waitFor(() => !session.isStreaming && completions(session).length === 1);
		expect(starts).toBe(2);
		expect(JSON.stringify(completions(session))).toContain("RETAINED_RESULT");
	} finally {
		finish.resolve();
		owner.dispose();
		await service.disposeChildrenOf(session.sessionId);
		session.dispose();
	}
});

test.each([
	"gap",
	"rebound",
])("real Pi reload retains completion settling %s and ignores stale unbind", async (timing) => {
	const owner = createSubagents({ service });
	const inGap = deferred();
	const resume = deferred();
	let bindings = 0;
	const sends: number[] = [];
	const session = await makeSession(undefined, service, (pi) => {
		const binding = ++bindings;
		owner.extension({
			...pi,
			sendMessage: (message, options) => {
				sends.push(binding);
				pi.sendMessage(message, options);
			},
		});
		pi.on("session_shutdown", async (event) => {
			if (event.reason !== "reload") return;
			inGap.resolve();
			await resume.promise;
		});
	});
	const oldRunner = session.extensionRunner;
	const finish = await launchDetached(session);
	const reloading = session.reload();
	try {
		await inGap.promise;
		if (timing === "gap") {
			finish.resolve();
			await waitFor(
				() => service.childrenOf(session.sessionId)[0]?.snapshot?.status === "completed",
			);
			owner.flushCompletions();
			expect(completions(session)).toHaveLength(0);
			expect(sends).toEqual([]);
		}
		resume.resolve();
		await reloading;
		await oldRunner.emit({ type: "session_shutdown", reason: "reload" });
		finish.resolve();
		await waitFor(() => !session.isStreaming && completions(session).length === 1);
		owner.flushCompletions();
		expect(sends).toEqual([2]);
		expect(service.childrenOf(session.sessionId)).toHaveLength(1);
		expect(session.getAllTools().filter((tool) => tool.name === "Agent")).toHaveLength(1);
	} finally {
		resume.resolve();
		finish.resolve();
		await reloading;
		owner.dispose();
		await service.disposeChildrenOf(session.sessionId);
		session.dispose();
	}
});

test.each([
	"dispose",
	"quit",
])("permanent %s clears pending and future outcomes and cannot rebind open", async (close) => {
	let allowed = false;
	const owner = createSubagents({ service, canDeliverCompletion: () => allowed });
	const session = await makeSession(undefined, service, owner.extension);
	const first = await launchDetached(session);
	first.resolve();
	await waitFor(() => service.childrenOf(session.sessionId)[0]?.snapshot?.status === "completed");
	const second = await launchDetached(session);
	try {
		if (close === "dispose") owner.dispose();
		else await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		allowed = true;
		await session.reload();
		second.resolve();
		await waitFor(() =>
			service
				.childrenOf(session.sessionId)
				.every((child) => child.snapshot?.status === "completed"),
		);
		owner.flushCompletions();
		expect(completions(session)).toHaveLength(0);
		expect(session.isStreaming).toBe(false);
	} finally {
		second.resolve();
		owner.dispose();
		await service.disposeChildrenOf(session.sessionId);
		session.dispose();
	}
});

test.each([
	false,
	true,
])("sync send failure restores its claim unless disposed (dispose: %s), reentrance never duplicates", async (disposeOnFailure) => {
	let allowed = false;
	let attempts = 0;
	const owner = createSubagents({ service, canDeliverCompletion: () => allowed });
	const session = await makeSession(undefined, service, (pi) =>
		owner.extension({
			...pi,
			sendMessage(message, options) {
				attempts++;
				owner.flushCompletions();
				if (attempts === 1) {
					if (disposeOnFailure) owner.dispose();
					throw new Error("synchronous rejection");
				}
				pi.sendMessage(message, options);
				owner.flushCompletions();
			},
		}),
	);
	const finish = await launchDetached(session);
	try {
		finish.resolve();
		await waitFor(() => service.childrenOf(session.sessionId)[0]?.snapshot?.status === "completed");
		allowed = true;
		owner.flushCompletions();
		expect(attempts).toBe(1);
		expect(completions(session)).toHaveLength(0);
		owner.flushCompletions();
		owner.flushCompletions();
		await waitFor(() => !session.isStreaming);
		expect(attempts).toBe(disposeOnFailure ? 1 : 2);
		expect(completions(session)).toHaveLength(disposeOnFailure ? 0 : 1);
	} finally {
		finish.resolve();
		owner.dispose();
		await service.disposeChildrenOf(session.sessionId);
		session.dispose();
	}
});

test.each([
	["default factory shutdown", "default", false],
	["legacy injected-service factory natural completion", "legacy", false],
	["legacy injected-service factory explicit user abort after shutdown", "legacy", true],
] as const)("one %s keeps independent runner lifetimes", async (_name, kind, userStop) => {
	const factory = kind === "default" ? defaultSubagents : createSubagentsExtension({ service });
	const first = await makeSession(undefined, service, factory);
	const second = await makeSession(undefined, service, factory);
	const firstFinish = await launchDetached(first);
	try {
		const child = service.childrenOf(first.sessionId)[0];
		const closing = first.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		let aborting: Promise<void> | undefined;
		if (kind === "legacy") {
			await closing;
			if (!child) throw new Error("no child spawned");
			if (userStop) aborting = child.abort("user");
		}
		firstFinish.resolve();
		await Promise.all([closing, aborting]);
		if (kind === "legacy")
			await waitFor(() => child?.snapshot?.status === (userStop ? "aborted" : "completed"));
		expect(completions(first)).toHaveLength(0);
		const finish = await launchDetached(second);
		finish.resolve();
		await waitFor(() => !second.isStreaming && completions(second).length === 1);
		expect(completions(first)).toHaveLength(0);
		expect(first.sessionManager.getEntries().some((entry) => entry.type === "custom_message")).toBe(
			false,
		);
		expect(JSON.stringify(completions(second))).toContain("RETAINED_RESULT");
	} finally {
		firstFinish.resolve();
		await second.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.disposeChildrenOf(first.sessionId);
		await service.disposeChildrenOf(second.sessionId);
		first.dispose();
		second.dispose();
	}
});

test("a retained owner rejects another parent without replacing the original sender", async () => {
	const owner = createSubagents({ service });
	const session = await makeSession(undefined, service, owner.extension);
	try {
		await expect(makeSession(undefined, service, owner.extension)).rejects.toThrow(
			"Subagents belong to a different session",
		);
		const finish = await launchDetached(session);
		finish.resolve();
		await waitFor(() => !session.isStreaming && completions(session).length === 1);
	} finally {
		owner.dispose();
		await service.disposeChildrenOf(session.sessionId);
		session.dispose();
	}
});

test("a previous live runner's reload shutdown cannot unbind a newer sender for the same parent", async () => {
	const owner = createSubagents({ service });
	const first = await makeSession(undefined, service, owner.extension);
	const finish = await launchDetached(first);
	const rebound = await makeSession(undefined, service, owner.extension, first.sessionManager);
	try {
		await first.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		finish.resolve();
		await waitFor(() => !rebound.isStreaming && completions(rebound).length === 1);
		expect(completions(first)).toHaveLength(0);
		owner.flushCompletions();
		expect(completions(rebound)).toHaveLength(1);
	} finally {
		finish.resolve();
		owner.dispose();
		await service.disposeChildrenOf(first.sessionId);
		first.dispose();
		rebound.dispose();
	}
});
