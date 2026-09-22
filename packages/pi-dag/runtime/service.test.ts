import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import {
	constants,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { type ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { createDelegationService, type DelegationService } from "pi-delegation";
import {
	createDagService,
	type DagClient,
	type DagCommandRequest,
	type DagDefinition,
	type DagNotice,
	type DagNoticeSink,
	type DagResult,
	type DagService,
	type DagSnapshot,
	LIMITS,
} from "../index";
import { createTestRuntime, faux, model } from "./provider.fixture";

const root = mkdtempSync(join(tmpdir(), "dag-runtime-"));
let runtime: ModelRuntime;
let oldAgentDir: string | undefined;
let oldOffline: string | undefined;
let serial = 0;
const services: DagService[] = [];
const prompts: string[] = [];
const processes: Array<{ exitCode: number | null; kill(): void; exited: Promise<number> }> = [];
beforeAll(async () => {
	oldAgentDir = process.env.PI_CODING_AGENT_DIR;
	oldOffline = process.env.PI_OFFLINE;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	runtime = await createTestRuntime(prompts);
});
afterEach(async () => {
	for (const child of processes.splice(0)) {
		if (child.exitCode === null) child.kill();
		await child.exited;
	}
	for (const service of services.splice(0)) await service.close();
});
afterAll(() => {
	if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
	if (oldOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = oldOffline;
	rmSync(root, { recursive: true, force: true });
});
function value<T>(result: DagResult<T>): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}
function fixture(decorate?: (core: DelegationService) => DelegationService) {
	const scope = `test-${serial++}`;
	const core = createDelegationService({
		delegationRoot: join(root, "children"),
		scope: "shared-core",
	});
	const delegation = decorate ? decorate(core) : core;
	const service = createDagService({ storageRoot: join(root, "dags"), scope, delegation });
	services.push(service);
	const signal = new AbortController().signal;
	const execution = { kind: "runtime" as const, modelRuntime: runtime, cwd: root, model };
	const owner = service.bind({ caller: { kind: "owner", ownerId: "host" }, signal, execution });
	return { service, owner, execution, signal, scope, delegation };
}
function latch() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { release, promise };
}
function noticeSink() {
	const received: DagNotice[] = [],
		listeners = new Set<() => void>();
	let ready = false;
	const sink: DagNoticeSink = {
		tryDeliver(notice) {
			if (!ready) return "deferred";
			received.push(notice);
			return "submitted";
		},
		onReady(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return {
		sink,
		received,
		listeners,
		ready() {
			ready = true;
			for (const listener of listeners) listener();
		},
	};
}
function pauseFirstInput() {
	const entered = latch(),
		proceed = latch();
	let first = true;
	const decorate = (core: DelegationService): DelegationService => ({
		...core,
		registerResource(id, context, options) {
			return core.registerResource(id, context, {
				...options,
				childExtensionFactories: [
					...(options?.childExtensionFactories ?? []),
					(pi) => {
						pi.on("input", async () => {
							if (first) {
								first = false;
								entered.release();
								await proceed.promise;
							}
							return { action: "continue" };
						});
					},
				],
			});
		},
	});
	return { entered, proceed, decorate };
}
async function crashedWorker(scope: string, mode: "proposal" | "input") {
	const child = Bun.spawn(
		[
			process.execPath,
			fileURLToPath(new URL("./recovery.fixture.ts", import.meta.url)),
			root,
			scope,
			mode,
		],
		{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
	);
	processes.push(child);
	const reader = child.stdout.getReader();
	let output = "";
	while (!output.includes("\n")) {
		const chunk = await reader.read();
		if (chunk.done) throw new Error(await new Response(child.stderr).text());
		output += new TextDecoder().decode(chunk.value);
	}
	reader.releaseLock();
	const decoded: unknown = JSON.parse(output.trim());
	if (
		!decoded ||
		typeof decoded !== "object" ||
		!("dagId" in decoded) ||
		typeof decoded.dagId !== "string"
	)
		throw new Error("Invalid fixture response");
	return { child, dagId: decoded.dagId };
}
function definition(ids = ["work"]): DagDefinition {
	return {
		title: "Test",
		defaults: { tools: [] },
		maxConcurrent: 1,
		nodes: ids.map((id) => ({ id, task: `Task ${id}`, outputs: { result: { kind: "text" } } })),
		connections: [],
	};
}
async function command(
	client: DagClient,
	dagId: string,
	cmd: Exclude<DagCommandRequest["command"], { kind: "create" }>,
) {
	for (let retry = 0; retry < 30; retry++) {
		const snapshot = value(await client.getDag({ dagId }));
		const result = await client.execute({
			commandId: `command-${serial++}`,
			dagId,
			expectedVersion: snapshot.version,
			command: cmd,
		});
		if (!result.ok && result.error.code === "stale-version") continue;
		return value(result);
	}
	throw new Error("CAS did not settle");
}
async function create(client: DagClient, graph = definition()) {
	return value(
		await client.execute({ commandId: "create", command: { kind: "create", definition: graph } }),
	);
}
async function start(client: DagClient, graph = definition()) {
	const { dagId } = await create(client, graph);
	await command(client, dagId, { kind: "resume" });
	return dagId;
}
async function until(
	client: DagClient,
	dagId: string,
	predicate: (snapshot: DagSnapshot) => boolean,
): Promise<DagSnapshot> {
	let last: DagSnapshot | undefined;
	for (let n = 0; n < 400; n++) {
		last = value(await client.getDag({ dagId }));
		if (predicate(last)) return last;
		await Bun.sleep(5);
	}
	throw new Error(`DAG did not settle: ${JSON.stringify(last)}`);
}
function result(text: string, id?: string) {
	const call = fauxToolCall("dag_submit_result", { outputs: { result: { kind: "text", text } } });
	if (id) call.id = id;
	return fauxAssistantMessage(call);
}

test("sessionless creation is paused and replay ignores replacement execution context", async () => {
	const { owner, service, signal } = fixture();
	const request = {
		commandId: "create",
		command: { kind: "create" as const, definition: definition() },
	};
	const before = faux.state.callCount;
	const receipt = value(await owner.execute(request));
	const snapshot = value(await owner.getDag({ dagId: receipt.dagId }));
	expect(snapshot.mode).toBe("paused");
	expect(snapshot.nodes[0]?.status).toBe("pending");
	expect(faux.state.callCount).toBe(before);
	const reader = service.bind({
		caller: { kind: "controller", sessionId: "unrelated-chat" },
		signal,
	});
	expect(value(await reader.execute(request))).toEqual(receipt);
	expect(
		await reader.execute({
			...request,
			command: { ...request.command, definition: { ...definition(), title: "Changed" } },
		}),
	).toMatchObject({ ok: false, error: { code: "id-reused" } });
});

test("human release authorizes one immutable fork base for independent workers after source deletion", async () => {
	const { owner, service, signal } = fixture();
	const human = service.bind({ caller: { kind: "human", operatorId: "operator" }, signal });
	const graph = definition(["explore", "left", "right"]);
	const source = graph.nodes[0];
	if (!source) throw new Error("Missing fixture source");
	source.approval = { authority: "human", question: "Release this research and its history?" };
	graph.maxConcurrent = 2;
	graph.connections = ["left", "right"].map((to) => ({
		id: `fork-${to}`,
		kind: "control",
		from: "explore",
		to,
		allowSkipped: false,
		context: "fork",
	}));
	faux.setResponses([
		result("SHARED_RESEARCH", "reused"),
		result("LEFT_OR_RIGHT", "reused"),
		result("OTHER_WORKER", "reused"),
	]);
	const before = faux.state.callCount;
	const dagId = await start(owner, graph);
	const waiting = await until(
		owner,
		dagId,
		(state) => state.nodes[0]?.status === "waiting-approval",
	);
	const gate = waiting.gates[0];
	if (!gate?.historyCapture) throw new Error("Missing captured release scope");
	const controller = service.bind({ caller: { kind: "controller", sessionId: "chat" }, signal });
	for (const client of [owner, controller])
		expect(
			await client.execute({
				commandId: "approve",
				dagId,
				expectedVersion: waiting.version,
				command: { kind: "approve", gateId: gate.id, reason: "Not a human" },
			}),
		).toMatchObject({ ok: false, error: { code: "forbidden" } });
	const sessions = join(root, "children", "shared-core", ".resources", dagId);
	const sourceFile = readdirSync(sessions).find((file) =>
		file.endsWith(`_${waiting.nodes[0]?.sessionId}.jsonl`),
	);
	if (!sourceFile) throw new Error("Source transcript was not persisted");
	rmSync(join(sessions, sourceFile));
	await command(human, dagId, {
		kind: "approve",
		gateId: gate.id,
		reason: "Reviewed exact output and capture",
	});
	const done = await until(owner, dagId, (state) =>
		state.nodes.every((node) => node.status === "completed"),
	);
	expect(new Set(done.nodes.map((node) => node.sessionId)).size).toBe(3);
	expect(done.nodes[1]?.historyCapture?.sha256).toBe(gate.historyCapture.sha256);
	expect(done.nodes[2]?.historyCapture?.sha256).toBe(gate.historyCapture.sha256);
	expect(done.nodes[0]?.exportedHistory).toMatchObject({
		capture: {
			sourceSessionId: waiting.nodes[0]?.sessionId,
			entryId: waiting.nodes[0]?.outcome?.historyEntryId,
		},
		released: true,
	});
	expect(done.nodes[0]?.acceptance).toBeDefined();
	const history = value(await owner.listHistory({ dagId, limit: 100 }));
	const creation = history.items.find((item) => item.kind === "created");
	expect(creation?.files[0]?.artifactId).toBe(waiting.definition.artifactId);
	const approval = history.items.find((item) => item.kind === "approval-requested");
	const question = approval?.files[0];
	if (!question) throw new Error("Missing historical question reference");
	expect(readFileSync(question.localPath, "utf8")).toBe(source.approval.question);
	expect(faux.state.callCount - before).toBe(3);
});

test("pi recovery stays within one activation; explicit retry gets a new session and selected prior values", async () => {
	const { owner, delegation } = fixture();
	const truncated = result("PARTIAL");
	truncated.stopReason = "length";
	faux.setResponses([truncated, result("RECOVERED"), result("RETRIED")]);
	const dagId = await start(owner);
	const waiting = await until(owner, dagId, (state) => state.nodes[0]?.status === "completed");
	const proposalId = waiting.nodes[0]?.proposalId;
	if (!proposalId) throw new Error("Missing recovered proposal");
	expect(waiting.nodes[0]?.outcome?.stopReason).toBe("stop");
	expect(waiting.nodes[0]?.outcome?.details.usage.turns).toBe(2);
	expect(waiting.nodes[0]?.activation).toBe(1);
	const recovered = waiting.nodes[0];
	if (!recovered?.sessionId || !recovered.outcome) throw new Error("Missing settled worker");
	const captured = await delegation.captureHistory({
		kind: "resource-child",
		resourceId: dagId,
		sessionId: recovered.sessionId,
		entryId: recovered.outcome.historyEntryId,
	});
	expect(captured.jsonl).toContain("RECOVERED");
	await command(owner, dagId, {
		kind: "retry",
		target: { nodeId: "work", attempt: 1 },
		previousOutputs: [{ proposalId, name: "result" }],
	});
	const done = await until(
		owner,
		dagId,
		(state) => state.nodes[0]?.status === "completed" && state.nodes[0]?.attempt === 2,
	);
	expect(done.nodes[0]?.sessionId).not.toBe(waiting.nodes[0]?.sessionId);
	const payload = done.nodes[0]?.payload;
	if (!payload) throw new Error("Missing retry payload");
	expect(readFileSync(payload.localPath, "utf8")).toContain("RECOVERED");
	expect(value(await owner.getOutput({ dagId, proposalId, name: "result" })).disposition).toBe(
		"superseded",
	);
});

test("interrupt during prompt preflight acknowledges intent and retains the unwritten session for continuation", async () => {
	const { entered, proceed, decorate } = pauseFirstInput();
	const { owner } = fixture(decorate);
	faux.setResponses([result("AFTER_INTERRUPT")]);
	const before = prompts.length;
	const dagId = await start(owner);
	await entered.promise;
	try {
		await Promise.race([
			command(owner, dagId, {
				kind: "interrupt",
				target: { kind: "activation", nodeId: "work", attempt: 1, activation: 1 },
			}),
			Bun.sleep(1000).then(() => {
				throw new Error("Interrupt waited for settlement before ACK");
			}),
		]);
	} finally {
		proceed.release();
	}
	const stopped = await until(owner, dagId, (state) => state.nodes[0]?.status === "interrupted");
	expect(prompts.length).toBe(before);
	await command(owner, dagId, {
		kind: "continue",
		target: { nodeId: "work", attempt: 1, activation: 1 },
		instructions: "Finish the task",
	});
	const done = await until(owner, dagId, (state) => state.nodes[0]?.status === "completed");
	expect(done.nodes[0]?.sessionId).toBe(stopped.nodes[0]?.sessionId);
	expect(done.nodes[0]?.activation).toBe(2);
	expect(prompts[before]).toContain("Task work");
});

test("dead-owner recovery preserves a proposal and human policy without inventing successful settlement", async () => {
	const { owner, service, signal, scope } = fixture();
	const { child, dagId } = await crashedWorker(scope, "proposal");
	const live = value(await owner.getDag({ dagId }));
	expect(live.executionOwner).toBe("other");
	expect(
		await owner.execute({
			commandId: "compete",
			dagId,
			expectedVersion: live.version,
			command: { kind: "pause" },
		}),
	).toMatchObject({ ok: false, error: { code: "resource-in-use" } });
	child.kill("SIGKILL");
	await child.exited;
	const calls = faux.state.callCount;
	const abandoned = value(await owner.getDag({ dagId }));
	expect(abandoned.executionOwner).toBe("none");
	expect(abandoned.mode).toBe("paused");
	expect(abandoned.nodes[0]?.status).toBe("uncertain");
	await command(owner, dagId, {
		kind: "reconcile",
		target: { nodeId: "work", attempt: 1, activation: 1 },
		reason: "The prior host PID has exited",
	});
	const recovered = value(await owner.getDag({ dagId }));
	const gate = recovered.gates[0],
		proposalId = recovered.nodes[0]?.proposalId;
	if (!gate || !proposalId) throw new Error("Recovery lost the pending proposal or its human gate");
	expect(
		await owner.execute({
			commandId: "override",
			dagId,
			expectedVersion: recovered.version,
			command: { kind: "accept-result", proposalId, reason: "Inspected bytes" },
		}),
	).toMatchObject({ ok: false, error: { code: "forbidden" } });
	const human = service.bind({ caller: { kind: "human", operatorId: "operator" }, signal });
	await command(human, dagId, {
		kind: "approve",
		gateId: gate.id,
		reason: "Reviewed captured bytes",
	});
	await command(owner, dagId, {
		kind: "accept-result",
		proposalId,
		reason: "Explicitly accept durable output despite unknown terminal observation",
	});
	const accepted = value(await owner.getDag({ dagId }));
	expect(accepted.nodes[0]?.status).toBe("completed");
	expect(accepted.nodes[0]?.outcome).toBeUndefined();
	expect(accepted.nodes[0]?.acceptance?.reason).toContain("unknown terminal observation");
	expect(faux.state.callCount).toBe(calls);
});

test("recovered input remains human-owned; answer and explicit continuation reopen the original session", async () => {
	const { owner, service, signal, scope, execution } = fixture();
	const { child, dagId } = await crashedWorker(scope, "input");
	child.kill("SIGKILL");
	await child.exited;
	await command(owner, dagId, {
		kind: "reconcile",
		target: { nodeId: "work", attempt: 1, activation: 1 },
		reason: "Prior host exited",
	});
	const recovered = value(await owner.getDag({ dagId }));
	const gate = recovered.gates[0];
	if (!gate) throw new Error("Recovery lost the input gate");
	const human = service.bind({
		caller: { kind: "human", operatorId: "operator" },
		signal,
		execution,
	});
	await command(human, dagId, { kind: "answer", gateId: gate.id, value: "PRESERVED_ANSWER" });
	await command(owner, dagId, {
		kind: "continue",
		target: { nodeId: "work", attempt: 1, activation: 1 },
	});
	faux.setResponses([result("AFTER_RECOVERY")]);
	await command(owner, dagId, { kind: "resume" });
	const done = await until(owner, dagId, (state) => state.nodes[0]?.status === "completed");
	expect(done.nodes[0]?.sessionId).toBe(recovered.nodes[0]?.sessionId);
	expect(done.nodes[0]?.activation).toBe(2);
	const payload = done.nodes[0]?.payload;
	if (!payload) throw new Error("Missing resumed payload");
	expect(readFileSync(payload.localPath, "utf8")).toContain("PRESERVED_ANSWER");
});

test("retry can revise its own unapproved output but cross-node seeds require release", async () => {
	const { owner, service, signal } = fixture();
	const graph = definition(["guarded", "other"]);
	const guarded = graph.nodes[0];
	if (!guarded) throw new Error("Missing node");
	guarded.approval = { authority: "human", question: "Approve revised output?" };
	faux.setResponses([result("UNAPPROVED"), fauxAssistantMessage("No result")]);
	const dagId = await start(owner, graph);
	const first = await until(
		owner,
		dagId,
		(state) =>
			state.nodes[0]?.status === "waiting-approval" && state.nodes[1]?.status === "needs-attention",
	);
	const original = first.nodes[0]?.proposalId;
	if (!original) throw new Error("Missing proposal");
	await expect(
		command(owner, dagId, {
			kind: "retry",
			target: { nodeId: "other", attempt: 1 },
			previousOutputs: [{ proposalId: original, name: "result" }],
		}),
	).rejects.toThrow('"code":"forbidden"');
	faux.setResponses([result("REVISED")]);
	await command(owner, dagId, {
		kind: "retry",
		target: { nodeId: "guarded", attempt: 1 },
		previousOutputs: [{ proposalId: original, name: "result" }],
	});
	const revised = await until(
		owner,
		dagId,
		(state) => state.nodes[0]?.attempt === 2 && state.nodes[0]?.status === "waiting-approval",
	);
	const proposalId = revised.nodes[0]?.proposalId,
		gate = revised.gates[0],
		payload = revised.nodes[0]?.payload;
	if (!proposalId || !gate || !payload) throw new Error("Missing revised evidence");
	expect(readFileSync(payload.localPath, "utf8")).toContain("UNAPPROVED");
	const human = service.bind({ caller: { kind: "human", operatorId: "operator" }, signal });
	await command(human, dagId, { kind: "approve", gateId: gate.id, reason: "Reviewed revision" });
	faux.setResponses([result("CROSS_NODE")]);
	await command(owner, dagId, {
		kind: "retry",
		target: { nodeId: "other", attempt: 1 },
		previousOutputs: [{ proposalId, name: "result" }],
	});
	const done = await until(
		owner,
		dagId,
		(state) => state.nodes[1]?.attempt === 2 && state.nodes[1]?.status === "completed",
	);
	const consumed = done.nodes[1]?.payload;
	if (!consumed) throw new Error("Missing seeded payload");
	expect(readFileSync(consumed.localPath, "utf8")).toContain("REVISED");
});

test("mixed worker batches commit no protocol evidence and failure does not block independent branches", async () => {
	const { owner } = fixture();
	const graph = definition(["mixed", "blocked", "independent"]);
	graph.connections = [
		{ id: "dependency", kind: "control", from: "mixed", to: "blocked", allowSkipped: false },
	];
	faux.setResponses([
		fauxAssistantMessage([
			fauxToolCall("dag_submit_result", { outputs: { result: { kind: "text", text: "INVALID" } } }),
			fauxToolCall("dag_request_input", { question: "INVALID" }),
		]),
		fauxAssistantMessage("No eligible proposal"),
		result("INDEPENDENT"),
	]);
	const dagId = await start(owner, graph);
	const settled = await until(
		owner,
		dagId,
		(state) =>
			state.nodes[0]?.status === "needs-attention" && state.nodes[2]?.status === "completed",
	);
	expect(settled.nodes[0]?.proposalId).toBeUndefined();
	expect(settled.gates).toEqual([]);
	expect(settled.nodes[1]?.status).toBe("pending");
	await command(owner, dagId, {
		kind: "skip",
		nodeId: "mixed",
		reason: "Use the independent result instead",
	});
	expect(value(await owner.getDag({ dagId })).nodes[1]?.status).toBe("pending");
	faux.setResponses([result("ALLOWED_CONTROL")]);
	await command(owner, dagId, {
		kind: "edit",
		edits: [
			{
				kind: "put-connection",
				connection: {
					id: "dependency",
					kind: "control",
					from: "mixed",
					to: "blocked",
					allowSkipped: true,
				},
			},
		],
	});
	await until(owner, dagId, (state) => state.nodes[1]?.status === "completed");
});

test("cancel does not turn a human input gate into permission to skip or remove its dependency", async () => {
	const { owner } = fixture();
	const graph = definition(["source", "consumer"]);
	graph.connections = [
		{ id: "dependency", kind: "control", from: "source", to: "consumer", allowSkipped: true },
	];
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("dag_request_input", { question: "Human input needed" })),
	]);
	const dagId = await start(owner, graph);
	const waiting = await until(owner, dagId, (state) => state.nodes[0]?.status === "waiting-input");
	await expect(
		command(owner, dagId, { kind: "skip", nodeId: "source", reason: "Bypass question" }),
	).rejects.toThrow('"code":"forbidden"');
	await command(owner, dagId, { kind: "cancel", target: { kind: "node", nodeId: "source" } });
	await expect(
		command(owner, dagId, { kind: "skip", nodeId: "source", reason: "Bypass cancelled question" }),
	).rejects.toThrow('"code":"forbidden"');
	await expect(
		command(owner, dagId, {
			kind: "edit",
			edits: [{ kind: "remove-connection", connectionId: "dependency" }],
		}),
	).rejects.toThrow('"code":"forbidden"');
	await expect(
		command(owner, dagId, {
			kind: "continue",
			target: { nodeId: "source", attempt: 1, activation: 1 },
		}),
	).rejects.toThrow("retry");
	faux.setResponses([result("RETRIED"), result("FOLLOWED")]);
	await command(owner, dagId, { kind: "retry", target: { nodeId: "source", attempt: 1 } });
	const done = await until(owner, dagId, (state) =>
		state.nodes.every((node) => node.status === "completed"),
	);
	expect(done.nodes[0]?.attempt).toBe(2);
	expect(done.nodes[0]?.sessionId).not.toBe(waiting.nodes[0]?.sessionId);
});

test("revoking the controller does not stop work; non-enqueued steering requires explicit resolution", async () => {
	const { entered, proceed, decorate } = pauseFirstInput();
	const { owner, service, execution } = fixture(decorate);
	const controller = new AbortController();
	const origin = service.bind({
		caller: { kind: "controller", sessionId: "origin" },
		signal: controller.signal,
		execution,
	});
	faux.setResponses([result("FIRST"), result("CONTINUED")]);
	const calls = prompts.length;
	const dagId = await start(origin);
	await entered.promise;
	controller.abort();
	try {
		await command(owner, dagId, {
			kind: "steer",
			target: { nodeId: "work", attempt: 1, activation: 1 },
			text: "NEVER_ENQUEUED",
		});
		await until(owner, dagId, (state) => state.interventions[0]?.status === "not-enqueued");
	} finally {
		proceed.release();
	}
	const held = await until(
		owner,
		dagId,
		(state) => state.nodes[0]?.status === "needs-attention" && !!state.nodes[0]?.proposalId,
	);
	expect(held.nodes[0]?.outcome?.status).toBe("completed");
	await command(owner, dagId, {
		kind: "continue",
		target: { nodeId: "work", attempt: 1, activation: 1 },
		instructions: "Submit again after resolving the failed intervention",
	});
	const done = await until(owner, dagId, (state) => state.nodes[0]?.status === "completed");
	expect(done.nodes[0]?.activation).toBe(2);
	expect(done.interventions).toEqual([]);
	expect(prompts[calls + 1]).not.toContain("NEVER_ENQUEUED");
});

test("disposal commits intent before settlement, releases workers and keeps evidence readable", async () => {
	const { entered, proceed, decorate } = pauseFirstInput();
	const { owner } = fixture(decorate);
	const calls = faux.state.callCount;
	const dagId = await start(owner);
	await entered.promise;
	try {
		await Promise.race([
			command(owner, dagId, { kind: "dispose" }),
			Bun.sleep(1000).then(() => {
				throw new Error("Disposal waited for settlement before ACK");
			}),
		]);
	} finally {
		proceed.release();
	}
	const disposed = await until(owner, dagId, (state) => state.lifecycle === "disposed");
	expect(disposed.nodes[0]?.outcome?.status).toBe("aborted");
	expect(disposed.nodes[0]?.payload).toBeDefined();
	expect(faux.state.callCount).toBe(calls);
	await expect(command(owner, dagId, { kind: "resume" })).rejects.toThrow('"code":"closed"');
	expect(
		value(await owner.listHistory({ dagId, limit: 100 })).items.some(
			(item) => item.kind === "disposed",
		),
	).toBe(true);
});

test("deferred notices recheck gate relevance and release observers on revocation", async () => {
	const { service, owner, execution } = fixture();
	const sink = noticeSink(),
		binding = new AbortController();
	const origin = service.bind({
		caller: { kind: "controller", sessionId: "notice-chat" },
		signal: binding.signal,
		execution,
		notices: sink.sink,
	});
	const graph = definition();
	const node = graph.nodes[0];
	if (!node) throw new Error("Missing node");
	node.approval = { authority: "human", question: "Release?" };
	faux.setResponses([result("DONE")]);
	const { dagId } = await create(origin, graph);
	await command(owner, dagId, { kind: "resume" });
	const waiting = await until(
		owner,
		dagId,
		(state) => state.nodes[0]?.status === "waiting-approval",
	);
	const gate = waiting.gates[0];
	if (!gate) throw new Error("Missing gate");
	const human = service.bind({
		caller: { kind: "human", operatorId: "operator" },
		signal: binding.signal,
	});
	await command(human, dagId, { kind: "approve", gateId: gate.id, reason: "Reviewed" });
	expect(sink.received).toEqual([]);
	sink.ready();
	expect(sink.received.map((notice) => notice.kind)).toEqual(["completed"]);
	sink.ready();
	expect(sink.received).toHaveLength(1);
	binding.abort();
	expect(sink.listeners.size).toBe(0);
});

test("a restored attached chat receives durable pending notices without claiming execution", async () => {
	const { service, owner, scope, delegation, execution } = fixture();
	const first = noticeSink(),
		controller = new AbortController();
	const caller = { kind: "controller", sessionId: "durable-notices" } as const;
	const origin = service.bind({
		caller,
		signal: controller.signal,
		execution,
		notices: first.sink,
	});
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("dag_request_input", { question: "Still waiting" })),
	]);
	const { dagId } = await create(origin);
	await command(owner, dagId, { kind: "resume" });
	await until(owner, dagId, (state) => state.nodes[0]?.status === "waiting-input");
	await service.close();
	expect(first.listeners.size).toBe(0);
	const restored = createDagService({ storageRoot: join(root, "dags"), scope, delegation });
	services.push(restored);
	const sink = noticeSink();
	sink.ready();
	const reader = restored.bind({ caller, signal: controller.signal, notices: sink.sink });
	for (let n = 0; n < 100 && !sink.received.length; n++) await Bun.sleep(5);
	expect(sink.received.map((notice) => notice.kind)).toEqual(["waiting"]);
	expect(value(await reader.getDag({ dagId })).executionOwner).toBe("none");
	controller.abort();
	expect(sink.listeners.size).toBe(0);
});

test("artifact inputs retain captured bytes and continuation refreshes path hints after storage relocation", async () => {
	const { scope, delegation, execution, signal } = fixture();
	const storageRoot = join(root, `artifact-storage-${serial++}`),
		movedRoot = `${storageRoot}-moved`;
	const service = createDagService({ storageRoot, scope, delegation });
	services.push(service);
	const owner = service.bind({ caller: { kind: "owner", ownerId: "host" }, signal, execution });
	const file = `artifact-${serial++}.txt`;
	writeFileSync(join(root, file), "FROZEN_ARTIFACT");
	const graph = definition(["source", "consumer"]);
	const source = graph.nodes[0],
		consumer = graph.nodes[1];
	if (!source || !consumer) throw new Error("Missing nodes");
	source.outputs = { result: { kind: "artifact" } };
	consumer.inputs = { file: { kind: "artifact" } };
	graph.connections = [
		{
			id: "artifact",
			kind: "data",
			from: { nodeId: "source", output: "result" },
			to: { nodeId: "consumer", input: "file" },
		},
	];
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("dag_submit_result", { outputs: { result: { kind: "artifact", path: file } } }),
		),
		fauxAssistantMessage(
			fauxToolCall("dag_request_input", { question: "Continue after relocation?" }),
		),
	]);
	const dagId = await start(owner, graph);
	const waiting = await until(owner, dagId, (state) => state.nodes[1]?.status === "waiting-input");
	const oldPath = waiting.nodes[1]?.consumedInputs[0]?.value.file.localPath;
	await service.close();
	renameSync(storageRoot, movedRoot);
	writeFileSync(join(root, file), "CHANGED_WORKSPACE_FILE");
	const restored = createDagService({ storageRoot: movedRoot, scope, delegation });
	services.push(restored);
	const host = restored.bind({ caller: { kind: "owner", ownerId: "host" }, signal, execution });
	const human = restored.bind({
		caller: { kind: "human", operatorId: "operator" },
		signal,
		execution,
	});
	const current = value(await host.getDag({ dagId })),
		gate = current.gates[0];
	if (!gate) throw new Error("Missing gate");
	const captured = current.nodes[1]?.consumedInputs[0]?.value.file;
	if (!captured) throw new Error("Missing captured input");
	expect(captured.localPath).not.toBe(oldPath);
	expect(readFileSync(captured.localPath, "utf8")).toBe("FROZEN_ARTIFACT");
	const calls = faux.state.callCount;
	await command(human, dagId, { kind: "answer", gateId: gate.id, value: "/not-a-command" });
	const paused = value(await host.getDag({ dagId }));
	expect(paused.mode).toBe("paused");
	expect(paused.nodes[1]?.status).toBe("queued");
	await Bun.sleep(10);
	expect(faux.state.callCount).toBe(calls);
	faux.setResponses([result("USED_CAPTURE")]);
	await command(host, dagId, { kind: "resume" });
	const done = await until(host, dagId, (state) => state.nodes[1]?.status === "completed");
	const payload = done.nodes[1]?.payload;
	if (!payload) throw new Error("Missing resumed payload");
	expect(readFileSync(payload.localPath, "utf8")).toContain(captured.localPath);
	expect(readFileSync(payload.localPath, "utf8")).toContain("/not-a-command");
	expect(done.nodes[1]?.sessionId).toBe(waiting.nodes[1]?.sessionId);
	expect(done.nodes[1]?.activation).toBe(2);
});

test("edits stale waiting consumers without replay; retries consume new values and preserve old evidence", async () => {
	const { owner, service, signal } = fixture();
	const graph = definition(["source", "consumer"]);
	const source = graph.nodes[0],
		consumer = graph.nodes[1];
	if (!source || !consumer) throw new Error("Missing nodes");
	consumer.inputs = { data: { kind: "text" } };
	graph.connections = [
		{
			id: "data",
			kind: "data",
			from: { nodeId: "source", output: "result" },
			to: { nodeId: "consumer", input: "data" },
		},
	];
	faux.setResponses([
		result("OLD_VALUE"),
		fauxAssistantMessage(fauxToolCall("dag_request_input", { question: "Review input?" })),
	]);
	const dagId = await start(owner, graph);
	const waiting = await until(owner, dagId, (state) => state.nodes[1]?.status === "waiting-input");
	const proposalId = waiting.nodes[0]?.proposalId;
	if (!proposalId) throw new Error("Missing old output");
	const edit = {
		kind: "edit",
		edits: [{ kind: "put-node", node: { ...source, task: "Revised source task" } }],
	} as const;
	await expect(command(owner, dagId, { ...edit, edits: [...edit.edits] })).rejects.toThrow(
		'"code":"forbidden"',
	);
	const human = service.bind({ caller: { kind: "human", operatorId: "operator" }, signal });
	const request: DagCommandRequest = {
		commandId: "revise-source",
		dagId,
		expectedVersion: value(await human.getDag({ dagId })).version,
		command: { ...edit, edits: [...edit.edits] },
	};
	const receipt = value(await human.execute(request));
	expect(await owner.execute(request)).toMatchObject({ ok: false, error: { code: "forbidden" } });
	expect(value(await human.execute(request))).toEqual(receipt);
	const stale = value(await owner.getDag({ dagId }));
	expect(stale.nodes.map((node) => node.status)).toEqual(["stale", "stale"]);
	expect(stale.nodes[1]?.consumedInputs).toEqual(waiting.nodes[1]?.consumedInputs);
	await expect(
		command(owner, dagId, {
			kind: "continue",
			target: { nodeId: "consumer", attempt: 1, activation: 1 },
		}),
	).rejects.toThrow("retry");
	faux.setResponses([result("NEW_VALUE")]);
	await command(owner, dagId, { kind: "retry", target: { nodeId: "source", attempt: 1 } });
	await until(
		owner,
		dagId,
		(state) => state.nodes[0]?.status === "completed" && state.nodes[1]?.status === "stale",
	);
	faux.setResponses([result("CONSUMED_NEW")]);
	await command(owner, dagId, { kind: "retry", target: { nodeId: "consumer", attempt: 1 } });
	const done = await until(owner, dagId, (state) =>
		state.nodes.every((node) => node.status === "completed"),
	);
	const input = done.nodes[1]?.consumedInputs[0];
	if (!input) throw new Error("Missing new input");
	expect(readFileSync(input.value.file.localPath, "utf8")).toBe("NEW_VALUE");
	const payload = done.nodes[1]?.payload;
	if (!payload) throw new Error("Missing consumer payload");
	expect(JSON.parse(readFileSync(payload.localPath, "utf8")).inputs).toEqual({ data: "NEW_VALUE" });
	expect(done.nodes[0]?.proposalId).toBe(input.proposalId);
	expect(done.nodes[1]?.historyCapture).toBeUndefined();
	expect(done.nodes[0]?.outcome?.stopReason).toBe("stop");
	const old = value(await owner.getOutput({ dagId, proposalId, name: "result" }));
	expect(old.disposition).toBe("superseded");
	expect(readFileSync(old.value.file.localPath, "utf8")).toBe("OLD_VALUE");
});

test("edit preparation cannot cross an ownership handoff with a predicted version", async () => {
	const { owner, service, execution, signal, scope, delegation } = fixture();
	const graph = definition();
	const node = graph.nodes[0];
	if (!node) throw new Error("Missing node");
	const { dagId, version } = value(
		await owner.execute({ commandId: "create", command: { kind: "create", definition: graph } }),
	);
	const other = createDagService({ storageRoot: join(root, "dags"), scope, delegation });
	services.push(other);
	const controller = other.bind({
		caller: { kind: "controller", sessionId: "other-chat" },
		signal,
		execution,
	});
	const captured = latch(),
		proceed = latch(),
		open = fs.open;
	let first = true;
	const spy = spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
		const file = await open(path, flags, mode);
		if (first && basename(String(path)) === "state.json") {
			first = false;
			const close = file.close.bind(file);
			file.close = async () => {
				await close();
				captured.release();
				await proceed.promise;
			};
		}
		return file;
	});
	try {
		const pending = controller.execute({
			commandId: "predicted-edit",
			dagId,
			expectedVersion: version + 2,
			command: {
				kind: "edit",
				edits: [{ kind: "put-node", node: { ...node, task: "Controller revision" } }],
			},
		});
		await captured.promise;
		await command(owner, dagId, {
			kind: "edit",
			edits: [
				{
					kind: "put-node",
					node: { ...node, approval: { authority: "human", question: "Review this" } },
				},
			],
		});
		await service.close();
		proceed.release();
		expect(await pending).toMatchObject({
			ok: false,
			error: { code: "stale-version", currentVersion: version + 2 },
		});
		const current = value(await controller.getDag({ dagId }));
		expect(current.version).toBe(version + 2);
		expect(
			JSON.parse(readFileSync(current.definition.localPath, "utf8")).nodes[0].approval.authority,
		).toBe("human");
	} finally {
		proceed.release();
		spy.mockRestore();
	}
});

test("the first main fork freezes the pre-tool batch once; later forks ignore replacement source projections", async () => {
	const { owner, service, execution, signal } = fixture();
	const manager = SessionManager.create(root, join(root, "main-sessions"));
	const boundary = manager.appendMessage({
		role: "user",
		content: "FROZEN_MAIN_CONTEXT",
		timestamp: Date.now(),
	});
	const invoking = fauxToolCall("dag_create", {});
	invoking.id = "create-main";
	manager.appendMessage(
		fauxAssistantMessage([invoking, fauxToolCall("read", { path: "sibling" })]),
	);
	const caller = { kind: "controller", sessionId: manager.getSessionId() } as const;
	const origin = service.bind({
		caller,
		execution,
		signal,
		mainHistory: {
			kind: "session",
			sessionId: caller.sessionId,
			sessionManager: manager,
			cut: { kind: "before-tool-call", toolCallId: invoking.id },
		},
	});
	const graph = definition(["first"]);
	graph.connections = [
		{ id: "main-first", kind: "control", from: { kind: "main" }, to: "first", context: "fork" },
	];
	const { dagId } = await create(origin, graph);
	const initial = value(await owner.getDag({ dagId }));
	expect(initial.mainHistory?.entryId).toBe(boundary);
	manager.appendMessage({ role: "user", content: "LATE_MAIN_CONTEXT", timestamp: Date.now() });
	const editor = service.bind({
		caller,
		signal,
		mainHistory: {
			kind: "session",
			sessionId: "wrong-source",
			sessionManager: manager,
			cut: { kind: "at-entry", entryId: "missing" },
		},
	});
	const second = definition(["second"]).nodes[0];
	if (!second) throw new Error("Missing node");
	await command(editor, dagId, {
		kind: "edit",
		edits: [
			{ kind: "put-node", node: second },
			{
				kind: "put-connection",
				connection: {
					id: "main-second",
					kind: "control",
					from: { kind: "main" },
					to: "second",
					context: "fork",
				},
			},
		],
	});
	faux.setResponses([result("FIRST"), result("SECOND")]);
	const before = prompts.length;
	await command(owner, dagId, { kind: "resume" });
	const done = await until(owner, dagId, (state) =>
		state.nodes.every((node) => node.status === "completed"),
	);
	expect(done.mainHistory).toEqual(initial.mainHistory);
	for (const context of prompts.slice(before)) {
		expect(context).toContain("FROZEN_MAIN_CONTEXT");
		expect(context).not.toContain("LATE_MAIN_CONTEXT");
		expect(context).not.toContain("create-main");
	}
});

test("rejecting a later history export does not revoke accepted outputs or recreate the rejected gate", async () => {
	const { owner, service, signal } = fixture();
	const human = service.bind({ caller: { kind: "human", operatorId: "operator" }, signal });
	const graph = definition(["source"]);
	const source = graph.nodes[0];
	if (!source) throw new Error("Missing source");
	source.approval = { authority: "human", question: "Release this scope?" };
	faux.setResponses([result("APPROVED_OUTPUT")]);
	const dagId = await start(owner, graph);
	const waiting = await until(
		owner,
		dagId,
		(state) => state.nodes[0]?.status === "waiting-approval",
	);
	const outputGate = waiting.gates[0];
	if (!outputGate) throw new Error("Missing output gate");
	await command(human, dagId, {
		kind: "approve",
		gateId: outputGate.id,
		reason: "Only the declared output has been reviewed",
	});
	const accepted = value(await owner.getDag({ dagId }));
	const worker = definition(["forked"]).nodes[0];
	if (!worker) throw new Error("Missing fork node");
	await command(owner, dagId, {
		kind: "edit",
		edits: [
			{ kind: "put-node", node: worker },
			{
				kind: "put-connection",
				connection: {
					id: "fork",
					kind: "control",
					from: "source",
					to: "forked",
					context: "fork",
					allowSkipped: false,
				},
			},
		],
	});
	const scoped = value(await owner.getDag({ dagId }));
	const historyGate = scoped.gates.find((gate) => gate.historyCapture);
	if (!historyGate) throw new Error("Missing separate history gate");
	expect(scoped.nodes[0]?.acceptance).toEqual(accepted.nodes[0]?.acceptance);
	expect(scoped.nodes[1]?.status).toBe("pending");
	await command(human, dagId, {
		kind: "reject",
		gateId: historyGate.id,
		reason: "Do not export this conversation",
	});
	const denied = value(await owner.getDag({ dagId }));
	expect(denied.nodes[0]?.status).toBe("completed");
	expect(denied.nodes[0]?.exportedHistory?.released).toBe(false);
	await command(owner, dagId, {
		kind: "edit",
		edits: [{ kind: "put-node", node: { ...worker, task: "Unrelated consumer revision" } }],
	});
	const after = value(await owner.getDag({ dagId }));
	expect(after.gates.filter((gate) => gate.disposition === "pending")).toEqual([]);
	expect(after.gates.find((gate) => gate.id === historyGate.id)?.disposition).toBe("rejected");
});

test("an observed offer preceding a later proposal can settle with that same real pi invocation", async () => {
	const { owner, service, execution, signal } = fixture();
	const slow = createFauxCore({ provider: "dag-slow", api: "dag-slow", tokensPerSecond: 300 });
	const slowModel = { provider: "dag-slow", id: "worker" };
	runtime.registerProvider(slowModel.provider, {
		api: slow.api,
		baseUrl: "http://faux.local",
		apiKey: "synthetic",
		streamSimple: slow.streamSimple,
		models: [
			{
				id: "worker",
				name: "Slow",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});
	slow.setResponses([
		fauxAssistantMessage([
			{ type: "text", text: "Working carefully. ".repeat(60) },
			fauxToolCall("dag_submit_result", { outputs: { result: { kind: "text", text: "INITIAL" } } }),
		]),
		result("AFTER_OFFER"),
	]);
	const origin = service.bind({
		caller: { kind: "owner", ownerId: "host" },
		signal,
		execution: { ...execution, model: slowModel },
	});
	const { dagId } = await create(origin);
	await command(owner, dagId, { kind: "resume" });
	for (let n = 0; n < 100 && slow.state.callCount === 0; n++) await Bun.sleep(5);
	expect(slow.state.callCount).toBe(1);
	await command(owner, dagId, {
		kind: "steer",
		target: { nodeId: "work", attempt: 1, activation: 1 },
		text: "Revise and submit AFTER_OFFER",
	});
	await until(owner, dagId, (state) => state.interventions[0]?.status === "offered");
	const done = await until(owner, dagId, (state) => state.nodes[0]?.status === "completed");
	expect(done.nodes[0]?.activation).toBe(1);
	expect(done.interventions).toEqual([]);
	const proposalId = done.nodes[0]?.proposalId;
	if (!proposalId) throw new Error("Missing result");
	expect(value(await owner.getOutput({ dagId, proposalId, name: "result" })).value.preview).toBe(
		"AFTER_OFFER",
	);
	await expect(
		command(owner, dagId, {
			kind: "steer",
			target: { nodeId: "work", attempt: 1, activation: 1 },
			text: "Too late",
		}),
	).rejects.toThrow('"code":"stale-target"');
});

test("oversized terminal commentary does not erase actual settlement or its saved history boundary", async () => {
	const { owner } = fixture((core) => ({
		...core,
		async registerResource(id, context, options) {
			const resource = await core.registerResource(id, context, options);
			return {
				...resource,
				async createChild(spec) {
					const child = await resource.createChild(spec);
					return {
						...child,
						async runQueued(task, options) {
							return {
								...(await child.runQueued(task, options)),
								finalText: "x".repeat(LIMITS.valueBytes + 1),
							};
						},
					};
				},
			};
		},
	}));
	faux.setResponses([result("DECLARED_RESULT")]);
	const dagId = await start(owner);
	const settled = await until(owner, dagId, (state) => state.nodes[0]?.status === "completed");
	expect(settled.nodes[0]?.outcome?.stopReason).toBe("stop");
	expect(settled.nodes[0]?.outcome?.historyEntryId).toBeString();
	expect(settled.nodes[0]?.status).toBe("completed");
	expect(settled.nodes[0]?.outcome?.finalText).toBeUndefined();
	const diagnostic = settled.nodes[0]?.failure;
	if (!diagnostic) throw new Error("Missing explicit capture diagnostic");
	expect(readFileSync(diagnostic.localPath, "utf8")).toContain("finalText");
});

test.skipIf(process.platform === "win32")(
	"FIFO artifacts fail without blocking DAG controls or close",
	async () => {
		const { owner } = fixture();
		const path = join(root, `fifo-${serial++}`);
		expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
		const fifo = realpathSync(path),
			entered = latch(),
			open = fs.open;
		const spy = spyOn(fs, "open").mockImplementation((path, flags, mode) => {
			if (path === fifo) entered.release();
			return open(path, flags, mode);
		});
		const graph = definition();
		const node = graph.nodes[0];
		if (!node) throw new Error("Missing node");
		node.outputs = { result: { kind: "artifact" } };
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("dag_submit_result", { outputs: { result: { kind: "artifact", path } } }),
			),
			fauxAssistantMessage("No valid artifact"),
		]);
		const failures: unknown[] = [];
		try {
			const dagId = await start(owner, graph);
			await entered.promise;
			await Promise.race([
				command(owner, dagId, { kind: "pause" }),
				Bun.sleep(1000).then(() => {
					throw new Error("FIFO blocked the command queue");
				}),
			]);
			const settled = await until(
				owner,
				dagId,
				(state) => state.nodes[0]?.status === "needs-attention",
			);
			expect(settled.nodes[0]?.proposalId).toBeUndefined();
		} catch (error) {
			failures.push(error);
		}
		spy.mockRestore();
		try {
			const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
			await writer.close();
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENXIO"))
				failures.push(error);
		}
		if (failures.length) throw new AggregateError(failures, "FIFO capture regression");
	},
);
