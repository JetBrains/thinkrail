import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent, AgentHandle, AgentResult, SessionRef } from "@thinkrail/ext";
import { createDelegationService, type DelegationService, type RunOutcome } from "pi-delegation";
import { createExtHost } from "./index";

const HOST_HALF = `
import { defineExtension } from "@thinkrail/ext";
import { Type } from "typebox";
const bag = (globalThis.__agentsBag ??= { events: [], handles: [] });
export default defineExtension((tr) => {
	tr.agents.onEvent((event) => bag.events.push(event));
	tr.action("run", (p) =>
		tr.agents.run({ task: p.task, role: "worker" }, { parent: p.parent, maxConcurrent: p.max }),
	);
	tr.action("spawn", async (p) => {
		const handle = await tr.agents.spawn({ task: p.task }, { parent: p.parent, maxConcurrent: p.max });
		bag.handles.push(handle);
		return handle.id;
	});
	tr.action("list", () => tr.agents.list().map((handle) => handle.id));
	tr.pi((pi) => {
		pi.registerTool({
			name: "delegate",
			label: "Delegate",
			description: "Run one subagent",
			parameters: Type.Object({ task: Type.String() }),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const result = await tr.agents.run({ task: params.task }, { parent: ctx });
				return { content: [{ type: "text", text: result.finalText ?? result.status }], details: result };
			},
		});
	});
});
`;

const faux = createFauxCore({
	provider: "agents-faux",
	api: "agents-faux",
	models: [
		{
			id: "agents-faux",
			name: "agents-faux",
			reasoning: false,
			input: ["text"],
			cost: { input: 1_000, output: 1_000, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
	tokensPerSecond: 100_000,
});

interface Bag {
	events: AgentEvent[];
	handles: AgentHandle[];
}

const bag = (): Bag => {
	const value: unknown = Reflect.get(globalThis, "__agentsBag");
	if (typeof value !== "object" || value === null) throw new Error("extension did not load");
	return value as Bag;
};

const slow =
	(text: string, ms = 300) =>
	async (_context: unknown, options?: { signal?: AbortSignal }) => {
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms);
			options?.signal?.addEventListener("abort", () => {
				clearTimeout(timer);
				resolve();
			});
		});
		return fauxAssistantMessage(text);
	};

let root: string;
let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let runtime: ModelRuntime;
let parent: AgentSession;
let service: DelegationService;
let base: string;
let host: ReturnType<typeof createExtHost>;

const tmp = (prefix: string) => mkdtempSync(join(root, prefix));

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "tr-agents-"));
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmp("agentdir-");
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("agents-faux", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: faux.models.map((model) => ({ ...model })),
	});
});

afterAll(() => {
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	rmSync(root, { recursive: true, force: true });
});

const makeHost = () => {
	const sessions = (): SessionRef[] => [
		{ sessionId: parent.sessionId, workspaceId: "w1", title: "parent", isStreaming: false },
	];
	return createExtHost({
		userDir: join(base, "extensions"),
		storeDir: join(base, "store"),
		sessions: {
			list: sessions,
			get: (id) => sessions().find((ref) => ref.sessionId === id),
			stats: () => ({}) as never,
		},
		agents: { serviceFor: (id) => (id === parent.sessionId ? service : undefined) },
	});
};

beforeEach(async () => {
	Reflect.set(globalThis, "__agentsBag", undefined);
	base = tmp("case-");
	const cwd = join(base, "repo");
	mkdirSync(cwd);
	const agentDir = join(base, ".pi-agent");
	mkdirSync(agentDir);
	const dir = join(base, "extensions", "fanout");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "extension.json"),
		JSON.stringify({ name: "fanout", surfaces: [{ id: "main", slot: "panel" }] }),
	);
	writeFileSync(join(dir, "index.ts"), HOST_HALF);
	writeFileSync(join(dir, "main.tsx"), "export default () => null;\n");

	parent = await startParent(cwd, agentDir, []);
	service = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot: join(base, "delegation"),
		scope: "w1",
		modelRuntime: runtime,
		maxConcurrentPerParent: 1,
	});
	host = makeHost();
	await host.setProjectRoots([]);
	expect(host.get("fanout")).toMatchObject({ status: "active" });
});

afterEach(async () => {
	await host.dispose();
	await service.disposeChildrenOf(parent.sessionId);
	parent.dispose();
	faux.setResponses([]);
});

const startParent = async (
	cwd: string,
	agentDir: string,
	extensionFactories: ReturnType<typeof host.piFactories>,
) => {
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories,
	});
	await resourceLoader.reload();
	const model = runtime.getModel("agents-faux", "agents-faux");
	if (!model) throw new Error("faux model missing");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model,
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});
	return session;
};

const action = (id: string, payload: unknown) =>
	host.invokeAction({ ext: "fanout", id, payload, ctx: {} });

const until = async (check: () => boolean) => {
	for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
	expect(check()).toBe(true);
};

test("run spawns a hidden delegation child, reports lifecycle and pi's usage, then disposes it", async () => {
	faux.setResponses([fauxAssistantMessage("CHILD_DONE")]);
	const outcomes: RunOutcome[] = [];
	service.onLifecycle((event) => {
		if (event.type === "run-terminal") outcomes.push(event.outcome);
	});
	const result = (await action("run", { task: "Do it.", parent: parent.sessionId })) as AgentResult;
	expect(result).toMatchObject({ status: "completed", finalText: "CHILD_DONE" });
	expect(result.model).toBe("agents-faux/agents-faux");
	expect(result.usage.turns).toBe(1);
	expect(result.usage.output).toBeGreaterThan(0);
	const [outcome] = outcomes;
	if (!outcome || outcomes.length !== 1) throw new Error("expected one delegation outcome");
	expect(result.usage).toEqual(outcome.details.usage);

	const types = bag().events.map((event) => event.type);
	expect(types[0]).toBe("queued");
	expect(types[1]).toBe("started");
	expect(types).toContain("progress");
	expect(types.at(-1)).toBe("settled");
	const settled = bag().events.at(-1);
	expect(settled).toMatchObject({ parentSessionId: parent.sessionId, role: "worker" });
	expect(settled?.type === "settled" && settled.result).toEqual(result);
	expect(service.childrenOf(parent.sessionId)).toEqual([]);
	expect(await action("list", {})).toEqual([]);
});

test("a tool passes its ctx as the parent", async () => {
	const factory = host.piFactories().find((each) => host.piFactoryOwner(each) === "fanout");
	if (!factory) throw new Error("no pi factory");
	const cwd = join(base, "repo");
	parent.dispose();
	parent = await startParent(cwd, join(base, ".pi-agent"), [factory]);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("delegate", { task: "Sub." }, { id: "d1" })]),
		fauxAssistantMessage("FROM_CHILD"),
		fauxAssistantMessage("PARENT_DONE"),
	]);
	await parent.prompt("delegate once");
	const toolResult = parent.messages.find(
		(message) => message.role === "toolResult" && message.toolCallId === "d1",
	);
	if (toolResult?.role !== "toolResult") throw new Error("no tool result");
	expect(toolResult.isError).toBe(false);
	expect(toolResult.content).toEqual([{ type: "text", text: "FROM_CHILD" }]);
	expect(bag().events.at(-1)).toMatchObject({ type: "settled", parentSessionId: parent.sessionId });
});

test("cancel aborts a running child and resolves its result", async () => {
	faux.setResponses([slow("TOO_LATE", 5_000)]);
	const id = await action("spawn", { task: "Slow.", parent: parent.sessionId });
	const handle = bag().handles[0];
	if (!handle) throw new Error("no handle");
	expect(handle.id).toBe(String(id));
	await until(() => handle.status === "running");
	expect(await action("list", {})).toEqual([handle.id]);
	const result = await handle.cancel();
	expect(result.status).toBe("aborted");
	expect(handle.status).toBe("aborted");
	expect(await handle.result).toBe(result);
});

test("maxConcurrent caps the extension's pool per parent, independent of the default pool", async () => {
	faux.setResponses([slow("A"), slow("B"), slow("C")]);
	let running = 0;
	let peak = 0;
	service.onLifecycle((event) => {
		if (event.type === "run-started") peak = Math.max(peak, ++running);
		if (event.type === "run-terminal") running--;
	});
	for (const task of ["A.", "B.", "C."])
		await action("spawn", { task, parent: parent.sessionId, max: 2 });
	const results = await Promise.all(bag().handles.map((handle) => handle.result));
	expect(results.map((result) => result.status)).toEqual(["completed", "completed", "completed"]);
	expect(peak).toBe(2);
	await expect(action("run", { task: "x", parent: parent.sessionId, max: 17 })).rejects.toThrow(
		"maxConcurrent must be an integer from 1 to 16",
	);
});

test("disposing the extension generation cancels every child it spawned", async () => {
	faux.setResponses([slow("NEVER", 5_000), slow("NEVER", 5_000)]);
	await action("spawn", { task: "One.", parent: parent.sessionId, max: 2 });
	await action("spawn", { task: "Two.", parent: parent.sessionId, max: 2 });
	const handles = bag().handles;
	await until(() => handles.every((handle) => handle.status === "running"));
	const startedAt = Date.now();
	await host.dispose();
	expect(Date.now() - startedAt).toBeLessThan(2_000);
	const results = await Promise.all(handles.map((handle) => handle.result));
	expect(results.map((result) => result.status)).toEqual(["aborted", "aborted"]);
	expect(service.childrenOf(parent.sessionId)).toEqual([]);
});

test("disposing the extension while a spawn creates its child waits for it and leaves no child", async () => {
	const createChild = service.createChild;
	let entered = false;
	let created = false;
	service.createChild = (spec) => {
		entered = true;
		return createChild(spec).finally(() => {
			created = true;
		});
	};
	const spawning = action("spawn", { task: "Late.", parent: parent.sessionId }).catch(
		(error: unknown) => error,
	);
	await until(() => entered);
	await host.dispose();
	expect(created).toBe(true);
	expect(service.childrenOf(parent.sessionId)).toEqual([]);
	expect(String(await spawning)).toContain("disposed while the agent was starting");
});

test("a parent that is not live fails with a clear error", async () => {
	await expect(action("run", { task: "x", parent: "gone" })).rejects.toThrow(
		"parent session gone is not live",
	);
	await expect(action("run", { task: "  ", parent: parent.sessionId })).rejects.toThrow(
		"task must be a non-empty string",
	);
});
