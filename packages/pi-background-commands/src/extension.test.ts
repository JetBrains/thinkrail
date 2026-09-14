import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	createBashToolDefinition,
	DefaultResourceLoader,
	type ExtensionContext,
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import backgroundCommandsExtension, {
	BACKGROUND_COMMAND_COMPLETION_MESSAGE,
	type BackgroundCommandContext,
	createBackgroundCommands,
	createBackgroundCommandsExtension,
} from "../index";
import { controlledOperations, waitFor } from "./test-support";

const cwd = mkdtempSync(join(tmpdir(), "pi-background-"));
let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let runtime: ModelRuntime;
const faux = createFauxCore({
	provider: "background-test",
	api: "background-test",
	models: [
		{
			id: "background-test",
			name: "background-test",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100000,
			maxTokens: 4096,
		},
	],
	tokensPerSecond: 4000,
});

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = cwd;
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("background-test", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [
			{
				id: "background-test",
				name: "background-test",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 4096,
			},
		],
	});
});

afterAll(() => {
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	rmSync(cwd, { recursive: true, force: true });
});

async function makeSession(
	factory: ExtensionFactory = backgroundCommandsExtension,
	sessionManager = SessionManager.inMemory(cwd),
	extraFactories: ExtensionFactory[] = [],
) {
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	});
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: cwd,
		settingsManager,
		extensionFactories: [factory, ...extraFactories],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const model = runtime.getModel("background-test", "background-test");
	if (!model) throw new Error("Missing model");
	const { session } = await createAgentSession({
		cwd,
		modelRuntime: runtime,
		model,
		settingsManager,
		sessionManager,
		resourceLoader: loader,
	});
	await session.bindExtensions({
		mode: "print",
		onError: (error) => {
			throw new Error(error.error);
		},
	});
	return session;
}

test("vanilla Pi calls the real command tool, acknowledges immediately, and receives a natural follow-up", async () => {
	const session = await makeSession();
	try {
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", {
					action: "start",
					command: "sleep 0.1; printf REAL_RESULT",
				}),
			),
			fauxAssistantMessage("ACKNOWLEDGED"),
			fauxAssistantMessage("SAW_COMPLETION"),
		]);
		await session.prompt("Start a managed command.");
		await waitFor(() => JSON.stringify(session.messages).includes("SAW_COMPLETION"));
		const custom = session.messages.find(
			(message) =>
				message.role === "custom" && message.customType === BACKGROUND_COMMAND_COMPLETION_MESSAGE,
		);
		expect(custom).toMatchObject({ role: "custom", display: true });
		expect(JSON.stringify(custom)).toContain("REAL_RESULT");
		expect(session.getActiveToolNames()).toContain("bash");
		expect(session.getToolDefinition("bash")?.description).not.toContain("background");
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
});

test("injected jobs survive resource reload; a completion in the gap replays once into the new binding", async () => {
	const executor = controlledOperations();
	const sm = SessionManager.inMemory(cwd);
	const service = createBackgroundCommands(
		{ sessionId: sm.getSessionId(), getContext: () => ({ cwd }) },
		executor,
	);
	const session = await makeSession(createBackgroundCommandsExtension({ service }), sm);
	try {
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", { action: "start", command: "gated" }),
			),
			fauxAssistantMessage("ACK"),
			fauxAssistantMessage("REPLAYED"),
		]);
		await session.prompt("Start.");
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		expect(executor.call().options.signal?.aborted).toBe(false);
		executor.call().resolve({ exitCode: 0 });
		await waitFor(() => service.list()[0]?.status === "completed");
		expect(JSON.stringify(session.messages)).not.toContain(BACKGROUND_COMMAND_COMPLETION_MESSAGE);
		await session.reload();
		await waitFor(() => JSON.stringify(session.messages).includes("REPLAYED"));
		await session.reload();
		expect(
			session.messages.filter(
				(m) => m.role === "custom" && m.customType === BACKGROUND_COMMAND_COMPLETION_MESSAGE,
			),
		).toHaveLength(1);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.dispose();
		session.dispose();
	}
});

test("current shell env matches Pi bash including managed-bin PATH, stale marker removal and live model settings", async () => {
	let context: ExtensionContext | undefined;
	const session = await makeSession(backgroundCommandsExtension, SessionManager.inMemory(cwd), [
		(pi) => {
			pi.on("session_start", (_event, ctx) => {
				context = ctx;
			});
		},
	]);
	const stale = [
		"PI_SESSION_ID",
		"PI_SESSION_FILE",
		"PI_PROVIDER",
		"PI_MODEL",
		"PI_REASONING_LEVEL",
	];
	const saved = stale.map((key) => [key, process.env[key]] as const);
	const previousPath = process.env.PATH;
	const executor = controlledOperations();
	let launchContext: BackgroundCommandContext = { cwd };
	const service = createBackgroundCommands(
		{ sessionId: session.sessionId, getContext: () => launchContext },
		executor,
	);
	try {
		if (!context) throw new Error("Missing context");
		for (const key of stale) process.env[key] = "stale-other-session";
		process.env.PATH = `/unrelated${delimiter}${previousPath ?? ""}`;
		session.setThinkingLevel("high");
		let nativeEnv: NodeJS.ProcessEnv | undefined;
		const bash = createBashToolDefinition(cwd, {
			operations: {
				exec: async (_command, _cwd, options) => {
					nativeEnv = options.env;
					return { exitCode: 0 };
				},
			},
		});
		await bash.execute("parity", { command: "ignored" }, undefined, undefined, context);
		launchContext = {
			cwd,
			model: context.model,
			thinkingLevel: context.thinkingLevel,
			sessionFile: context.sessionManager.getSessionFile(),
		};
		service.start({ command: "first" });
		expect(executor.call().options.env).toEqual(nativeEnv);
		expect(executor.call().options.env?.PATH?.split(delimiter)[0]).toBe(join(cwd, "bin"));
		expect(executor.call().options.env?.PI_REASONING_LEVEL).toBe("high");
		expect(executor.call().options.env?.PI_SESSION_FILE).toBeUndefined();
		executor.call().resolve({ exitCode: 0 });
		process.env.PATH = `${join(cwd, "bin")}${delimiter}${previousPath ?? ""}`;
		session.setThinkingLevel("low");
		await bash.execute("parity2", { command: "ignored" }, undefined, undefined, context);
		launchContext = { cwd, model: context.model, thinkingLevel: context.thinkingLevel };
		service.start({ command: "second" });
		expect(executor.call(1).options.env).toEqual(nativeEnv);
		expect(executor.call(1).options.env?.PI_REASONING_LEVEL).toBe("low");
		executor.call(1).resolve({ exitCode: 0 });
		launchContext = { cwd, exposeSessionEnvironment: false };
		const privateBash = createBashToolDefinition(cwd, {
			exposeSessionEnvironment: false,
			operations: {
				exec: async (_command, _cwd, options) => {
					nativeEnv = options.env;
					return { exitCode: 0 };
				},
			},
		});
		await privateBash.execute("private", { command: "ignored" }, undefined, undefined, context);
		service.start({ command: "private" });
		expect(executor.call(2).options.env).toEqual(nativeEnv);
		executor.call(2).resolve({ exitCode: 0 });
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		await service.dispose();
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
});

test("standalone launches read current trusted shell settings, never an untrusted project prefix", async () => {
	const projectDir = join(cwd, ".pi");
	const globalSettingsPath = join(cwd, "settings.json");
	const projectSettingsPath = join(projectDir, "settings.json");
	mkdirSync(projectDir, { recursive: true });
	writeFileSync(
		globalSettingsPath,
		JSON.stringify({ shellCommandPrefix: "export BG_SCOPE=global" }),
	);
	writeFileSync(
		projectSettingsPath,
		JSON.stringify({ shellCommandPrefix: "export BG_SCOPE=project" }),
	);
	const session = await makeSession();
	try {
		const invoke = async (expected: string) => {
			faux.setResponses([
				fauxAssistantMessage(
					fauxToolCall("background_command", {
						action: "start",
						command:
							'sleep 0.05; printf \'%s:%s:%s\' "$BG_SCOPE" "$PI_SESSION_ID" "$PI_REASONING_LEVEL"',
					}),
				),
				fauxAssistantMessage("ACK"),
				fauxAssistantMessage(`CHECKED_${expected}`),
			]);
			await session.prompt("Start using the current shell context.");
			await waitFor(() => JSON.stringify(session.messages).includes(`CHECKED_${expected}`));
			const last = session.messages.filter((m) => m.role === "custom").at(-1);
			expect(JSON.stringify(last)).toContain(`${expected}:${session.sessionId}:low`);
		};
		session.setThinkingLevel("low");
		session.settingsManager.setProjectTrusted(false);
		await invoke("global");
		session.settingsManager.setProjectTrusted(true);
		await invoke("project");
		writeFileSync(
			projectSettingsPath,
			JSON.stringify({ shellCommandPrefix: "export BG_SCOPE=edited" }),
		);
		await invoke("edited");
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		rmSync(projectDir, { recursive: true, force: true });
		rmSync(globalSettingsPath, { force: true });
	}
});

test("tool and user stop display cancellation without waking an idle parent; output/list use the same records", async () => {
	const executor = controlledOperations();
	const sm = SessionManager.inMemory(cwd);
	const service = createBackgroundCommands(
		{ sessionId: sm.getSessionId(), getContext: () => ({ cwd }) },
		executor,
	);
	const session = await makeSession(createBackgroundCommandsExtension({ service }), sm);
	try {
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", {
					action: "start",
					command: "stop me",
					name: "managed",
				}),
			),
			fauxAssistantMessage("ACK"),
		]);
		await session.prompt("Start.");
		const id = service.list()[0]?.id;
		if (!id) throw new Error("Missing command");
		executor.call().options.onData(Buffer.from("recent logs"));
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("background_command", { action: "list" })),
			fauxAssistantMessage(fauxToolCall("background_command", { action: "output", id })),
			fauxAssistantMessage(fauxToolCall("background_command", { action: "stop", id })),
			fauxAssistantMessage("STOP_REQUEST_ACK"),
		]);
		await session.prompt("Inspect and stop.");
		expect(JSON.stringify(session.messages)).toContain("recent logs");
		expect(service.find(id)?.snapshot.status).toBe("stopping");
		const calls = faux.state.callCount;
		executor.call().reject(new Error("aborted"));
		await waitFor(() => service.find(id)?.snapshot.status === "stopped");
		await Bun.sleep(30);
		expect(faux.state.callCount).toBe(calls);
		expect(JSON.stringify(session.messages)).toContain("Cancelled background command");
		const second = service.start({ command: "user stop" });
		second.stop();
		executor.call(1).resolve({ exitCode: null });
		await waitFor(() => second.snapshot.status === "stopped");
		expect(faux.state.callCount).toBe(calls);
		expect(
			session.messages.filter(
				(m) => m.role === "custom" && m.customType === BACKGROUND_COMMAND_COMPLETION_MESSAGE,
			),
		).toHaveLength(2);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.dispose({ timeoutMs: 10 });
		session.dispose();
	}
});

test("a detached command survives the parent-turn signal and reports after parent abort", async () => {
	const executor = controlledOperations();
	const sm = SessionManager.inMemory(cwd);
	const service = createBackgroundCommands(
		{ sessionId: sm.getSessionId(), getContext: () => ({ cwd }) },
		executor,
	);
	const session = await makeSession(createBackgroundCommandsExtension({ service }), sm);
	try {
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", { action: "start", command: "survive" }),
			),
			async () => {
				await Bun.sleep(150);
				return fauxAssistantMessage("SLOW_ACK");
			},
			fauxAssistantMessage("AFTER_ABORT_COMPLETION"),
		]);
		const callsBefore = faux.state.callCount;
		const prompted = session.prompt("Start and continue working.");
		await waitFor(() => executor.calls.length > 0);
		await waitFor(() => faux.state.callCount >= callsBefore + 2);
		await session.abort();
		await prompted;
		expect(executor.call().options.signal?.aborted).toBe(false);
		executor.call().resolve({ exitCode: 0 });
		await waitFor(() => JSON.stringify(session.messages).includes("AFTER_ABORT_COMPLETION"));
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.dispose({ timeoutMs: 10 });
		session.dispose();
	}
});

test("standalone shutdown kills owned process trees silently", async () => {
	const session = await makeSession();
	const escaped = join(cwd, "must-not-finish");
	const ready = join(cwd, "process-ready");
	try {
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", {
					action: "start",
					command: `sh -c 'printf ready > "${ready}"; sleep 0.4; printf leaked > "${escaped}"'`,
				}),
			),
			fauxAssistantMessage("ACK"),
			fauxAssistantMessage("MUST_NOT_WAKE"),
		]);
		await session.prompt("Start until shutdown.");
		await waitFor(() => existsSync(ready));
		const calls = faux.state.callCount;
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await Bun.sleep(500);
		expect(faux.state.callCount).toBe(calls);
		expect(existsSync(escaped)).toBe(false);
		expect(JSON.stringify(session.messages)).not.toContain(BACKGROUND_COMMAND_COMPLETION_MESSAGE);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
});

test("deletion tombstones defer bounded completion messages until rollback, without a resource reload", async () => {
	const executor = controlledOperations();
	const sm = SessionManager.inMemory(cwd);
	let canDeliver = false;
	const service = createBackgroundCommands(
		{
			sessionId: sm.getSessionId(),
			getContext: () => ({ cwd }),
			canDeliverCompletion: () => canDeliver,
		},
		executor,
	);
	const session = await makeSession(createBackgroundCommandsExtension({ service }), sm);
	try {
		const command = service.start({ command: "x".repeat(64000), name: "bounded" });
		executor.call().options.onData(Buffer.from("🦊".repeat(20000)));
		executor.call().resolve({ exitCode: 0 });
		await waitFor(() => command.snapshot.status === "completed");
		expect(session.messages.filter((m) => m.role === "custom")).toHaveLength(0);
		faux.setResponses([fauxAssistantMessage("AFTER_ROLLBACK")]);
		canDeliver = true;
		service.flushCompletions();
		await waitFor(() => JSON.stringify(session.messages).includes("AFTER_ROLLBACK"));
		const message = session.messages.find(
			(m) => m.role === "custom" && m.customType === BACKGROUND_COMMAND_COMPLETION_MESSAGE,
		);
		if (message?.role !== "custom" || typeof message.content !== "string")
			throw new Error("Missing completion");
		expect(Buffer.byteLength(message.content)).toBeLessThan(5000);
		expect(message.content).toContain("truncated");
		expect(message.content).not.toContain("�");
		expect(JSON.stringify(message)).not.toContain("x".repeat(64000));
		service.flushCompletions();
		expect(session.messages.filter((m) => m.role === "custom")).toHaveLength(1);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.dispose({ timeoutMs: 10 });
		session.dispose();
	}
});

test("tool actions reject cross-action inputs and unknown or foreign identities", async () => {
	const executor = controlledOperations();
	const sm = SessionManager.inMemory(cwd);
	const service = createBackgroundCommands(
		{ sessionId: sm.getSessionId(), getContext: () => ({ cwd }) },
		executor,
	);
	const session = await makeSession(createBackgroundCommandsExtension({ service }), sm);
	const other = createBackgroundCommands(
		{ sessionId: "other", getContext: () => ({ cwd }) },
		executor,
	);
	const foreign = other.start({ command: "foreign" });
	try {
		for (const input of [
			{ action: "list", command: "not accepted" },
			{ action: "stop", command: "must not create", id: foreign.id },
			{ action: "output", id: foreign.id },
			{ action: "stop", id: foreign.id },
			{ action: "stop", id: "../private.log" },
			{ action: "start" },
			{ action: "start", command: "x", cwd: "/tmp" },
			{ action: "start", command: "x", env: { DANGER: "yes" } },
			{ action: "output", id: "bogus", path: "/etc/passwd" },
			{ action: "stop", pid: 123 },
		]) {
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("background_command", input)),
				fauxAssistantMessage("HANDLED"),
			]);
			await session.prompt("Try an invalid call.");
			const last = session.messages.filter((m) => m.role === "toolResult").at(-1);
			expect(last).toMatchObject({ isError: true });
			expect(service.list()).toEqual([]);
			expect(executor.calls).toHaveLength(1);
		}
		expect(foreign.snapshot.status).toBe("running");
		expect(executor.call().options.signal?.aborted).toBe(false);
	} finally {
		executor.call().resolve({ exitCode: 0 });
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.dispose();
		await other.dispose();
		session.dispose();
	}
});
