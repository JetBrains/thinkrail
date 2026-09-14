import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { AgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionResources } from "@thinkrail/contracts";
import type { ChildHandle } from "pi-delegation";
import {
	abortSession,
	createSession,
	deleteSession,
	disposeAllSessions,
	getSessionMessages,
	hasSession,
	promptSession,
	reloadSessionResources,
	removeSession,
	removeWorkspaceSessions,
	setSessionCreatedPublisher,
	setSessionManagerFactory,
	setSessionPublisher,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import {
	getSessionResources,
	readBackgroundCommandOutput,
	setSessionResourcesPublisher,
	stopAllSubagents,
	stopBackgroundCommand,
	stopSubagent,
} from "./chatResources";
import { delegationServiceFor, readChildTranscript } from "./delegation";
import { configurePiRuntime } from "./piRuntime";
import { setTrashImplementationForTests } from "./trash";

const model = {
	id: "resources",
	name: "resources",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "resources",
	api: "resources",
	models: [model],
	tokensPerSecond: 10000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = mkdtempSync(join(tmpdir(), "chat-resources-"));
let sequence = 0;
beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("resources", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
});
afterAll(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.offline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = saved.offline;
	rmSync(root, { recursive: true, force: true });
});
async function parent() {
	const workspaceId = `resources-${++sequence}`;
	const cwd = mkdtempSync(join(root, "cwd-"));
	const { sessionId } = await createSession({ workspaceId, cwd });
	return { workspaceId, cwd, sessionId };
}
async function launch(p: Awaited<ReturnType<typeof parent>>, command = "printf ready; sleep 30") {
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("background_command", { action: "start", command, name: "managed" }),
		),
		fauxAssistantMessage("LAUNCHED"),
	]);
	await promptSession(p.sessionId, "Launch the managed command.");
	const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	const commandId = resources.commands.at(-1)?.id;
	if (!commandId) throw new Error("missing command");
	return commandId;
}
async function waitFor(read: () => Promise<boolean>): Promise<void> {
	const until = Date.now() + 5000;
	while (!(await read())) {
		if (Date.now() > until) throw new Error("condition timed out");
		await Bun.sleep(10);
	}
}

test("tool and UI share one command owner across parent abort and resource reload", async () => {
	const p = await parent();
	const id = await launch(p);
	await waitFor(async () => {
		const output = await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd);
		return output.available && output.output.text === "ready";
	});
	await abortSession(p.sessionId);
	await reloadSessionResources(p.sessionId);
	const before: SessionResources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(before.commands).toMatchObject([{ id, sessionId: p.sessionId, status: "running" }]);
	await stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd);
	await waitFor(
		async () =>
			(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0]?.status ===
			"stopped",
	);
	expect((await getSessionMessages(p.sessionId, p.workspaceId, p.cwd)).summary.isStreaming).toBe(
		false,
	);
	expect(await readBackgroundCommandOutput(p.workspaceId, p.sessionId, "missing", p.cwd)).toEqual({
		available: false,
	});
	await expect(getSessionResources("foreign", p.sessionId, p.cwd)).rejects.toMatchObject({
		code: "RESOURCE_UNAVAILABLE",
	});
	await expect(getSessionResources(p.workspaceId, "missing", p.cwd)).rejects.toMatchObject({
		code: "RESOURCE_UNAVAILABLE",
	});
});

test("foreign parent/workspace controls are indistinguishable from missing commands and children", async () => {
	const p = await parent();
	const other = await parent();
	const id = await launch(p);
	expect(
		await readBackgroundCommandOutput(other.workspaceId, other.sessionId, id, other.cwd),
	).toEqual({ available: false });
	for (const commandId of [id, "missing"]) {
		await expect(
			stopBackgroundCommand(other.workspaceId, other.sessionId, commandId, other.cwd),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
	}
	await expect(
		readBackgroundCommandOutput(other.workspaceId, p.sessionId, id, other.cwd),
	).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
	const service = delegationServiceFor(p.workspaceId);
	const child = await service.createChild({
		parent: p.sessionId,
		visibility: "hidden",
		info: { createdBy: "test" },
		session: {},
	});
	for (const childId of [child.sessionId, "missing"]) {
		await expect(
			stopSubagent(other.workspaceId, other.sessionId, childId, other.cwd),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
	}
	await expect(
		delegationServiceFor(other.workspaceId).createChild({
			parent: p.sessionId,
			visibility: "hidden",
			info: { createdBy: "test" },
			session: {},
		}),
	).rejects.toMatchObject({ code: "unknown-parent" });
	await stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd);
});

test("scoped catalog notifications expose stopping before settlement, never output bytes", async () => {
	const p = await parent();
	const changes: { workspaceId: string; sessionId: string }[] = [];
	const snapshots: Promise<SessionResources>[] = [];
	setSessionResourcesPublisher((payload) => {
		changes.push(payload);
		snapshots.push(getSessionResources(payload.workspaceId, payload.sessionId, p.cwd));
	});
	try {
		const id = await launch(p, "printf first; sleep 0.2; printf second; sleep 30");
		await waitFor(async () => {
			const result = await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd);
			return result.available && result.output.text === "firstsecond";
		});
		expect(changes).toEqual([{ workspaceId: p.workspaceId, sessionId: p.sessionId }]);
		await stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd);
		await waitFor(
			async () =>
				(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0]?.status ===
				"stopped",
		);
		expect((await Promise.all(snapshots)).map((snapshot) => snapshot.commands[0]?.status)).toEqual([
			"running",
			"stopping",
			"stopped",
		]);
		const count = changes.length;
		await stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd);
		expect(changes).toHaveLength(count);
	} finally {
		setSessionResourcesPublisher(() => {});
	}
});

test("natural completion wakes once after reload, and shell settings use the current parent identity", async () => {
	const workspaceId = `resources-${++sequence}`;
	const cwd = mkdtempSync(join(root, "shell-"));
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			shellPath: "/bin/bash",
			shellCommandPrefix: "export RESOURCE_PREFIX=effective",
		}),
	);
	const p = { workspaceId, cwd, ...(await createSession({ workspaceId, cwd })) };
	const gate = join(cwd, "finish");
	const id = await launch(
		p,
		`printf '%s|%s|%s|%s' "$PI_SESSION_ID" "$PI_MODEL" "$PI_REASONING_LEVEL" "$RESOURCE_PREFIX"; while ! test -f '${gate}'; do sleep 0.02; done`,
	);
	await reloadSessionResources(p.sessionId);
	faux.setResponses([fauxAssistantMessage("NATURAL_COMPLETION_TURN")]);
	writeFileSync(gate, "done");
	await waitFor(async () => {
		const { messages, summary } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		return !summary.isStreaming && JSON.stringify(messages).includes("NATURAL_COMPLETION_TURN");
	});
	const output = await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd);
	expect(output).toMatchObject({
		available: true,
		command: { status: "completed", exitCode: 0 },
		output: { text: `${p.sessionId}|resources|off|effective`, truncated: false },
	});
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	expect(
		messages.filter((m) => m.role === "custom" && m.customType === "background-command-completion"),
	).toHaveLength(1);
});

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("deletion tombstones hold completion until rollback, then replay it exactly once", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	const gate = join(p.cwd, "finish");
	const id = await launch(p, `while ! test -f '${gate}'; do sleep 0.02; done; printf done`);
	const trashEntered = deferred();
	const releaseTrash = deferred();
	setTrashImplementationForTests(async () => {
		trashEntered.resolve();
		await releaseTrash.promise;
		throw new Error("trash failed");
	});
	const deleting = deleteSession(p.sessionId, p.workspaceId, p.cwd);
	const rejected = deleting.catch((error: unknown) => error);
	try {
		await trashEntered.promise;
		await expect(getSessionResources(p.workspaceId, p.sessionId, p.cwd)).rejects.toMatchObject({
			code: "RESOURCE_UNAVAILABLE",
		});
		writeFileSync(gate, "done");
		await Bun.sleep(100);
		expect(hasSession(p.sessionId)).toBe(false);
		const path = (await SessionManager.list(p.cwd))[0]?.path;
		if (!path) throw new Error("missing transcript");
		expect(readFileSync(path, "utf8")).not.toContain(
			'"customType":"background-command-completion"',
		);
		faux.setResponses([fauxAssistantMessage("ROLLBACK_COMPLETION")]);
		releaseTrash.resolve();
		expect(String(await rejected)).toContain("trash failed");
		await waitFor(async () => {
			const { messages, summary } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
			return !summary.isStreaming && JSON.stringify(messages).includes("ROLLBACK_COMPLETION");
		});
		expect(await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd)).toMatchObject({
			available: true,
			command: { status: "completed" },
		});
	} finally {
		releaseTrash.resolve();
		setTrashImplementationForTests(undefined);
	}
});

test("confirmed trash and archive suppress command notices and retain no command control", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	const id = await launch(p);
	let trashed: string | undefined;
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected path");
		trashed = input;
		rmSync(input);
	});
	try {
		await deleteSession(p.sessionId, p.workspaceId, p.cwd);
		expect(trashed && existsSync(trashed)).toBe(false);
		await expect(
			readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
	} finally {
		setTrashImplementationForTests(undefined);
	}
	const archived = await parent();
	await launch(archived);
	await removeWorkspaceSessions(archived.workspaceId, archived.cwd);
	await expect(
		getSessionResources(archived.workspaceId, archived.sessionId, archived.cwd),
	).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
});

test("persisted parent attachment does not recover command handles from transcript history", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	const id = await launch(p);
	await removeSession(p.sessionId);
	expect(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).toEqual({
		workspaceId: p.workspaceId,
		sessionId: p.sessionId,
		commands: [],
		subagents: [],
	});
	expect(await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd)).toEqual({
		available: false,
	});
	await expect(stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd)).rejects.toMatchObject({
		code: "RESOURCE_UNAVAILABLE",
	});
});

test("direct child projection keeps every active and latest twenty terminal records without disposal", async () => {
	const p = await parent();
	const service = delegationServiceFor(p.workspaceId);
	const children: ChildHandle[] = [];
	const changes: { workspaceId: string; sessionId: string }[] = [];
	setSessionResourcesPublisher((payload) => changes.push(payload));
	try {
		for (let i = 0; i < 23; i++) {
			const child = await service.createChild({
				parent: p.sessionId,
				visibility: "hidden",
				info: { createdBy: "test", roleName: "r".repeat(201) },
				session: {},
			});
			children.push(child);
			faux.setResponses([fauxAssistantMessage(`CHILD_${i}`)]);
			await child.runQueued("task".repeat(600));
		}
		const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
		expect(resources.subagents.map((s) => s.childSessionId)).toEqual(
			children.slice(-20).map((c) => c.sessionId),
		);
		expect(
			resources.subagents.every((s) => s.task.length === 2000 && s.roleName?.length === 200),
		).toBe(true);
		expect(service.childrenOf(p.sessionId)).toHaveLength(23);
		const oldest = children[0];
		if (!oldest) throw new Error("missing child");
		expect(readChildTranscript(p.workspaceId, p.sessionId, oldest.sessionId).status).toBe(
			"completed",
		);
		expect(oldest.snapshot?.collected).toBe(false);
		expect(changes).toHaveLength(23 * 4);
		expect(
			changes.every((c) => c.workspaceId === p.workspaceId && c.sessionId === p.sessionId),
		).toBe(true);
	} finally {
		setSessionResourcesPublisher(() => {});
	}
});

test("stop-all signals running and queued direct siblings before awaiting any and preserves parent/handles", async () => {
	const p = await parent();
	const service = delegationServiceFor(p.workspaceId);
	const gate = deferred();
	faux.setResponses(
		Array.from({ length: 4 }, () => async () => {
			await gate.promise;
			return fauxAssistantMessage("CHILD_FINISH");
		}),
	);
	const children: ChildHandle[] = [];
	const runs = [];
	for (let i = 0; i < 6; i++) {
		const child = await service.createChild({
			parent: p.sessionId,
			visibility: "hidden",
			info: { createdBy: "test" },
			session: {},
		});
		children.push(child);
		runs.push(child.runQueued(`task ${i}`));
	}
	await waitFor(async () => children.filter((c) => c.snapshot?.status === "running").length === 4);
	expect(children.filter((c) => c.snapshot?.status === "queued")).toHaveLength(2);
	const stopped = stopAllSubagents(p.workspaceId, p.sessionId, p.cwd);
	try {
		await waitFor(async () => children.slice(4).every((c) => c.snapshot?.status === "aborted"));
		expect(children.slice(4).every((c) => c.snapshot?.details.abortReason === "user")).toBe(true);
		expect((await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents).toHaveLength(
			6,
		);
	} finally {
		gate.resolve();
	}
	expect(await stopped).toBe(6);
	await Promise.all(runs);
	expect(
		children.every(
			(c) => c.snapshot?.status === "aborted" && c.snapshot.details.abortReason === "user",
		),
	).toBe(true);
	expect(service.childrenOf(p.sessionId)).toHaveLength(6);
	expect(hasSession(p.sessionId)).toBe(true);
	expect(await stopAllSubagents(p.workspaceId, p.sessionId, p.cwd)).toBe(0);
});

test("a registration failure removes the disposed session from live resource authority", async () => {
	let attempted: string | undefined;
	setSessionCreatedPublisher((summary) => {
		attempted = summary.sessionId;
		throw new Error("broadcast failed");
	});
	try {
		await expect(parent()).rejects.toThrow("broadcast failed");
		expect(attempted).toBeDefined();
		if (!attempted) throw new Error("Missing attempted session");
		expect(hasSession(attempted)).toBe(false);
	} finally {
		setSessionCreatedPublisher(() => {});
		if (attempted && hasSession(attempted)) await removeSession(attempted);
	}
});

test("failed preparation stops commands launched before registration and does not deliver completion", async () => {
	const original = AgentSession.prototype.bindExtensions;
	const cwd = mkdtempSync(join(root, "prepare-"));
	const marker = join(cwd, "alive");
	let failedSession: AgentSession | undefined;
	AgentSession.prototype.bindExtensions = async function (bindings) {
		await original.call(this, bindings);
		failedSession = this;
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", {
					action: "start",
					command: `while :; do printf x >> '${marker}'; sleep 0.02; done`,
				}),
			),
			fauxAssistantMessage("started"),
		]);
		await this.prompt("Launch.");
		await waitFor(async () => existsSync(marker));
		throw new Error("prepare failed");
	};
	try {
		await expect(createSession({ workspaceId: "prepare-failed", cwd })).rejects.toThrow(
			"prepare failed",
		);
		await settleSessionsForShutdown();
		const size = readFileSync(marker).length;
		await Bun.sleep(80);
		expect(readFileSync(marker).length).toBe(size);
		expect(
			failedSession?.messages.some(
				(m) => m.role === "custom" && m.customType === "background-command-completion",
			),
		).toBe(false);
	} finally {
		AgentSession.prototype.bindExtensions = original;
	}
});

test("user stop of a detached Agent child does not wake its idle parent", async () => {
	const p = await parent();
	const gate = deferred();
	let starts = 0;
	setSessionPublisher(({ sessionId, event }) => {
		if (sessionId === p.sessionId && event.type === "agent_start") starts++;
	});
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "worker",
				task: "Do background work",
				run_in_background: true,
			}),
		),
		async () => {
			await gate.promise;
			return fauxAssistantMessage("CHILD_DONE");
		},
		fauxAssistantMessage("PARENT_ACK"),
	]);
	try {
		await promptSession(p.sessionId, "Delegate in the background.");
		const child = (await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents[0];
		if (!child) throw new Error("missing child");
		const stopping = stopSubagent(p.workspaceId, p.sessionId, child.childSessionId, p.cwd);
		gate.resolve();
		await stopping;
		await waitFor(async () =>
			(await getSessionMessages(p.sessionId, p.workspaceId, p.cwd)).messages.some(
				(m) => m.role === "custom" && m.customType === "subagent-completion",
			),
		);
		expect(starts).toBe(1);
		expect(
			(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents[0],
		).toMatchObject({ status: "aborted", abortReason: "user" });
	} finally {
		gate.resolve();
		setSessionPublisher(() => {});
	}
});

test("shutdown and disposal signal commands and every child before waiting for a gated parent", async () => {
	const p = await parent();
	const marker = join(p.cwd, "running");
	await launch(p, `while :; do printf x >> '${marker}'; sleep 0.02; done`);
	const service = delegationServiceFor(p.workspaceId);
	const childGate = deferred();
	let childrenEntered = 0;
	faux.setResponses(
		Array.from({ length: 4 }, () => async () => {
			childrenEntered++;
			await childGate.promise;
			return fauxAssistantMessage("CHILD");
		}),
	);
	const children: ChildHandle[] = [];
	const runs = [];
	for (let i = 0; i < 5; i++) {
		const child = await service.createChild({
			parent: p.sessionId,
			visibility: "hidden",
			info: { createdBy: "test" },
			session: {},
		});
		children.push(child);
		runs.push(child.runQueued("background"));
	}
	await waitFor(async () => childrenEntered === 4 && existsSync(marker));
	const parentGate = deferred();
	const parentEntered = deferred();
	faux.setResponses([
		async () => {
			parentEntered.resolve();
			await parentGate.promise;
			return fauxAssistantMessage("PARENT");
		},
	]);
	const runningParent = promptSession(p.sessionId, "Long turn.");
	await parentEntered.promise;
	const shuttingDown = settleSessionsForShutdown(50);
	try {
		await waitFor(async () => children[4]?.snapshot?.status === "aborted");
		await shuttingDown;
		const length = readFileSync(marker).length;
		await Bun.sleep(80);
		expect(readFileSync(marker).length).toBe(length);
		expect(children.filter((child) => child.snapshot?.status === "running")).toHaveLength(4);
		await expect(getSessionResources(p.workspaceId, p.sessionId, p.cwd)).rejects.toMatchObject({
			code: "RESOURCE_UNAVAILABLE",
		});
	} finally {
		childGate.resolve();
		parentGate.resolve();
	}
	await Promise.all([...runs, runningParent]);
	await removeSession(p.sessionId);
	expect(service.childrenOf(p.sessionId)).toHaveLength(0);
});

test("SDK creation failure on new and reopened sessions never registers resource authority", async () => {
	const cwd = mkdtempSync(join(root, "sdk-failure-"));
	let id = "";
	setSessionManagerFactory((dir) => {
		const manager = SessionManager.inMemory(dir);
		id = manager.getSessionId();
		manager.buildSessionContext = () => {
			throw new Error("SDK creation failed");
		};
		return manager;
	});
	try {
		await expect(createSession({ cwd, workspaceId: "sdk-failure" })).rejects.toThrow(
			"SDK creation failed",
		);
		await expect(getSessionResources("sdk-failure", id, cwd)).rejects.toMatchObject({
			code: "RESOURCE_UNAVAILABLE",
		});
	} finally {
		setSessionManagerFactory((dir) => SessionManager.inMemory(dir));
	}
	setSessionManagerFactory((dir) => SessionManager.create(dir));
	const p = await parent();
	setSessionManagerFactory((dir) => SessionManager.inMemory(dir));
	faux.setResponses([fauxAssistantMessage("PERSISTED")]);
	await promptSession(p.sessionId, "Persist this parent.");
	await removeSession(p.sessionId);
	const original = AgentSession.prototype.bindExtensions;
	AgentSession.prototype.bindExtensions = async () => {
		throw new Error("reopen preparation failed");
	};
	try {
		await expect(getSessionResources(p.workspaceId, p.sessionId, p.cwd)).rejects.toMatchObject({
			code: "RESOURCE_UNAVAILABLE",
		});
		expect(hasSession(p.sessionId)).toBe(false);
	} finally {
		AgentSession.prototype.bindExtensions = original;
	}
	expect((await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands).toEqual([]);
});

test("evicted command ids have the same unavailable result as foreign and unknown ids", async () => {
	const p = await parent();
	let oldest = "";
	for (let i = 0; i < 21; i++) {
		const id = await launch(p);
		if (i === 0) oldest = id;
		await stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd);
		await waitFor(async () => {
			const output = await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd);
			return output.available && output.command.status === "stopped";
		});
	}
	expect((await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands).toHaveLength(20);
	expect(await readBackgroundCommandOutput(p.workspaceId, p.sessionId, oldest, p.cwd)).toEqual({
		available: false,
	});
	await expect(
		stopBackgroundCommand(p.workspaceId, p.sessionId, oldest, p.cwd),
	).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
});

test("completion before registration is held and flushed once the parent is addressable", async () => {
	const original = AgentSession.prototype.bindExtensions;
	const cwd = mkdtempSync(join(root, "registration-"));
	const marker = join(cwd, "finished");
	AgentSession.prototype.bindExtensions = async function (bindings) {
		await original.call(this, bindings);
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("background_command", {
					action: "start",
					command: `printf done > '${marker}'`,
				}),
			),
			fauxAssistantMessage("ACK"),
		]);
		await this.prompt("Launch before registration.");
		await waitFor(async () => existsSync(marker));
		await Bun.sleep(30);
		expect(
			this.messages.some(
				(m) => m.role === "custom" && m.customType === "background-command-completion",
			),
		).toBe(false);
		faux.setResponses([fauxAssistantMessage("REGISTERED_COMPLETION")]);
	};
	try {
		const { sessionId } = await createSession({ workspaceId: "registration", cwd });
		await waitFor(async () => {
			const { messages, summary } = await getSessionMessages(sessionId, "registration", cwd);
			return !summary.isStreaming && JSON.stringify(messages).includes("REGISTERED_COMPLETION");
		});
		const { messages } = await getSessionMessages(sessionId, "registration", cwd);
		expect(
			messages.filter(
				(m) => m.role === "custom" && m.customType === "background-command-completion",
			),
		).toHaveLength(1);
	} finally {
		AgentSession.prototype.bindExtensions = original;
	}
});

async function launchSubagent(p: Awaited<ReturnType<typeof parent>>) {
	const finish = deferred();
	const entered = deferred();
	let completionTurns = 0;
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", {
				subagent_type: "worker",
				task: "Retain this detached job through parent lifecycle changes",
				run_in_background: true,
			}),
		),
		async () => {
			entered.resolve();
			await finish.promise;
			return fauxAssistantMessage("DETACHED_CHILD_RESULT");
		},
		fauxAssistantMessage("IDLE_PARENT_ACK"),
		() => {
			completionTurns++;
			return fauxAssistantMessage("DETACHED_COMPLETION_TURN");
		},
	]);
	await promptSession(p.sessionId, "Delegate in the background.");
	await entered.promise;
	const child = delegationServiceFor(p.workspaceId).childrenOf(p.sessionId).at(-1);
	if (!child) throw new Error("Agent did not create a child");
	return { child, finish: finish.resolve, completionTurns: () => completionTurns };
}

async function subagentCompletions(p: Awaited<ReturnType<typeof parent>>) {
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	return messages.filter((m) => m.role === "custom" && m.customType === "subagent-completion");
}

test("held trash gates detached Agent completion and rollback replays exactly once", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	const job = await launchSubagent(p);
	const trashEntered = deferred();
	const releaseTrash = deferred();
	let transcript = "";
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected path");
		transcript = input;
		trashEntered.resolve();
		await releaseTrash.promise;
		throw new Error("held trash failed");
	});
	const deleting = deleteSession(p.sessionId, p.workspaceId, p.cwd).catch(
		(error: unknown) => error,
	);
	try {
		await trashEntered.promise;
		job.finish();
		await waitFor(async () => job.child.snapshot?.status === "completed");
		expect(job.completionTurns()).toBe(0);
		expect(readFileSync(transcript, "utf8")).not.toContain('"customType":"subagent-completion"');
		expect(hasSession(p.sessionId)).toBe(false);
		releaseTrash.resolve();
		expect(String(await deleting)).toContain("held trash failed");
		await waitFor(
			async () => (await subagentCompletions(p)).length === 1 && job.completionTurns() === 1,
		);
		await waitFor(
			async () =>
				!(await getSessionMessages(p.sessionId, p.workspaceId, p.cwd)).summary.isStreaming,
		);
		await reloadSessionResources(p.sessionId);
		await reloadSessionResources(p.sessionId);
		expect(await subagentCompletions(p)).toHaveLength(1);
		expect(job.completionTurns()).toBe(1);
	} finally {
		job.finish();
		releaseTrash.resolve();
		await deleting;
		setTrashImplementationForTests(undefined);
		await removeSession(p.sessionId);
	}
});

test.each([
	false,
	true,
])("confirmed trash closes detached completion (settled during trash: %s)", async (settledDuringTrash) => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	const job = await launchSubagent(p);
	const trashed = join(root, `trashed-${p.sessionId}.jsonl`);
	const moved = deferred();
	const trashEntered = deferred();
	const releaseTrash = deferred();
	let transcript = "";
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected path");
		transcript = input;
		trashEntered.resolve();
		await releaseTrash.promise;
		renameSync(input, trashed);
		moved.resolve();
	});
	const deleting = deleteSession(p.sessionId, p.workspaceId, p.cwd);
	try {
		await trashEntered.promise;
		if (settledDuringTrash) {
			job.finish();
			await waitFor(async () => job.child.snapshot?.status === "completed");
			expect(job.completionTurns()).toBe(0);
		}
		releaseTrash.resolve();
		await moved.promise;
		await Bun.sleep(0);
		job.finish();
		await deleting;
		expect(job.child.snapshot?.status).toBe(settledDuringTrash ? "completed" : "aborted");
		expect(job.completionTurns()).toBe(0);
		expect(existsSync(transcript)).toBe(false);
		expect(readFileSync(trashed, "utf8")).not.toContain('"customType":"subagent-completion"');
		expect(delegationServiceFor(p.workspaceId).childrenOf(p.sessionId)).toHaveLength(0);
	} finally {
		releaseTrash.resolve();
		job.finish();
		await deleting;
		setTrashImplementationForTests(undefined);
	}
});

test.each([
	false,
	true,
])("shutdown suppresses an idle parent's detached completion beyond budget: %s", async (expireBudget) => {
	const p = await parent();
	const job = await launchSubagent(p);
	const closing = settleSessionsForShutdown(expireBudget ? 10 : 1000);
	try {
		if (expireBudget) {
			await closing;
			expect(job.child.snapshot?.status).toBe("running");
		}
		job.finish();
		await closing;
		await waitFor(async () => job.child.snapshot?.status === "aborted");
		expect(await subagentCompletions(p)).toHaveLength(0);
		expect(job.completionTurns()).toBe(0);
		expect((await getSessionMessages(p.sessionId, p.workspaceId, p.cwd)).summary.isStreaming).toBe(
			false,
		);
	} finally {
		job.finish();
		await closing;
		await removeSession(p.sessionId);
	}
});

test.each([
	"gap",
	"rebound",
])("host resource reload retains Agent jobs and completion settling %s", async (timing) => {
	const p = await parent();
	const job = await launchSubagent(p);
	const original = AgentSession.prototype.reload;
	const inGap = deferred();
	const resume = deferred();
	AgentSession.prototype.reload = async function (options) {
		await original.call(this, {
			...options,
			beforeSessionStart: async () => {
				inGap.resolve();
				await resume.promise;
				await options?.beforeSessionStart?.();
			},
		});
	};
	const reloading = reloadSessionResources(p.sessionId);
	try {
		await inGap.promise;
		expect((await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents).toMatchObject([
			{ childSessionId: job.child.sessionId, status: "running" },
		]);
		if (timing === "gap") {
			job.finish();
			await waitFor(async () => job.child.snapshot?.status === "completed");
			expect(await subagentCompletions(p)).toHaveLength(0);
			expect(job.completionTurns()).toBe(0);
		}
		resume.resolve();
		await reloading;
		job.finish();
		await waitFor(
			async () => (await subagentCompletions(p)).length === 1 && job.completionTurns() === 1,
		);
		await waitFor(
			async () =>
				!(await getSessionMessages(p.sessionId, p.workspaceId, p.cwd)).summary.isStreaming,
		);
		await reloadSessionResources(p.sessionId);
		expect(await subagentCompletions(p)).toHaveLength(1);
		expect(job.completionTurns()).toBe(1);
		expect((await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents).toMatchObject([
			{ childSessionId: job.child.sessionId, status: "completed" },
		]);
	} finally {
		resume.resolve();
		job.finish();
		await reloading;
		AgentSession.prototype.reload = original;
		await removeSession(p.sessionId);
	}
});
