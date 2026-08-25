// The delegation service against REAL child sessions — a real ModelRuntime with an in-process faux
// provider (no auth, no network), the same pattern as the server's agentSessionManager tests. The
// loud V1 rejections are unit-pinned here (task-spec acceptance #2).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createDelegationService } from "./service";
import { deriveChildSessionFile } from "./storage";
import { DelegationError, type DelegationService, type LifecycleEvent } from "./types";

const faux = createFauxCore({
	provider: "faux",
	api: "faux",
	models: [
		{
			id: "faux",
			name: "faux",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
	tokensPerSecond: 4000,
});

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
let delegationRoot: string;
let service: DelegationService;
const events: LifecycleEvent[] = [];

function fauxModel(): Model<string> {
	const model = runtime.getModel("faux", "faux");
	if (!model) throw new Error("faux model not registered");
	return model;
}

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmpDir("pi-delegation-agentdir-");
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("faux", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [
			{
				id: "faux",
				name: "faux",
				api: faux.api,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});

	parentCwd = tmpDir("pi-delegation-parent-");
	const created = await createAgentSession({
		cwd: parentCwd,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(parentCwd),
		settingsManager: SettingsManager.inMemory({}),
		model: fauxModel(),
	});
	parent = created.session;

	delegationRoot = tmpDir("pi-delegation-root-");
	// The projection an embedder derives from its live parent (pure pi passes `ctx` directly).
	const parentProjection = (id: string) =>
		id === parent.sessionId
			? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
			: undefined;
	service = createDelegationService({
		resolveParent: parentProjection,
		delegationRoot,
		scope: "ws-test",
		modelRuntime: runtime,
	});
	service.onLifecycle((event) => events.push(event));
});

afterAll(() => {
	parent?.dispose();
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function subagentSpec(overrides: Record<string, unknown> = {}) {
	return {
		parent: parent.sessionId,
		visibility: "hidden" as const,
		info: { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" },
		session: { systemPrompt: "You are a test scout.", tools: [] as string[] },
		...overrides,
	};
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
	const error = await promise.then(
		() => {
			throw new Error("expected a DelegationError rejection");
		},
		(e) => e,
	);
	expect(error).toBeInstanceOf(DelegationError);
	return (error as DelegationError).code;
}

// ── Loud V1 rejections (acceptance #2) ─────────────────────────────────────────

test('visibility "listed" rejects: not-implemented', async () => {
	expect(await codeOf(service.createChild(subagentSpec({ visibility: "listed" })))).toBe(
		"not-implemented",
	);
});

test("hidden + interactive rejects: invalid-combination (permanent)", async () => {
	expect(await codeOf(service.createChild(subagentSpec({ interactive: true })))).toBe(
		"invalid-combination",
	);
});

test("fork/seeded origins reject: not-implemented", async () => {
	expect(
		await codeOf(
			service.createChild(subagentSpec({ origin: { kind: "fork", sourceSessionId: "x" } })),
		),
	).toBe("not-implemented");
	expect(
		await codeOf(service.createChild(subagentSpec({ origin: { kind: "seeded", digest: "d" } }))),
	).toBe("not-implemented");
});

test("absent session options reject: not-implemented (no parent-like consumer)", async () => {
	expect(await codeOf(service.createChild(subagentSpec({ session: undefined })))).toBe(
		"not-implemented",
	);
});

test("a workspace provider rejects: not-implemented (no V1 consumer)", async () => {
	const workspace = {
		prepare: () => Promise.reject(new Error("never called")),
	};
	expect(await codeOf(service.createChild(subagentSpec({ workspace })))).toBe("not-implemented");
});

test("an unknown parent rejects: unknown-parent", async () => {
	expect(await codeOf(service.createChild(subagentSpec({ parent: "nope" })))).toBe(
		"unknown-parent",
	);
});

test("runNow rejects: not-implemented (no V1 consumer)", async () => {
	const child = await service.createChild(subagentSpec());
	try {
		expect(() => child.runNow("task")).toThrow(DelegationError);
	} finally {
		await child.dispose();
	}
});

// ── The V1 combination end to end ──────────────────────────────────────────────

test("a foreground run completes: outcome, registry, lineage storage, lifecycle events", async () => {
	events.length = 0;
	faux.setResponses([fauxAssistantMessage("CHILD_DONE")]);

	const child = await service.createChild(subagentSpec());
	expect(child.record.parentSessionId).toBe(parent.sessionId);
	expect(child.record.scope).toBe("ws-test");
	expect(child.record.visibility).toBe("hidden");
	// Hidden children persist under the delegation root, never pi's default sessions root.
	expect(
		child.record.sessionFile.startsWith(join(delegationRoot, "ws-test", parent.sessionId)),
	).toBe(true);

	const updates: string[] = [];
	const outcome = await child.runQueued("Report done.", {
		onUpdate: (details) => updates.push(details.status),
	});

	expect(outcome.status).toBe("completed");
	expect(outcome.finalText).toBe("CHILD_DONE");
	expect(outcome.details.childSessionId).toBe(child.sessionId);
	expect(outcome.details.model).toBe("faux/faux");
	expect(outcome.details.usage.turns).toBe(1);
	expect(outcome.details.roleName).toBe("scout");

	// Registry: latest snapshot is terminal; collectResult marks it collected.
	expect(child.snapshot?.status).toBe("completed");
	expect(child.snapshot?.collected).toBe(false);
	expect(child.collectResult()?.collected).toBe(true);

	// The transcript is on disk and derivable from ids alone (post-restart read).
	const derived = deriveChildSessionFile(
		delegationRoot,
		"ws-test",
		parent.sessionId,
		child.sessionId,
	);
	expect(derived).toBe(child.record.sessionFile);
	expect(derived !== undefined && existsSync(derived)).toBe(true);

	// Lookups: by child id and by parent id.
	expect(service.findChild(child.sessionId)).toBeDefined();
	expect(service.childrenOf(parent.sessionId).map((h) => h.sessionId)).toContain(child.sessionId);

	// Lifecycle order for this child.
	const forChild = events.filter(
		(e) => e.type === "child-created" || ("sessionId" in e && e.sessionId === child.sessionId),
	);
	expect(forChild.map((e) => e.type)).toEqual([
		"child-created",
		"run-queued",
		"run-started",
		"run-terminal",
	]);

	await child.dispose();
	expect(service.findChild(child.sessionId)).toBeUndefined();
});

test("a scripted provider error becomes an error OUTCOME, not a rejection", async () => {
	faux.setResponses([
		fauxAssistantMessage("partial", { stopReason: "error", errorMessage: "boom" }),
	]);
	const child = await service.createChild(subagentSpec());
	try {
		const outcome = await child.runQueued("Fail please.");
		expect(outcome.status).toBe("error");
		expect(outcome.errorMessage).toBe("boom");
		expect(child.snapshot?.status).toBe("error");
		// The reason survives into the registry for later collection (decision #24).
		expect(child.snapshot?.errorMessage).toBe("boom");
	} finally {
		await child.dispose();
	}
});

test("one run at a time per child: a second runQueued rejects already-running", async () => {
	faux.setResponses([fauxAssistantMessage("SLOW_RESULT")]);
	const child = await service.createChild(subagentSpec());
	try {
		const first = child.runQueued("First.");
		// The registry marks the run queued synchronously — a second run is rejected immediately.
		expect(await codeOf(child.runQueued("Second."))).toBe("already-running");
		expect((await first).status).toBe("completed");
	} finally {
		await child.dispose();
	}
});

test("an already-aborted signal resolves an aborted outcome without prompting", async () => {
	const child = await service.createChild(subagentSpec());
	try {
		const controller = new AbortController();
		controller.abort();
		const outcome = await child.runQueued("Never runs.", { signal: controller.signal });
		expect(outcome.status).toBe("aborted");
	} finally {
		await child.dispose();
	}
});

test("a run that completes naturally AT the cap keeps its real answer (no spurious wrap-up)", async () => {
	faux.setResponses([
		fauxAssistantMessage("REAL_ANSWER"),
		fauxAssistantMessage("SPURIOUS_WRAPUP_ANSWER"),
	]);
	const child = await service.createChild(subagentSpec());
	try {
		const outcome = await child.runQueued("One-shot answer.", { maxTurns: 1 });
		expect(outcome.status).toBe("completed");
		expect(outcome.finalText).toBe("REAL_ANSWER");
		expect(outcome.details.usage.turns).toBe(1);
		// The sentinel second response was never consumed — no extra turn was started.
		expect(faux.getPendingResponseCount()).toBe(1);
	} finally {
		await child.dispose();
		faux.setResponses([]);
	}
});

test("the turn cap steers a wrap-up, then aborts a run that keeps going", async () => {
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("ls", {})),
		fauxAssistantMessage(fauxToolCall("ls", {})),
		fauxAssistantMessage(fauxToolCall("ls", {})),
		fauxAssistantMessage("NEVER_REACHED"),
	]);
	const child = await service.createChild(
		subagentSpec({ session: { systemPrompt: "loop", tools: ["ls"] } }),
	);
	try {
		const outcome = await child.runQueued("Loop until stopped.", { maxTurns: 1 });
		expect(outcome.status).toBe("aborted");
		expect(outcome.details.usage.turns).toBeGreaterThanOrEqual(1);
	} finally {
		await child.dispose();
	}
});

test("the per-parent semaphore paces runs FIFO", async () => {
	const paced = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-paced",
		modelRuntime: runtime,
		maxConcurrentPerParent: 1,
	});
	const order: string[] = [];
	paced.onLifecycle((event) => {
		if (event.type === "run-started" || event.type === "run-terminal") {
			order.push(`${event.type}:${event.sessionId}`);
		}
	});
	faux.setResponses([fauxAssistantMessage("A_DONE"), fauxAssistantMessage("B_DONE")]);
	const childA = await paced.createChild(subagentSpec());
	const childB = await paced.createChild(subagentSpec());
	try {
		const [outcomeA, outcomeB] = await Promise.all([
			childA.runQueued("A."),
			childB.runQueued("B."),
		]);
		expect(outcomeA.status).toBe("completed");
		expect(outcomeB.status).toBe("completed");
		// One slot: B starts only after A reached its terminal event.
		expect(order).toEqual([
			`run-started:${childA.sessionId}`,
			`run-terminal:${childA.sessionId}`,
			`run-started:${childB.sessionId}`,
			`run-terminal:${childB.sessionId}`,
		]);
	} finally {
		await paced.disposeChildrenOf(parent.sessionId);
	}
});

test("extensions opt-in loads ONLY the embedder-bound curated set — and only when asked", async () => {
	let factoryLoads = 0;
	const curated = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-ext",
		modelRuntime: runtime,
		childExtensionFactories: [
			(pi) => {
				factoryLoads++;
				pi.registerTool({
					name: "ping",
					label: "Ping",
					description: "Answers pong",
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: "PONG" }], details: {} }),
				});
			},
		],
	});

	// Without the opt-in the factory never loads.
	const plain = await curated.createChild(subagentSpec());
	await plain.dispose();
	expect(factoryLoads).toBe(0);

	// With it, the curated tool is callable by the child.
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("ping", {})),
		fauxAssistantMessage("USED_PING"),
	]);
	const child = await curated.createChild(
		subagentSpec({ session: { systemPrompt: "use ping", tools: ["ping"], extensions: true } }),
	);
	try {
		expect(factoryLoads).toBe(1);
		const outcome = await child.runQueued("Ping it.");
		expect(outcome.status).toBe("completed");
		expect(outcome.finalText).toBe("USED_PING");
	} finally {
		await curated.disposeChildrenOf(parent.sessionId);
	}
});

test("extensions opt-in is inert when the embedder binds no child factories", async () => {
	faux.setResponses([fauxAssistantMessage("STILL_FINE")]);
	const child = await service.createChild(
		subagentSpec({ session: { systemPrompt: "plain", tools: [], extensions: true } }),
	);
	try {
		const outcome = await child.runQueued("Go.");
		expect(outcome.status).toBe("completed");
		expect(outcome.finalText).toBe("STILL_FINE");
	} finally {
		await child.dispose();
	}
});

test("disposeChildrenOf cascades: children disposed, steer rejects disposed", async () => {
	const child = await service.createChild(subagentSpec());
	await service.disposeChildrenOf(parent.sessionId);
	expect(service.findChild(child.sessionId)).toBeUndefined();
	expect(service.childrenOf(parent.sessionId)).toEqual([]);
	expect(await codeOf(child.steer("hello?"))).toBe("disposed");
	expect(await codeOf(child.runQueued("again?"))).toBe("disposed");
});
