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

function environmentPathKey(env: NodeJS.ProcessEnv): string {
	return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

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
		await session.reload({
			beforeSessionStart: async () => {
				expect(executor.call().options.signal?.aborted).toBe(false);
				executor.call().resolve({ exitCode: 0 });
				await waitFor(() => service.list()[0]?.status === "completed");
				expect(JSON.stringify(session.messages)).not.toContain(
					BACKGROUND_COMMAND_COMPLETION_MESSAGE,
				);
			},
		});
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
	const processPathKey = environmentPathKey(process.env);
	const previousPath = process.env[processPathKey];
	const executor = controlledOperations();
	let launchContext: BackgroundCommandContext = { cwd };
	const service = createBackgroundCommands(
		{ sessionId: session.sessionId, getContext: () => launchContext },
		executor,
	);
	try {
		if (!context) throw new Error("Missing context");
		for (const key of stale) process.env[key] = "stale-other-session";
		process.env[processPathKey] = `/unrelated${delimiter}${previousPath ?? ""}`;
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
		await bash.execute(
			"parity",
			{ command: "ignored" },
			undefined,
			undefined,
			session.extensionRunner.createToolContext("parity", undefined),
		);
		launchContext = {
			cwd,
			model: context.model,
			thinkingLevel: context.thinkingLevel,
			sessionFile: context.sessionManager.getSessionFile(),
		};
		service.start({ command: "first" });
		expect(executor.call().options.env).toEqual(nativeEnv);
		const firstEnv = executor.call().options.env;
		expect(firstEnv?.[environmentPathKey(firstEnv)]?.split(delimiter)[0]).toBe(join(cwd, "bin"));
		expect(executor.call().options.env?.PI_REASONING_LEVEL).toBe("high");
		expect(executor.call().options.env?.PI_SESSION_FILE).toBeUndefined();
		executor.call().resolve({ exitCode: 0 });
		process.env[processPathKey] = `${join(cwd, "bin")}${delimiter}${previousPath ?? ""}`;
		session.setThinkingLevel("low");
		await bash.execute(
			"parity2",
			{ command: "ignored" },
			undefined,
			undefined,
			session.extensionRunner.createToolContext("parity2", undefined),
		);
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
		await privateBash.execute(
			"private",
			{ command: "ignored" },
			undefined,
			undefined,
			session.extensionRunner.createToolContext("private", undefined),
		);
		service.start({ command: "private" });
		expect(executor.call(2).options.env).toEqual(nativeEnv);
		executor.call(2).resolve({ exitCode: 0 });
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (previousPath === undefined) delete process.env[processPathKey];
		else process.env[processPathKey] = previousPath;
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
	const leakAfterMs = 3000;
	try {
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", {
					action: "start",
					command: `sh -c 'printf ready > "${ready}"; sleep ${leakAfterMs / 1000}; printf leaked > "${escaped}"'`,
				}),
			),
			fauxAssistantMessage("ACK"),
			fauxAssistantMessage("MUST_NOT_WAKE"),
		]);
		await session.prompt("Start until shutdown.");
		await waitFor(() => existsSync(ready));
		const readyAt = Date.now();
		const calls = faux.state.callCount;
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await Bun.sleep(Math.max(500, readyAt + leakAfterMs + 500 - Date.now()));
		expect(faux.state.callCount).toBe(calls);
		expect(existsSync(escaped)).toBe(false);
		expect(JSON.stringify(session.messages)).not.toContain(BACKGROUND_COMMAND_COMPLETION_MESSAGE);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
}, 15_000);

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

function macrotask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

type Session = Awaited<ReturnType<typeof makeSession>>;

function commandDeliveries(session: Session) {
	return session.sessionManager
		.getEntries()
		.flatMap((entry) =>
			entry.type === "custom_message" && entry.customType === BACKGROUND_COMMAND_COMPLETION_MESSAGE
				? [(entry.details as { delivery?: string }).delivery]
				: [],
		);
}

function countSettles(session: Session) {
	const counter = { settles: 0 };
	session.subscribe((event) => {
		if (event.type === "agent_settled") counter.settles++;
	});
	return counter;
}

async function injected(canDeliverCompletion?: () => boolean) {
	const executor = controlledOperations();
	const sm = SessionManager.inMemory(cwd);
	const service = createBackgroundCommands(
		{ sessionId: sm.getSessionId(), getContext: () => ({ cwd }) },
		executor,
	);
	const session = await makeSession(
		createBackgroundCommandsExtension({
			service,
			...(canDeliverCompletion ? { canDeliverCompletion } : {}),
		}),
		sm,
	);
	const finish = async (index: number, text: string, exitCode = 0) => {
		executor.call(index).options.onData?.(Buffer.from(text));
		executor.call(index).resolve({ exitCode });
		await waitFor(() => service.list()[index]?.finishedAt !== undefined);
		await macrotask();
	};
	const close = async () => {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.dispose();
		session.dispose();
	};
	return { executor, service, session, finish, close };
}

function startCommand(command: string) {
	return fauxAssistantMessage(fauxToolCall("background_command", { action: "start", command }));
}

test("a command finishing during a tool turn reaches the next request of the same run", async () => {
	const { service, session, finish, close } = await injected();
	const counter = countSettles(session);
	let sawReport = false;
	try {
		faux.setResponses([
			startCommand("work"),
			async () => {
				await finish(0, "CMD_DONE");
				return fauxAssistantMessage(fauxToolCall("background_command", { action: "list" }));
			},
			(context) => {
				sawReport = JSON.stringify(context.messages).includes("CMD_DONE");
				return fauxAssistantMessage("DONE");
			},
		]);
		await session.prompt("Start and keep working.");
		await macrotask();
		expect(sawReport).toBe(true);
		expect(counter.settles).toBe(1);
		expect(commandDeliveries(session)).toEqual(["run"]);
		expect(service.list()[0]?.status).toBe("completed");
	} finally {
		await close();
	}
});

test("a finished command whose output the model read is never reported again", async () => {
	const { service, session, finish, close } = await injected();
	try {
		faux.setResponses([
			startCommand("work"),
			async () => {
				await finish(0, "CMD_OUTPUT", 3);
				return fauxAssistantMessage(
					fauxToolCall("background_command", { action: "output", id: service.list()[0]?.id ?? "" }),
				);
			},
			fauxAssistantMessage("DONE"),
			fauxAssistantMessage("ALREADY_SEEN"),
		]);
		const before = faux.state.callCount;
		await session.prompt("Start, then read the output.");
		await macrotask();
		expect(commandDeliveries(session)).toEqual([]);
		expect(faux.state.callCount - before).toBe(3);
		const read = session.messages.filter((m) => m.role === "toolResult").at(-1);
		expect(JSON.stringify(read)).toContain("error, exit code 3");
		expect(JSON.stringify(read)).toContain("Command exited with code 3");
	} finally {
		await close();
	}
});

test("a host read of finished output never suppresses the command's report", async () => {
	let allowed = false;
	const { service, session, finish, close } = await injected(() => allowed);
	try {
		faux.setResponses([
			startCommand("work"),
			fauxAssistantMessage("ACK"),
			fauxAssistantMessage("SEEN"),
		]);
		await session.prompt("Start.");
		await finish(0, "HOST_READ");
		const id = service.list()[0]?.id ?? "";
		expect(service.find(id)?.output?.text).toContain("HOST_READ");
		allowed = true;
		service.flushCompletions();
		await waitFor(() => !session.isStreaming && commandDeliveries(session).length === 1);
		expect(commandDeliveries(session)).toEqual(["wake"]);
	} finally {
		await close();
	}
});

test("commands released to an idle parent together wake exactly one run", async () => {
	let allowed = false;
	const { service, session, finish, close } = await injected(() => allowed);
	const counter = countSettles(session);
	let reports = 0;
	try {
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("background_command", { action: "start", command: "one" }),
				fauxToolCall("background_command", { action: "start", command: "two" }),
			]),
			fauxAssistantMessage("STARTED"),
			(context) => {
				const text = JSON.stringify(context.messages);
				reports = ["FIRST_CMD", "SECOND_CMD"].filter((r) => text.includes(r)).length;
				return fauxAssistantMessage("WOKEN_ONCE");
			},
			fauxAssistantMessage("SECOND_WAKE"),
		]);
		await session.prompt("Start two.");
		await finish(0, "FIRST_CMD");
		await finish(1, "SECOND_CMD");
		expect(commandDeliveries(session)).toEqual([]);
		allowed = true;
		service.flushCompletions();
		await waitFor(() => !session.isStreaming && counter.settles === 2);
		await macrotask();
		expect(counter.settles).toBe(2);
		expect(reports).toBe(2);
		expect(commandDeliveries(session)).toEqual(["wake", "run"]);
		expect(JSON.stringify(session.messages)).not.toContain("SECOND_WAKE");
	} finally {
		await close();
	}
});

test("a command held when the user stops the parent is shown without waking it", async () => {
	const { session, finish, close } = await injected();
	const counter = countSettles(session);
	let parked = () => {};
	const parkedPromise = new Promise<void>((resolve) => {
		parked = resolve;
	});
	try {
		faux.setResponses([
			startCommand("work"),
			async (_context, options) => {
				await finish(0, "HELD_AT_STOP");
				parked();
				await new Promise((resolve) =>
					options?.signal?.addEventListener("abort", resolve, { once: true }),
				);
				return fauxAssistantMessage("ABORTED");
			},
			fauxAssistantMessage("WOKE_AFTER_STOP"),
		]);
		const run = session.prompt("Start, then get stopped.");
		await parkedPromise;
		const callsAtStop = faux.state.callCount;
		await session.abort();
		await run;
		await waitFor(() => commandDeliveries(session).length === 1);
		await macrotask();
		expect(commandDeliveries(session)).toEqual(["appended"]);
		expect(faux.state.callCount).toBe(callsAtStop);
		expect(counter.settles).toBe(1);
	} finally {
		await close();
	}
});

test("several commands held when the user stops the parent are all shown without waking it", async () => {
	const { session, finish, close } = await injected();
	const counter = countSettles(session);
	let parked = () => {};
	const parkedPromise = new Promise<void>((resolve) => {
		parked = resolve;
	});
	try {
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("background_command", { action: "start", command: "one" }),
				fauxToolCall("background_command", { action: "start", command: "two" }),
			]),
			async (_context, options) => {
				await finish(0, "FIRST_HELD");
				await finish(1, "SECOND_HELD");
				parked();
				await new Promise((resolve) =>
					options?.signal?.addEventListener("abort", resolve, { once: true }),
				);
				return fauxAssistantMessage("ABORTED");
			},
			fauxAssistantMessage("WOKE_AFTER_STOP"),
		]);
		const run = session.prompt("Start two, then get stopped.");
		await parkedPromise;
		const callsAtStop = faux.state.callCount;
		await session.abort();
		await run;
		await waitFor(() => commandDeliveries(session).length === 2);
		await macrotask();
		expect(commandDeliveries(session)).toEqual(["appended", "appended"]);
		expect(faux.state.callCount).toBe(callsAtStop);
		expect(counter.settles).toBe(1);
	} finally {
		await close();
	}
});

test("a rejected waking send keeps the wake for the retry instead of losing it", async () => {
	let allowed = false;
	let rejectWake = true;
	const executor = controlledOperations();
	const sm = SessionManager.inMemory(cwd);
	const service = createBackgroundCommands(
		{ sessionId: sm.getSessionId(), getContext: () => ({ cwd }) },
		executor,
	);
	const extension = createBackgroundCommandsExtension({
		service,
		canDeliverCompletion: () => allowed,
	});
	const session = await makeSession(
		(pi) =>
			extension({
				...pi,
				sendMessage: (message, options) => {
					if (options?.triggerTurn && rejectWake) {
						rejectWake = false;
						throw new Error("runtime unavailable");
					}
					pi.sendMessage(message, options);
				},
			}),
		sm,
	);
	const counter = countSettles(session);
	let sawNatural = false;
	try {
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("background_command", { action: "start", command: "natural" }),
				fauxToolCall("background_command", { action: "start", command: "stopped" }),
			]),
			fauxAssistantMessage("STARTED"),
			(context) => {
				sawNatural = JSON.stringify(context.messages).includes("NATURAL_RESULT");
				return fauxAssistantMessage("WOKEN");
			},
		]);
		await session.prompt("Start two.");
		executor.call(0).options.onData?.(Buffer.from("NATURAL_RESULT"));
		executor.call(0).resolve({ exitCode: 0 });
		service.list()[1] && service.find(service.list()[1]?.id ?? "")?.stop();
		executor.call(1).resolve({ exitCode: null });
		await waitFor(() => service.list().every((snapshot) => snapshot.finishedAt !== undefined));
		allowed = true;
		service.flushCompletions();
		expect(commandDeliveries(session)).toHaveLength(1);
		expect(counter.settles).toBe(1);
		service.flushCompletions();
		await waitFor(() => !session.isStreaming && counter.settles === 2);
		expect(sawNatural).toBe(true);
		expect(commandDeliveries(session)).toHaveLength(2);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await service.dispose();
		session.dispose();
	}
});

test("one factory serving two sessions keeps each session's Stop to itself", async () => {
	let allowed = false;
	const factory = createBackgroundCommandsExtension({ canDeliverCompletion: () => allowed });
	const first = await makeSession(factory);
	const second = await makeSession(factory);
	let parked = () => {};
	const parkedPromise = new Promise<void>((resolve) => {
		parked = resolve;
	});
	try {
		faux.setResponses([
			startCommand("printf HELD_IN_FIRST"),
			async (_context, options) => {
				await Bun.sleep(300);
				parked();
				await new Promise((resolve) =>
					options?.signal?.addEventListener("abort", resolve, { once: true }),
				);
				return fauxAssistantMessage("ABORTED");
			},
		]);
		const run = first.prompt("Start, then get stopped.");
		await parkedPromise;
		await first.abort();
		await run;
		await macrotask();
		faux.setResponses([fauxAssistantMessage("SECOND_ANSWER")]);
		await second.prompt("An unrelated question in another chat.");
		const calls = faux.state.callCount;
		faux.setResponses([fauxAssistantMessage("FIRST_WOKE")]);
		allowed = true;
		await first.extensionRunner.emit({
			type: "session_compact_failed",
			reason: "manual",
			aborted: true,
			willRetry: false,
			fromExtension: false,
		});
		await waitFor(() => commandDeliveries(first).length === 1);
		await macrotask();
		expect(commandDeliveries(first)).toEqual(["appended"]);
		expect(faux.state.callCount).toBe(calls);
		expect(JSON.stringify(first.messages)).not.toContain("FIRST_WOKE");
	} finally {
		await first.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await second.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		first.dispose();
		second.dispose();
	}
});
