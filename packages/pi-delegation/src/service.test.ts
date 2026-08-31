import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, type Model, type ProviderHeaders } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	ModelRegistry,
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

function registerFauxProvider(
	target: ModelRuntime,
	id: string,
	options: {
		headers?: Record<string, string>;
		onRequestHeaders?: (headers: ProviderHeaders | undefined) => void;
	} = {},
): void {
	target.registerProvider(id, {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: (model, context, streamOptions) => {
			options.onRequestHeaders?.(streamOptions?.headers);
			return faux.streamSimple(model, context, streamOptions);
		},
		...(options.headers ? { headers: options.headers } : {}),
		models: [
			{
				id,
				name: id,
				api: faux.api,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});
}

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
	registerFauxProvider(runtime, "faux");

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

test("a foreground run completes: outcome, registry, lineage storage, lifecycle events", async () => {
	events.length = 0;
	faux.setResponses([fauxAssistantMessage("CHILD_DONE")]);

	const child = await service.createChild(subagentSpec());
	expect(child.record.parentSessionId).toBe(parent.sessionId);
	expect(child.record.scope).toBe("ws-test");
	expect(child.record.visibility).toBe("hidden");
	expect(
		child.record.sessionFile.startsWith(join(delegationRoot, "ws-test", parent.sessionId)),
	).toBe(true);

	const updates: string[] = [];
	let startedView:
		| { snapshotStatus: string | undefined; detailsStatus: string | undefined; updates: string[] }
		| undefined;
	child.onEvent((event) => {
		if (event.type !== "run-started") return;
		startedView = {
			snapshotStatus: child.snapshot?.status,
			detailsStatus: child.snapshot?.details.status,
			updates: [...updates],
		};
	});
	const outcome = await child.runQueued("Report done.", {
		onUpdate: (details) => updates.push(details.status),
	});

	expect(startedView).toEqual({
		snapshotStatus: "running",
		detailsStatus: "running",
		updates: ["running"],
	});
	expect(outcome.status).toBe("completed");
	expect(outcome.finalText).toBe("CHILD_DONE");
	expect(outcome.details.childSessionId).toBe(child.sessionId);
	expect(outcome.details.model).toBe("faux/faux");
	expect(outcome.details.usage.turns).toBe(1);
	expect(outcome.details.roleName).toBe("scout");

	expect(child.snapshot?.status).toBe("completed");
	expect(child.snapshot?.collected).toBe(false);
	expect(child.collectResult()?.collected).toBe(true);

	const derived = deriveChildSessionFile(
		delegationRoot,
		"ws-test",
		parent.sessionId,
		child.sessionId,
	);
	expect(derived).toBe(child.record.sessionFile);
	expect(derived !== undefined && existsSync(derived)).toBe(true);

	expect(service.findChild(child.sessionId)).toBeDefined();
	expect(service.childrenOf(parent.sessionId).map((h) => h.sessionId)).toContain(child.sessionId);

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
		expect(child.snapshot?.errorMessage).toBe("boom");
	} finally {
		await child.dispose();
	}
});

test("sequential runs report per-run finalText and usage deltas, never cumulative totals", async () => {
	const longAnswer = "FIRST_LONG_ANSWER ".repeat(20).trim();
	faux.setResponses([fauxAssistantMessage(longAnswer), fauxAssistantMessage("TINY")]);
	const child = await service.createChild(subagentSpec());
	try {
		const first = await child.runQueued("First task.");
		expect(first.status).toBe("completed");
		expect(first.finalText).toBe(longAnswer);
		expect(first.details.usage.output).toBeGreaterThan(0);

		const second = await child.runQueued("Second task.");
		expect(second.status).toBe("completed");
		expect(second.finalText).toBe("TINY");
		expect(second.details.usage.turns).toBe(1);
		expect(second.details.usage.output).toBeGreaterThan(0);
		expect(second.details.usage.output).toBeLessThan(first.details.usage.output);
	} finally {
		await child.dispose();
	}
});

test("the self-created runtime mirrors public provider registrations and removes stale ones", async () => {
	const sourceRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	registerFauxProvider(sourceRuntime, "mirrored");
	const sourceModel = sourceRuntime.getModel("mirrored", "mirrored");
	if (!sourceModel) throw new Error("mirrored model not registered");
	const fallback = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? {
						cwd: parentCwd,
						model: sourceModel,
						thinkingLevel: parent.thinkingLevel,
						modelRegistry: new ModelRegistry(sourceRuntime),
					}
				: undefined,
		delegationRoot,
		scope: "ws-registry-mirror",
	});
	const mirroredSpec = subagentSpec({
		session: {
			systemPrompt: "probe",
			model: { provider: "mirrored", id: "mirrored" },
			tools: [],
		},
	});
	faux.setResponses([fauxAssistantMessage("MIRRORED_DONE")]);
	const child = await fallback.createChild(mirroredSpec);
	try {
		const outcome = await child.runQueued("Probe.");
		expect(outcome.status).toBe("completed");
		expect(outcome.details.model).toBe("mirrored/mirrored");
	} finally {
		await child.dispose();
	}

	sourceRuntime.unregisterProvider("mirrored");
	const staleResult = await fallback.createChild(mirroredSpec).then(
		() => undefined,
		(error: unknown) => error,
	);
	if (!(staleResult instanceof Error)) throw new Error("expected stale model resolution to fail");
	expect(staleResult.message).toContain("Unknown model mirrored/mirrored");
	await fallback.disposeChildrenOf(parent.sessionId);
});

test("the self-created runtime replaces same-id provider configs without retaining omitted fields", async () => {
	const sourceRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const requestHeaders: (ProviderHeaders | undefined)[] = [];
	const captureHeaders = (headers: ProviderHeaders | undefined) => requestHeaders.push(headers);
	registerFauxProvider(sourceRuntime, "replaced", {
		headers: { "x-stale-secret": "secret" },
		onRequestHeaders: captureHeaders,
	});
	const sourceModel = sourceRuntime.getModel("replaced", "replaced");
	if (!sourceModel) throw new Error("replacement model not registered");
	const fallback = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? {
						cwd: parentCwd,
						model: sourceModel,
						thinkingLevel: parent.thinkingLevel,
						modelRegistry: new ModelRegistry(sourceRuntime),
					}
				: undefined,
		delegationRoot,
		scope: "ws-registry-replacement",
	});
	const replacedSpec = subagentSpec({
		session: {
			systemPrompt: "probe",
			model: { provider: "replaced", id: "replaced" },
			tools: [],
		},
	});
	faux.setResponses([fauxAssistantMessage("OLD_CONFIG"), fauxAssistantMessage("NEW_CONFIG")]);
	const first = await fallback.createChild(replacedSpec);
	try {
		expect((await first.runQueued("Use old config.")).status).toBe("completed");
		expect(requestHeaders.at(-1)?.["x-stale-secret"]).toBe("secret");
	} finally {
		await first.dispose();
	}

	sourceRuntime.unregisterProvider("replaced");
	registerFauxProvider(sourceRuntime, "replaced", { onRequestHeaders: captureHeaders });
	const second = await fallback.createChild(replacedSpec);
	try {
		expect((await second.runQueued("Use new config.")).status).toBe("completed");
		expect(requestHeaders.at(-1)?.["x-stale-secret"]).toBeUndefined();
	} finally {
		await second.dispose();
		await fallback.disposeChildrenOf(parent.sessionId);
	}
});

test("self-created runtimes isolate provider synchronization per parent lineage", async () => {
	const sourceA = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const sourceB = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	registerFauxProvider(sourceA, "lineage-a");
	registerFauxProvider(sourceB, "lineage-b");
	const modelA = sourceA.getModel("lineage-a", "lineage-a");
	const modelB = sourceB.getModel("lineage-b", "lineage-b");
	if (!modelA || !modelB) throw new Error("lineage models not registered");
	const multiParent = createDelegationService({
		resolveParent: (id) => {
			if (id === "parent-a") {
				return {
					cwd: parentCwd,
					model: modelA,
					thinkingLevel: parent.thinkingLevel,
					modelRegistry: new ModelRegistry(sourceA),
				};
			}
			if (id === "parent-b") {
				return {
					cwd: parentCwd,
					model: modelB,
					thinkingLevel: parent.thinkingLevel,
					modelRegistry: new ModelRegistry(sourceB),
				};
			}
			return undefined;
		},
		delegationRoot,
		scope: "ws-multi-parent-registry",
	});
	const childA = await multiParent.createChild(
		subagentSpec({
			parent: "parent-a",
			session: {
				systemPrompt: "lineage a",
				model: { provider: "lineage-a", id: "lineage-a" },
				tools: [],
			},
		}),
	);
	await multiParent.createChild(
		subagentSpec({
			parent: "parent-b",
			session: {
				systemPrompt: "lineage b",
				model: { provider: "lineage-b", id: "lineage-b" },
				tools: [],
			},
		}),
	);
	faux.setResponses([fauxAssistantMessage("LINEAGE_A_STILL_WORKS")]);
	try {
		const outcome = await childA.runQueued("Run after parent B synchronized.");
		expect(outcome.status).toBe("completed");
		expect(outcome.finalText).toBe("LINEAGE_A_STILL_WORKS");
	} finally {
		await multiParent.disposeChildrenOf("parent-a");
		await multiParent.disposeChildrenOf("parent-b");
	}
});

test("a modelRuntime provider is resolved per createChild, never captured at service creation", async () => {
	let resolves = 0;
	const generational = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-live-runtime",
		modelRuntime: () => {
			resolves++;
			return runtime;
		},
	});
	expect(resolves).toBe(0);
	try {
		await generational.createChild(subagentSpec());
		await generational.createChild(subagentSpec());
		expect(resolves).toBe(2);
	} finally {
		await generational.disposeChildrenOf(parent.sessionId);
	}
});

test("a parent's retained runtime wins over the service-level binding", async () => {
	const parentRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	registerFauxProvider(parentRuntime, "fauxp");
	const generational = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? {
						cwd: parentCwd,
						model: parent.model,
						thinkingLevel: parent.thinkingLevel,
						modelRuntime: parentRuntime,
					}
				: undefined,
		delegationRoot,
		scope: "ws-parent-runtime",
		modelRuntime: runtime,
	});
	faux.setResponses([fauxAssistantMessage("PARENT_GEN_DONE")]);
	const child = await generational.createChild(
		subagentSpec({
			session: { systemPrompt: "probe", model: { provider: "fauxp", id: "fauxp" } },
		}),
	);
	try {
		const outcome = await child.runQueued("Probe.");
		expect(outcome.status).toBe("completed");
		expect(outcome.details.model).toBe("fauxp/fauxp");
	} finally {
		await generational.disposeChildrenOf(parent.sessionId);
	}
});

test("one run at a time per child: a second runQueued rejects already-running", async () => {
	faux.setResponses([fauxAssistantMessage("SLOW_RESULT")]);
	const child = await service.createChild(subagentSpec());
	try {
		const first = child.runQueued("First.");
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

test("an abort while QUEUED releases immediately — not after a slot frees", async () => {
	const paced = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-queued-abort",
		modelRuntime: runtime,
		maxConcurrentPerParent: 1,
	});
	faux.setResponses([
		async () => {
			await Bun.sleep(300);
			return fauxAssistantMessage("SLOW_DONE");
		},
	]);
	const childA = await paced.createChild(subagentSpec());
	const childB = await paced.createChild(subagentSpec());
	try {
		const runA = childA.runQueued("Slow.");
		const controller = new AbortController();
		const runB = childB.runQueued("Queued, then aborted.", { signal: controller.signal });
		await Bun.sleep(20);
		controller.abort();
		const outcomeB = await runB;
		expect(outcomeB.status).toBe("aborted");
		expect(childA.snapshot?.status).toBe("running");
		expect((await runA).status).toBe("completed");
	} finally {
		await paced.disposeChildrenOf(parent.sessionId);
	}
});

test("ChildHandle.abort cancels a queued run before it can start provider work", async () => {
	const paced = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-handle-queued-abort",
		modelRuntime: runtime,
		maxConcurrentPerParent: 1,
	});
	faux.setResponses([
		async () => {
			await Bun.sleep(300);
			return fauxAssistantMessage("SLOW_DONE");
		},
	]);
	const childA = await paced.createChild(subagentSpec());
	const childB = await paced.createChild(subagentSpec());
	try {
		const runA = childA.runQueued("Slow.");
		const runB = childB.runQueued("Queued, then handle-aborted.");
		await Bun.sleep(20);
		expect(childB.snapshot?.status).toBe("queued");

		await childB.abort();
		const outcomeB = await runB;
		expect(outcomeB.status).toBe("aborted");
		expect(childA.snapshot?.status).toBe("running");
		expect((await runA).status).toBe("completed");
	} finally {
		await paced.disposeChildrenOf(parent.sessionId);
	}
});

test("ChildHandle.dispose settles a queued run before removing the child", async () => {
	const paced = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-handle-queued-dispose",
		modelRuntime: runtime,
		maxConcurrentPerParent: 1,
	});
	faux.setResponses([
		async () => {
			await Bun.sleep(300);
			return fauxAssistantMessage("SLOW_DONE");
		},
	]);
	const childA = await paced.createChild(subagentSpec());
	const childB = await paced.createChild(subagentSpec());
	const events: string[] = [];
	paced.onLifecycle((event) => {
		if ("sessionId" in event && event.sessionId === childB.sessionId) events.push(event.type);
	});
	try {
		const runA = childA.runQueued("Slow.");
		const runB = childB.runQueued("Queued, then disposed.");
		await Bun.sleep(20);
		expect(childB.snapshot?.status).toBe("queued");

		await childB.dispose();
		expect(childA.snapshot?.status).toBe("running");
		expect((await runB).status).toBe("aborted");
		expect(paced.findChild(childB.sessionId)).toBeUndefined();
		expect(events).toEqual(["run-queued", "run-terminal", "child-disposed"]);
		expect((await runA).status).toBe("completed");
	} finally {
		await paced.disposeChildrenOf(parent.sessionId);
	}
});

test("concurrent child and parent disposal share one teardown and both await it", async () => {
	const paced = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-concurrent-dispose",
		modelRuntime: runtime,
	});
	faux.setResponses([
		async () => {
			await Bun.sleep(300);
			return fauxAssistantMessage("SLOW_DONE");
		},
	]);
	const child = await paced.createChild(subagentSpec());
	const events: string[] = [];
	paced.onLifecycle((event) => {
		if ("sessionId" in event && event.sessionId === child.sessionId) events.push(event.type);
	});
	const run = child.runQueued("Slow.");
	await Bun.sleep(20);
	expect(child.snapshot?.status).toBe("running");
	const childDisposal = child.dispose();

	try {
		await paced.disposeChildrenOf(parent.sessionId);
		expect(paced.findChild(child.sessionId)).toBeUndefined();
		expect((await run).status).toBe("aborted");
		await childDisposal;
		expect(events).toEqual(["run-queued", "run-started", "run-terminal", "child-disposed"]);
	} finally {
		await Promise.allSettled([childDisposal, run]);
		await paced.disposeChildrenOf(parent.sessionId);
	}
});

test("disposeChildrenOf marks every child before awaiting aborts — a queued sibling never starts", async () => {
	const paced = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd: parentCwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot,
		scope: "ws-dispose-atomic",
		modelRuntime: runtime,
		maxConcurrentPerParent: 2,
	});
	const started: string[] = [];
	paced.onLifecycle((event) => {
		if (event.type === "run-started") started.push(event.sessionId);
	});
	const slow = async () => {
		await Bun.sleep(300);
		return fauxAssistantMessage("SLOW_DONE");
	};
	faux.setResponses([slow, slow, fauxAssistantMessage("C_MUST_NOT_RUN")]);
	const childA = await paced.createChild(subagentSpec());
	const childB = await paced.createChild(subagentSpec());
	const childC = await paced.createChild(subagentSpec());
	const runA = childA.runQueued("Slow A.");
	const runB = childB.runQueued("Slow B.");
	const runC = childC.runQueued("Queued behind both.");
	await Bun.sleep(20);
	expect(childA.snapshot?.status).toBe("running");
	expect(childB.snapshot?.status).toBe("running");
	expect(childC.snapshot?.status).toBe("queued");

	await paced.disposeChildrenOf(parent.sessionId);

	const [outcomeA, outcomeB, outcomeC] = await Promise.all([runA, runB, runC]);
	expect(outcomeA.status).toBe("aborted");
	expect(outcomeB.status).toBe("aborted");
	expect(outcomeC.status).toBe("aborted");
	expect(outcomeC.errorMessage).toBe("disposed before start");
	expect(started.sort()).toEqual([childA.sessionId, childB.sessionId].sort());
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

	const plain = await curated.createChild(subagentSpec());
	await plain.dispose();
	expect(factoryLoads).toBe(0);

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
