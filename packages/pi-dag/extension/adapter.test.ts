import { afterAll, afterEach, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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
	type ExtensionFactory,
	type ExtensionUIContext,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type SessionShutdownEvent,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createDelegationService } from "pi-delegation";
import { Check } from "typebox/value";
import standalone, {
	createDagExtension,
	createDagService,
	type DagCallerBinding,
	type DagClient,
	type DagCommandRequest,
	type DagDefinition,
	type DagNotice,
	type DagReceipt,
	type DagResult,
	type DagService,
	type DagSnapshot,
} from "../index.ts";

const root = mkdtempSync(join(tmpdir(), "dag-adapter-"));
const controller = createFauxCore({
	provider: "dag-controller",
	api: "dag-controller",
	tokensPerSecond: 100_000,
});
const worker = createFauxCore({
	provider: "dag-worker",
	api: "dag-worker",
	tokensPerSecond: 100_000,
});
const workerModel = { provider: worker.provider, id: worker.getModel().id };
let runtime: ModelRuntime;
let previousAgentDir: string | undefined;
let previousOffline: string | undefined;
let serial = 0;
const sessions: AgentSession[] = [];
const services: DagService[] = [];
const errors = new Map<AgentSession, string[]>();
const releases: Array<() => void> = [];
const failure = {
	ok: false,
	error: { code: "stale-version", currentVersion: 17, message: "Version changed" },
} as const;

beforeAll(async () => {
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	previousOffline = process.env.PI_OFFLINE;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	for (const faux of [controller, worker])
		runtime.registerProvider(faux.provider, {
			api: faux.api,
			baseUrl: "http://faux.invalid",
			apiKey: "isolated-synthetic",
			streamSimple: faux.streamSimple,
			models: faux.models,
		});
});
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	for (const session of sessions.splice(0)) {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		expect(errors.get(session)).toEqual([]);
	}
	errors.clear();
	for (const service of services.splice(0)) await service.close();
});
afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	if (previousOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = previousOffline;
	rmSync(root, { recursive: true, force: true });
});

function latch() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	releases.push(release);
	return { promise, release };
}
function value<T>(result: DagResult<T>): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}
function definition(): DagDefinition {
	return {
		title: "Adapter graph",
		defaults: { tools: [], model: workerModel },
		nodes: [{ id: "work", task: "Local work", outputs: {} }],
		connections: [],
	};
}
function boundary() {
	const client = {
		execute: mock<DagClient["execute"]>(async () => failure),
		listDags: mock<DagClient["listDags"]>(async () => failure),
		getDag: mock<DagClient["getDag"]>(async () => failure),
		getOutput: mock<DagClient["getOutput"]>(async () => failure),
		listHistory: mock<DagClient["listHistory"]>(async () => failure),
	};
	return {
		client,
		service: { bind: mock((_binding: DagCallerBinding) => client), close: mock(async () => {}) },
	};
}
function fixture() {
	const scope = `adapter-${serial++}`;
	const service = createDagService({
		storageRoot: join(root, "dags"),
		scope,
		delegation: createDelegationService({ delegationRoot: join(root, "delegation"), scope }),
	});
	services.push(service);
	const owner = service.bind({
		caller: { kind: "owner", ownerId: "test-host" },
		signal: new AbortController().signal,
	});
	return { service, owner };
}
async function resources(factory: ExtensionFactory, cwd: string) {
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [factory],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	return { resourceLoader, settingsManager };
}
async function sessionWith(
	factory: ExtensionFactory,
	cwd = join(root, `workspace-${serial++}`),
	manager = SessionManager.inMemory(cwd),
) {
	mkdirSync(cwd, { recursive: true });
	const { session } = await createAgentSession({
		cwd,
		...(await resources(factory, cwd)),
		sessionManager: manager,
		modelRuntime: runtime,
		model: controller.getModel(),
		noTools: "builtin",
	});
	sessions.push(session);
	const reported: string[] = [];
	errors.set(session, reported);
	await session.bindExtensions({ mode: "print", onError: (error) => reported.push(error.error) });
	return session;
}
async function tool<T>(
	session: AgentSession,
	name: string,
	args: Record<string, unknown>,
	id = `invocation-${serial++}`,
	signal?: AbortSignal,
): Promise<DagResult<T>> {
	const definition = session.getToolDefinition(name);
	if (!definition) throw new Error(`Missing tool ${name}`);
	const result = await definition.execute(
		id,
		args,
		signal,
		undefined,
		session.extensionRunner.createContext(),
	);
	expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.details, null, 2) }]);
	return result.details as DagResult<T>;
}
async function snapshot(session: AgentSession, dagId: string) {
	return value(await tool<DagSnapshot>(session, "dag_read", { query: { kind: "get", dagId } }));
}
async function until(
	read: () => Promise<DagSnapshot>,
	predicate: (snapshot: DagSnapshot) => boolean,
) {
	for (let attempt = 0; attempt < 500; attempt++) {
		const state = await read();
		if (predicate(state)) return state;
		await Bun.sleep(10);
	}
	throw new Error("DAG did not reach expected state");
}
async function shutdown(session: AgentSession, reason: SessionShutdownEvent["reason"]) {
	await session.extensionRunner.emit({ type: "session_shutdown", reason });
}
function ui(session: AgentSession, confirm: ExtensionUIContext["confirm"]) {
	const notify = spyOn(session.extensionRunner.getUIContext(), "notify");
	session.extensionRunner.setUIContext(
		{ ...session.extensionRunner.getUIContext(), confirm },
		"rpc",
	);
	return notify;
}
async function create(session: AgentSession, graph = definition()) {
	return value(
		await tool<DagReceipt>(session, "dag_create", {
			commandId: `create-${serial++}`,
			definition: graph,
		}),
	);
}
async function resume(session: AgentSession, receipt: DagReceipt) {
	return value(
		await tool<DagReceipt>(session, "dag_control", {
			commandId: `resume-${serial++}`,
			dagId: receipt.dagId,
			expectedVersion: receipt.version,
			command: { kind: "resume" },
		}),
	);
}
function notices(session: AgentSession) {
	return session.messages.filter(
		(message) => message.role === "custom" && message.customType === "dag-notice",
	);
}

test("tools preserve exact requests and trusted invocation identity; reads project no execution", async () => {
	const f = boundary();
	let projections = 0;
	const session = await sessionWith(
		createDagExtension({
			service: f.service,
			executionContext(ctx) {
				projections++;
				return { kind: "runtime", modelRuntime: runtime, cwd: ctx.cwd, model: workerModel };
			},
		}),
	);
	const graph = definition();
	const envelope = { commandId: "logical-command", dagId: "dag", expectedVersion: 23 };
	const edits = [{ kind: "put-node", node: { id: "second", task: "Second", outputs: {} } }];
	const pause = { ...envelope, command: { kind: "pause" } };
	const approve = { ...envelope, command: { kind: "approve", gateId: "gate", reason: "Review" } };
	for (const [name, args, expected] of [
		[
			"dag_create",
			{ commandId: envelope.commandId, definition: graph },
			{ commandId: envelope.commandId, command: { kind: "create", definition: graph } },
		],
		["dag_edit", { ...envelope, edits }, { ...envelope, command: { kind: "edit", edits } }],
		["dag_control", pause, pause],
		["dag_decide", approve, approve],
	] as const) {
		expect(await tool(session, name, args, "actual-call")).toEqual(failure);
		expect(f.client.execute).toHaveBeenLastCalledWith(expected);
	}
	const before = worker.state.callCount + controller.state.callCount;
	for (const [method, query] of [
		["listDags", { kind: "list", limit: 7 }],
		["getDag", { kind: "get", dagId: "dag" }],
		["getOutput", { kind: "output", dagId: "dag", proposalId: "proposal", name: "result" }],
		["listHistory", { kind: "history", dagId: "dag", limit: 3 }],
	] as const) {
		await tool(session, "dag_read", { query });
		const { kind: _kind, ...request } = query;
		expect(f.client[method]).toHaveBeenCalledTimes(1);
		expect(f.client[method]).toHaveBeenLastCalledWith(request);
	}
	expect(projections).toBe(4);
	expect(worker.state.callCount + controller.state.callCount).toBe(before);
	const bindings = f.service.bind.mock.calls.map(([binding]) => binding);
	expect(bindings.filter((binding) => binding.notices)).toHaveLength(1);
	for (const binding of bindings.slice(1)) {
		expect(binding.caller).toEqual({ kind: "controller", sessionId: session.sessionId });
		expect(binding.signal.aborted).toBe(true);
		expect(binding.notices).toBeUndefined();
	}
	expect(bindings[1]?.mainHistory).toMatchObject({
		kind: "session",
		sessionId: session.sessionId,
		sessionManager: session.sessionManager,
		cut: { kind: "before-tool-call", toolCallId: "actual-call" },
	});
	for (const binding of bindings.slice(5)) {
		expect(binding.execution).toBeUndefined();
		expect(binding.mainHistory).toBeUndefined();
	}
});

test("schemas, cancellation and real pi error rendering preserve current context and supplied versions", async () => {
	const f = boundary();
	const session = await sessionWith(createDagExtension({ service: f.service }));
	const request: DagCommandRequest = {
		commandId: "pause",
		dagId: "dag",
		expectedVersion: 23,
		command: { kind: "pause" },
	};
	const schema = session.getToolDefinition("dag_control")?.parameters;
	const reads = session.getToolDefinition("dag_read")?.parameters;
	if (!schema || !reads) throw new Error("Missing tool schemas");
	expect(Check(schema, request)).toBe(true);
	expect(Check(schema, { ...request, actor: "human" })).toBe(false);
	expect(Check(schema, { ...request, command: { kind: "anything" } })).toBe(false);
	expect(Check(reads, { query: { kind: "sql", text: "select *" } })).toBe(false);
	await session.setModel(worker.getModel());
	await tool(session, "dag_control", request);
	expect(f.service.bind.mock.calls.at(-1)?.[0].execution).toEqual({
		kind: "registry",
		modelRegistry: session.extensionRunner.createContext().modelRegistry,
		cwd: session.sessionManager.getCwd(),
		model: workerModel,
		thinkingLevel: session.thinkingLevel,
	});
	f.service.bind.mockImplementationOnce((binding) => {
		expect(binding.signal.aborted).toBe(true);
		return f.client;
	});
	await tool(session, "dag_control", request, "cancelled", AbortSignal.abort());
	f.client.execute.mockClear();
	worker.setResponses([
		fauxAssistantMessage(fauxToolCall("dag_control", request)),
		fauxAssistantMessage("Inspected failure"),
	]);
	await session.prompt("Try the supplied version");
	expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
		isError: true,
		details: failure,
		content: [{ type: "text", text: JSON.stringify(failure, null, 2) }],
	});
	expect(f.client.execute.mock.calls).toEqual([[request]]);
	expect(f.client.getDag).not.toHaveBeenCalled();
});

test("real invocation history excludes the whole batch; replay needs no replacement execution context", async () => {
	const f = fixture();
	const graph = definition();
	graph.connections.push({
		id: "main",
		kind: "control",
		from: { kind: "main" },
		to: "work",
		context: "fork",
	});
	const session = await sessionWith(createDagExtension({ service: f.service }));
	controller.setResponses([
		fauxAssistantMessage([
			fauxToolCall(
				"dag_create",
				{ commandId: "stable-command", definition: graph },
				{ id: "real-invocation-id" },
			),
			fauxToolCall("dag_read", { query: { kind: "list" } }, { id: "sibling-call" }),
		]),
		fauxAssistantMessage("Done"),
	]);
	await session.prompt("CAPTURE_THIS_BEFORE_THE_BATCH");
	const result = session.messages.find(
		(message) => message.role === "toolResult" && message.toolName === "dag_create",
	);
	if (result?.role !== "toolResult") throw new Error("Missing create receipt");
	const receipt = value(result.details as DagResult<DagReceipt>);
	const state = value(await f.owner.getDag({ dagId: receipt.dagId }));
	if (!state.mainHistory) throw new Error("Missing main history");
	const history = readFileSync(state.mainHistory.localPath, "utf8");
	expect(history).toContain("CAPTURE_THIS_BEFORE_THE_BATCH");
	expect(history).not.toContain("real-invocation-id");
	expect(history).not.toContain("sibling-call");
	expect(state.mainHistory.sourceSessionId).toBe(session.sessionId);
	await shutdown(session, "new");
	const replacement = await sessionWith(
		createDagExtension({ service: f.service, executionContext: () => undefined }),
	);
	expect(
		await tool(
			replacement,
			"dag_create",
			{ commandId: "stable-command", definition: graph },
			"not-in-history",
		),
	).toEqual({ ok: true, value: receipt });
});

test("complete admitted topology remains readable beyond 64 KiB", async () => {
	const { service } = fixture();
	const session = await sessionWith(createDagExtension({ service }));
	const graph = definition();
	graph.nodes = Array.from({ length: 128 }, (_, index) => ({
		id: `node-${index}`,
		task: `${index} ${"large task ".repeat(70)}`,
		outputs: {},
	}));
	const receipt = await create(session, graph);
	const state = await snapshot(session, receipt.dagId);
	expect(JSON.stringify(state).length).toBeGreaterThan(64 * 1024);
	expect(state.nodes).toHaveLength(128);
	expect(state.nodes.at(-1)?.id).toBe("node-127");
});

test("operator requires confirmation, preserves human provenance, and cannot outlive its conversation", async () => {
	const f = boundary();
	let projections = 0;
	const factory = createDagExtension({
		service: f.service,
		executionContext: () => {
			projections++;
			return undefined;
		},
	});
	const session = await sessionWith(factory);
	const request: DagCommandRequest = {
		commandId: "human-pause",
		dagId: "dag",
		expectedVersion: 23,
		command: { kind: "pause" },
	};
	const command = `/dag ${JSON.stringify(request)}`;
	await session.prompt(command);
	let approved = false;
	const confirm = mock(async (_title: string, message: string) => {
		expect(JSON.parse(message)).toEqual(request);
		return approved;
	});
	const notify = ui(session, confirm);
	await session.prompt("/dag not-json");
	await session.prompt(`/dag ${JSON.stringify({ ...request, actor: "human" })}`);
	expect(notify).toHaveBeenCalledTimes(2);
	expect(confirm).not.toHaveBeenCalled();
	await session.prompt(command);
	expect(f.client.execute).not.toHaveBeenCalled();
	approved = true;
	const entryId = session.sessionManager.appendMessage({
		role: "user",
		content: "Human history",
		timestamp: Date.now(),
	});
	await session.prompt(command);
	expect(f.client.execute.mock.calls).toEqual([[request]]);
	const binding = f.service.bind.mock.calls.at(-1)?.[0];
	expect(binding?.caller).toEqual({
		kind: "human",
		operatorId: `pi:${session.sessionId}`,
		conversationId: session.sessionId,
	});
	expect(binding?.mainHistory?.cut).toEqual({ kind: "at-entry", entryId });
	expect(binding?.signal.aborted).toBe(true);
	expect(session.messages.at(-1)).toMatchObject({
		role: "custom",
		customType: "dag-command",
		details: failure,
	});
	for (const reason of ["new", "resume", "fork", "reload", "quit"] as const) {
		const switched = await sessionWith(factory);
		const entered = latch(),
			confirmed = latch();
		let signal: AbortSignal | undefined;
		ui(switched, async (_title, _message, options) => {
			signal = options?.signal;
			entered.release();
			await confirmed.promise;
			return true;
		});
		const pending = switched.prompt(command);
		await entered.promise;
		await shutdown(switched, reason);
		expect(signal?.aborted).toBe(true);
		confirmed.release();
		await pending;
	}
	expect(projections).toBe(1);
	expect(f.client.execute).toHaveBeenCalledTimes(1);
	expect(f.service.close).not.toHaveBeenCalled();
});

test("notice delivery waits for idle, wakes on agent_settled only, and stays passive and revocable", async () => {
	const f = boundary();
	const session = await sessionWith(createDagExtension({ service: f.service }));
	const binding = f.service.bind.mock.calls[0]?.[0];
	const sink = binding?.notices;
	if (!sink) throw new Error("Missing notice sink");
	const entered = latch(),
		finish = latch();
	const ready = mock(() => {});
	const remove = sink.onReady(ready);
	const notice: DagNotice = {
		dagId: "dag",
		noticeId: "waiting",
		version: 1,
		kind: "waiting",
		text: "Need input",
	};
	controller.setResponses([
		async () => {
			entered.release();
			await finish.promise;
			return fauxAssistantMessage("Finished");
		},
	]);
	const running = session.prompt("Stay busy");
	await entered.promise;
	expect(sink.tryDeliver(notice)).toBe("deferred");
	await session.extensionRunner.emit({ type: "agent_end", messages: [] });
	expect(ready).not.toHaveBeenCalled();
	expect(notices(session)).toEqual([]);
	finish.release();
	await running;
	expect(ready).toHaveBeenCalledTimes(1);
	expect(sink.tryDeliver(notice)).toBe("submitted");
	expect(notices(session)).toHaveLength(1);
	expect(notices(session)[0]).toMatchObject({ details: notice });
	const calls = controller.state.callCount;
	await Bun.sleep(30);
	expect(controller.state.callCount).toBe(calls);
	await shutdown(session, "resume");
	await session.extensionRunner.emit({ type: "agent_settled" });
	expect(ready).toHaveBeenCalledTimes(1);
	expect(binding.signal.aborted).toBe(true);
	expect(sink.tryDeliver(notice)).toBe("deferred");
	remove();
});

async function replacedModule() {
	const loaded: { default: ExtensionFactory } = await import(
		`./standalone.ts?replacement=${serial++}`
	);
	expect(loaded.default).not.toBe(standalone);
	return loaded.default;
}

test("standalone owners survive replaced modules and new/resume/fork, including cwd aliases", async () => {
	const first = await sessionWith(standalone);
	const entered = latch(),
		finish = latch();
	let workerSignal: AbortSignal | undefined;
	worker.setResponses([
		async (_context, options) => {
			workerSignal = options?.signal;
			entered.release();
			await finish.promise;
			return fauxAssistantMessage(fauxToolCall("dag_submit_result", { outputs: {} }));
		},
	]);
	const receipt = await create(first);
	await resume(first, receipt);
	await entered.promise;
	let current = first;
	const alias = join(root, `alias-${serial++}`);
	symlinkSync(first.sessionManager.getCwd(), alias);
	for (const reason of ["new", "resume", "fork"] as const) {
		await shutdown(current, reason);
		current.dispose();
		current = await sessionWith(await replacedModule(), alias);
		const state = await snapshot(current, receipt.dagId);
		expect(state.mode).toBe("running");
		expect(state.executionOwner).toBe("local");
		expect(["queued", "running"]).toContain(state.nodes[0]?.status ?? "missing");
		expect(workerSignal?.aborted).toBe(false);
	}
	finish.release();
	const complete = await until(
		() => snapshot(current, receipt.dagId),
		(state) => state.nodes[0]?.status === "completed",
	);
	expect(complete.nodes[0]?.attempt).toBe(1);
});

test.each([
	"reload",
	"quit",
] as const)("standalone %s awaits all scopes, blocks acquisition, then restores paused", async (reason) => {
	const first = await sessionWith(await replacedModule());
	const entered = latch(),
		aborted = latch(),
		allowSettlement = latch();
	worker.setResponses([
		async (_context, options) => {
			entered.release();
			options?.signal?.addEventListener("abort", aborted.release, { once: true });
			await allowSettlement.promise;
			return fauxAssistantMessage("Interrupted local work");
		},
	]);
	const receipt = await create(first);
	await resume(first, receipt);
	await entered.promise;
	await shutdown(first, "new");
	const second = await sessionWith(await replacedModule());
	const secondReceipt = await create(second);
	const pendingCreate = create(second).catch((error: unknown) => error);
	let closed = false;
	const closing = shutdown(second, reason).then(() => {
		closed = true;
	});
	await aborted.promise;
	expect(closed).toBe(false);
	const during = await sessionWith(await replacedModule());
	expect(errors.get(during)?.splice(0)).toEqual(["DAG standalone owners are closing"]);
	expect(await tool(during, "dag_read", { query: { kind: "list" } })).toMatchObject({
		ok: false,
		error: { code: "revoked" },
	});
	allowSettlement.release();
	await closing;
	await pendingCreate;
	expect(closed).toBe(true);
	const replacement = await sessionWith(await replacedModule(), first.sessionManager.getCwd());
	const state = await snapshot(replacement, receipt.dagId);
	expect(state.mode).toBe("paused");
	expect(state.executionOwner).toBe("none");
	expect(state.lifecycle).toBe("active");
	expect(state.nodes[0]?.status).toBe("interrupted");
	const secondReplacement = await sessionWith(
		await replacedModule(),
		second.sessionManager.getCwd(),
	);
	expect((await snapshot(secondReplacement, secondReceipt.dagId)).executionOwner).toBe("none");
	const calls = worker.state.callCount;
	await Bun.sleep(30);
	expect(worker.state.callCount).toBe(calls);
});

test("standalone canonicalizes an initially absent agent root through its existing symlink ancestor", async () => {
	const original = getAgentDir();
	const base = join(root, `canonical-${serial++}`);
	const alias = `${base}-alias`;
	mkdirSync(base);
	symlinkSync(base, alias);
	try {
		process.env.PI_CODING_AGENT_DIR = join(alias, "missing", "agent");
		const first = await sessionWith(await replacedModule());
		const receipt = await create(first);
		await shutdown(first, "new");
		process.env.PI_CODING_AGENT_DIR = join(base, "missing", "agent");
		const replacement = await sessionWith(await replacedModule(), first.sessionManager.getCwd());
		expect((await snapshot(replacement, receipt.dagId)).executionOwner).toBe("local");
		await shutdown(replacement, "quit");
		const fresh = await sessionWith(await replacedModule(), first.sessionManager.getCwd());
		expect((await snapshot(fresh, receipt.dagId)).executionOwner).toBe("none");
	} finally {
		process.env.PI_CODING_AGENT_DIR = original;
	}
});

test("factory loading is lazy and incompatible process registries fail loudly across module replacement", async () => {
	const key = Symbol.for("pi-dag.standalone-owners");
	expect(Reflect.get(globalThis, key)).toBeUndefined();
	await resources(await replacedModule(), root);
	expect(Reflect.get(globalThis, key)).toBeUndefined();
	for (const incompatible of [
		{ version: 0, owners: new Map() },
		{ version: 1, owners: "not owners" },
	]) {
		Reflect.set(globalThis, key, incompatible);
		try {
			const session = await sessionWith(await replacedModule());
			expect(errors.get(session)?.splice(0)).toEqual([
				"Incompatible pi-dag standalone owner registry; restart the process",
			]);
			expect(await tool(session, "dag_read", { query: { kind: "list" } })).toMatchObject({
				ok: false,
				error: { code: "revoked" },
			});
			expect(Reflect.get(globalThis, key)).toBe(incompatible);
		} finally {
			Reflect.deleteProperty(globalThis, key);
		}
	}
});
