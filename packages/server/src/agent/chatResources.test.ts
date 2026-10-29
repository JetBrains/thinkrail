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
import { resourceRecordId, type SessionResources, type SessionState } from "@thinkrail/contracts";
import type { BackgroundCommandSnapshot, BackgroundCommands } from "pi-background-commands";
import type { ChildHandle } from "pi-delegation";
import { interactiveTools } from "../extensions";
import {
	archivedCommandOutput,
	finishedResources,
	recordResource,
	resourceHistoryRoot,
} from "../resourceHistory";
import { setTrashImplementationForTests } from "../trash";
import {
	abortSession,
	compactSession,
	createSession,
	deleteSession,
	disposeAllSessions,
	getSessionMessages,
	getSessionState,
	hasSession,
	promptSession,
	reloadSessionResources,
	removeSession,
	removeWorkspaceSessions,
	respondToTool,
	setSessionCreatedPublisher,
	setSessionManagerFactory,
	setSessionProjectResolver,
	setSessionPublisher,
	setSessionStatePublisher,
	setSkillAdmissionResolver,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import {
	archiveCommandHistory,
	getResourceHistoryPage,
	getSessionResources,
	readBackgroundCommandOutput,
	setSessionResourcesPublisher,
	stopAllSubagents,
	stopBackgroundCommand,
	stopSubagent,
} from "./chatResources";
import { delegationServiceFor, readChildTranscript } from "./delegation";
import { configurePiRuntime } from "./piRuntime";
import { admissionContextFor } from "./skillAdmission";
import { assessRespondability, TOOL_RESPONSE_PENDING_TEXT } from "./toolResponses";

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
	setSkillAdmissionResolver(() => admissionContextFor({ piResourceTrust: "granted" }));
});
afterAll(async () => {
	setSkillAdmissionResolver(() => admissionContextFor(undefined));
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
	const known = new Set(
		(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands.map((c) => c.id),
	);
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("background_command", { action: "start", command, name: "managed" }),
		),
		fauxAssistantMessage("LAUNCHED"),
	]);
	await promptSession(p.sessionId, "Launch the managed command.");
	const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	const commandId = resources.commands.find((c) => !known.has(c.id))?.id;
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
	await waitFor(
		async () =>
			(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0]?.status ===
			"stopped",
	);
});

test("scoped catalog notifications expose stopping before settlement, never output bytes", async () => {
	const p = await parent();
	const changes: { workspaceId: string; sessionId: string }[] = [];
	const snapshots: Promise<SessionResources>[] = [];
	setSessionResourcesPublisher((payload) => {
		if (payload.workspaceId !== p.workspaceId && payload.sessionId !== p.sessionId) return;
		changes.push(payload);
		const snapshot = getSessionResources(payload.workspaceId, payload.sessionId, p.cwd);
		snapshot.catch(() => {});
		snapshots.push(snapshot);
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
		expect(existsSync(join(resourceHistoryRoot(), p.workspaceId, p.sessionId, "index.jsonl"))).toBe(
			true,
		);
		await expect(
			readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
	} finally {
		setTrashImplementationForTests(undefined);
	}
	const archived = await parent();
	await launch(archived);
	expect(existsSync(join(resourceHistoryRoot(), archived.workspaceId))).toBe(true);
	await removeWorkspaceSessions(archived.workspaceId, archived.cwd);
	expect(existsSync(join(resourceHistoryRoot(), archived.workspaceId))).toBe(false);
	await expect(
		getSessionResources(archived.workspaceId, archived.sessionId, archived.cwd),
	).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
});

test("a graceful shutdown archives a running command as interrupted with its final log tail", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	const id = await launch(p);
	await waitFor(async () => {
		const read = await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd);
		return read.available && read.output.text === "ready";
	});
	await settleSessionsForShutdown(1000);
	disposeAllSessions();
	expect(hasSession(p.sessionId)).toBe(false);

	let restarted: SessionResources | undefined;
	await waitFor(async () => {
		restarted = await getSessionResources(p.workspaceId, p.sessionId, p.cwd).catch(() => undefined);
		return restarted !== undefined;
	});
	if (!restarted) throw new Error("parent did not reattach");
	expect(restarted.commands).toMatchObject([{ id, interrupted: true }]);
	expect(restarted.history?.commands.interrupted).toBe(1);
	expect(await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd)).toMatchObject({
		available: true,
		output: { text: "ready" },
	});
	await removeSession(p.sessionId);
});

test("work a dead host left in flight reads as interrupted and keeps no log", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	recordResource(p, {
		kind: "command",
		summary: {
			id: "c0ffee00-0000-4000-8000-000000000001",
			sessionId: p.sessionId,
			name: "dev server",
			command: "bun run dev",
			status: "running",
			startedAt: 1_000,
		},
	});
	recordResource(p, {
		kind: "subagent",
		summary: {
			childSessionId: "01a00000-0000-7000-8000-000000000001",
			parentSessionId: p.sessionId,
			task: "Explore",
			status: "running",
			createdAt: new Date(2_000).toISOString(),
		},
	});

	const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(resources.commands).toMatchObject([{ status: "stopped", interrupted: true }]);
	expect(resources.subagents).toMatchObject([{ status: "aborted", interrupted: true }]);
	expect(
		await readBackgroundCommandOutput(
			p.workspaceId,
			p.sessionId,
			"c0ffee00-0000-4000-8000-000000000001",
			p.cwd,
		),
	).toEqual({ available: false });
	await removeSession(p.sessionId);
});

test("finished commands page newest first and the page size is clamped", async () => {
	const p = await parent();
	const first = await launch(p, "printf one");
	const second = await launch(p, "printf two");
	await waitFor(async () =>
		(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands.every(
			(command) => command.status === "completed",
		),
	);
	const newest = await getResourceHistoryPage(p.workspaceId, p.sessionId, p.cwd, {
		kind: "command",
		limit: 1,
	});
	expect(newest).toMatchObject({ kind: "command", items: [{ id: second }], hasMore: true });
	if (newest.kind !== "command") throw new Error("wrong page kind");
	const cursor = newest.items[0];
	if (!cursor?.finishedAt) throw new Error("missing cursor");
	expect(
		await getResourceHistoryPage(p.workspaceId, p.sessionId, p.cwd, {
			kind: "command",
			before: { at: cursor.finishedAt, id: cursor.id },
			limit: 1_000,
		}),
	).toMatchObject({ kind: "command", items: [{ id: first }], hasMore: false });
});

test("the command archive marks only teardown's own cuts interrupted, keeps their logs, and stops at finish", () => {
	const scope = { workspaceId: "archive-unit", sessionId: "chat-archive" };
	const snapshots = new Map<string, BackgroundCommandSnapshot>();
	const listeners = new Set<() => void>();
	const commands: BackgroundCommands = {
		sessionId: scope.sessionId,
		start: () => {
			throw new Error("unused");
		},
		list: () => [...snapshots.values()],
		find: (id) => {
			const snapshot = snapshots.get(id);
			return (
				snapshot && {
					id,
					snapshot,
					output: { text: `log of ${id}`, truncated: false },
					stop: () => snapshot,
					claimCompletion: () => {},
				}
			);
		},
		onChange: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		bindCompletion: () => () => {},
		flushCompletions: () => {},
		dispose: async () => {},
	};
	const report = (id: string, patch: Partial<BackgroundCommandSnapshot>) => {
		snapshots.set(id, {
			id,
			sessionId: scope.sessionId,
			name: id,
			command: `run ${id}`,
			status: "running",
			startedAt: 1,
			...snapshots.get(id),
			...patch,
		});
		for (const listener of listeners) listener();
	};
	let closing = false;
	report("user", {});
	const archive = archiveCommandHistory(
		scope.workspaceId,
		scope.sessionId,
		commands,
		() => closing,
	);
	report("cut", {});
	report("hung", {});
	report("user", { status: "stopping" });
	closing = true;
	report("cut", { status: "stopping" });
	report("hung", { status: "stopping" });
	report("user", { status: "stopped", finishedAt: 5 });
	report("cut", { status: "stopped", finishedAt: 6 });
	archive.finish();
	report("hung", { status: "stopped", finishedAt: 7 });

	const archived = new Map(
		finishedResources(scope, "command", new Set()).map((record) => [
			resourceRecordId(record),
			record.summary,
		]),
	);
	expect(archived.get("user")).toMatchObject({ status: "stopped" });
	expect(archived.get("user")?.interrupted).toBeUndefined();
	expect(archived.get("cut")).toMatchObject({ status: "stopped", interrupted: true });
	expect(archived.get("hung")).toMatchObject({ status: "stopped", interrupted: true });
	expect(archivedCommandOutput(scope, "cut")).toEqual({ text: "log of cut", truncated: false });
	expect(archivedCommandOutput(scope, "hung")).toEqual({ text: "log of hung", truncated: false });
});

test("a user stop that settles during teardown stays stopped; teardown's own cut is interrupted", async () => {
	const p = await parent();
	const service = delegationServiceFor(p.workspaceId);
	const gate = deferred();
	faux.setResponses(
		Array.from({ length: 2 }, () => async () => {
			await gate.promise;
			return fauxAssistantMessage("CHILD_DONE");
		}),
	);
	const stoppedByUser = await service.createChild({
		parent: p.sessionId,
		visibility: "hidden",
		info: { createdBy: "test" },
		session: {},
	});
	const cut = await service.createChild({
		parent: p.sessionId,
		visibility: "hidden",
		info: { createdBy: "test" },
		session: {},
	});
	const runs = [stoppedByUser.runQueued("Stop me."), cut.runQueued("Outlive me.")];
	await waitFor(
		async () => stoppedByUser.snapshot?.status === "running" && cut.snapshot?.status === "running",
	);
	const stopping = stopSubagent(p.workspaceId, p.sessionId, stoppedByUser.sessionId, p.cwd);
	const removing = removeSession(p.sessionId);
	gate.resolve();
	await Promise.allSettled([stopping, removing, ...runs]);

	const archived = new Map(
		finishedResources(p, "subagent", new Set()).map((record) => [
			resourceRecordId(record),
			record.summary,
		]),
	);
	expect(archived.get(stoppedByUser.sessionId)).toMatchObject({
		status: "aborted",
		abortReason: "user",
	});
	expect(archived.get(stoppedByUser.sessionId)?.interrupted).toBeUndefined();
	expect(archived.get(cut.sessionId)).toMatchObject({ status: "aborted", interrupted: true });
});

test("the live owner's finished record wins over an archived one it outlived", async () => {
	const p = await parent();
	const id = await launch(p, "printf done");
	await waitFor(
		async () =>
			(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0]?.status ===
			"completed",
	);
	const finished = (await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0];
	if (!finished) throw new Error("missing command");
	const { finishedAt: _finishedAt, exitCode: _exitCode, ...inFlight } = finished;
	recordResource(p, { kind: "command", summary: { ...inFlight, status: "running" } });

	const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(resources.commands).toMatchObject([{ id, status: "completed", exitCode: 0 }]);
	expect(resources.commands[0]?.interrupted).toBeUndefined();
	expect(resources.history?.commands).toEqual({ done: 1, failed: 0, stopped: 0, interrupted: 0 });
	await removeSession(p.sessionId);
});

test("persisted parent attachment restores archived history, never command handles", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	const id = await launch(p);
	await waitFor(async () => {
		const read = await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd);
		return read.available && read.output.text === "ready";
	});
	await removeSession(p.sessionId);
	const reattached = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(reattached.commands).toMatchObject([{ id, status: "stopped", interrupted: true }]);
	expect(reattached.history?.commands).toEqual({ done: 0, failed: 0, stopped: 0, interrupted: 1 });
	expect(reattached.subagents).toEqual([]);
	expect(await readBackgroundCommandOutput(p.workspaceId, p.sessionId, id, p.cwd)).toMatchObject({
		available: true,
		command: { id, interrupted: true },
		output: { text: "ready", truncated: false },
	});
	await expect(stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd)).rejects.toMatchObject({
		code: "RESOURCE_UNAVAILABLE",
	});
});

test("resource reads fail closed while a prior parent generation tears down", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	faux.setResponses([fauxAssistantMessage("PERSISTED")]);
	await promptSession(p.sessionId, "Persist this parent.");
	const service = delegationServiceFor(p.workspaceId);
	const gate = deferred();
	faux.setResponses([
		async () => {
			await gate.promise;
			return fauxAssistantMessage("OLD_CHILD_DONE");
		},
	]);
	const child = await service.createChild({
		parent: p.sessionId,
		visibility: "hidden",
		info: { createdBy: "test" },
		session: {},
	});
	const run = child.runQueued("Hold teardown open.");
	await waitFor(async () => child.snapshot?.status === "running");
	const removing = removeSession(p.sessionId);
	try {
		await expect(getSessionResources(p.workspaceId, p.sessionId, p.cwd)).rejects.toMatchObject({
			code: "RESOURCE_UNAVAILABLE",
		});
	} finally {
		gate.resolve();
	}
	await Promise.all([removing, run]);
	const reattached = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(reattached.commands).toEqual([]);
	expect(reattached.subagents).toMatchObject([
		{ childSessionId: child.sessionId, status: "aborted", interrupted: true },
	]);
	expect(reattached.history?.subagents.interrupted).toBe(1);
	await removeSession(p.sessionId);
});

test("workspace archive stops existing resources before awaiting parent preparation", async () => {
	const cwd = mkdtempSync(join(root, "archive-preparation-"));
	const workspaceId = `archive-preparation-${++sequence}`;
	const existing = await createSession({ cwd, workspaceId });
	const marker = join(cwd, "existing-command");
	await launch(
		{ cwd, workspaceId, sessionId: existing.sessionId },
		`while :; do printf x >> '${marker}'; sleep 0.02; done`,
	);
	await waitFor(async () => existsSync(marker));
	const original = AgentSession.prototype.bindExtensions;
	const entered = deferred();
	const release = deferred();
	let sessionId: string | undefined;
	AgentSession.prototype.bindExtensions = async function (bindings) {
		await original.call(this, bindings);
		sessionId = this.sessionId;
		entered.resolve();
		await release.promise;
	};
	const creating = createSession({ cwd, workspaceId });
	creating.catch(() => {});
	try {
		await entered.promise;
		const archiving = removeWorkspaceSessions(workspaceId, cwd);
		let archived = false;
		void archiving.then(() => {
			archived = true;
		});
		await Bun.sleep(40);
		expect(archived).toBe(false);
		const markerSize = readFileSync(marker).length;
		await Bun.sleep(80);
		expect(readFileSync(marker).length).toBe(markerSize);
		release.resolve();
		await archiving;
		await expect(creating).rejects.toThrow("Unknown session");
		expect(sessionId && hasSession(sessionId)).toBe(false);
	} finally {
		release.resolve();
		AgentSession.prototype.bindExtensions = original;
		await creating.catch(() => {});
		if (sessionId && hasSession(sessionId)) await removeSession(sessionId);
		if (hasSession(existing.sessionId)) await removeSession(existing.sessionId);
	}
});

test("workspace archive fences an in-flight persisted-parent attachment", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const p = await parent();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	faux.setResponses([fauxAssistantMessage("PERSISTED_FOR_ARCHIVE")]);
	await promptSession(p.sessionId, "Persist before attachment.");
	await removeSession(p.sessionId);
	const original = AgentSession.prototype.bindExtensions;
	const entered = deferred();
	const release = deferred();
	AgentSession.prototype.bindExtensions = async function (bindings) {
		await original.call(this, bindings);
		if (this.sessionId !== p.sessionId) return;
		entered.resolve();
		await release.promise;
	};
	const attaching = getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	attaching.catch(() => {});
	try {
		await entered.promise;
		const archiving = removeWorkspaceSessions(p.workspaceId, p.cwd);
		let archived = false;
		void archiving.then(() => {
			archived = true;
		});
		await Bun.sleep(0);
		expect(archived).toBe(false);
		release.resolve();
		await expect(attaching).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
		await archiving;
		expect(hasSession(p.sessionId)).toBe(false);
	} finally {
		release.resolve();
		AgentSession.prototype.bindExtensions = original;
		await attaching.catch(() => {});
		if (hasSession(p.sessionId)) await removeSession(p.sessionId);
	}
});

test("direct child projection keeps every active and the newest twenty finished records, pages the rest, and disposes nothing", async () => {
	const p = await parent();
	const service = delegationServiceFor(p.workspaceId);
	const children: ChildHandle[] = [];
	const changes: { workspaceId: string; sessionId: string }[] = [];
	setSessionResourcesPublisher((payload) => {
		if (payload.workspaceId === p.workspaceId || payload.sessionId === p.sessionId)
			changes.push(payload);
	});
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
			await Bun.sleep(2);
		}
		const newestFirst = children.map((c) => c.sessionId).reverse();
		const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
		expect(resources.subagents.map((s) => s.childSessionId)).toEqual(newestFirst.slice(0, 20));
		expect(resources.history?.subagents).toEqual({
			done: 23,
			failed: 0,
			stopped: 0,
			interrupted: 0,
		});
		const oldestInWindow = resources.subagents.at(-1);
		if (!oldestInWindow?.finishedAt) throw new Error("missing finish time");
		const older = await getResourceHistoryPage(p.workspaceId, p.sessionId, p.cwd, {
			kind: "subagent",
			before: { at: oldestInWindow.finishedAt, id: oldestInWindow.childSessionId },
		});
		if (older.kind !== "subagent") throw new Error("wrong page kind");
		expect(older.items.map((s) => s.childSessionId)).toEqual(newestFirst.slice(20));
		expect(older.hasMore).toBe(false);
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

test("stop-all acknowledges after signalling every sibling without awaiting settlement", async () => {
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
	let acknowledged: number | undefined;
	void stopped.then((count) => {
		acknowledged = count;
	});
	try {
		await Bun.sleep(0);
		expect(acknowledged).toBe(6);
		await waitFor(async () => children.slice(4).every((c) => c.snapshot?.status === "aborted"));
		expect(children.slice(4).every((c) => c.snapshot?.details.abortReason === "user")).toBe(true);
		const summaries = (await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents;
		expect(summaries).toHaveLength(6);
		expect(summaries.every((summary) => summary.detached === undefined)).toBe(true);
	} finally {
		gate.resolve();
	}
	await stopped;
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
		expect(child).not.toHaveProperty("durationMs");
		expect(child).toMatchObject({ model: "resources/resources", thinkingLevel: "off" });
		const stopping = stopSubagent(p.workspaceId, p.sessionId, child.childSessionId, p.cwd);
		let acknowledged = false;
		void stopping.then(() => {
			acknowledged = true;
		});
		await Bun.sleep(0);
		expect(acknowledged).toBe(true);
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
		).toMatchObject({ status: "aborted", abortReason: "user", durationMs: expect.any(Number) });
	} finally {
		gate.resolve();
		setSessionPublisher(() => {});
	}
});

function recordStates(sessionId: string): { states: SessionState[]; stop: () => void } {
	const states: SessionState[] = [];
	setSessionProjectResolver(() => "resources-project");
	setSessionStatePublisher((record) => {
		if (record.sessionId === sessionId) states.push(record.state);
	});
	return {
		states,
		stop: () => {
			setSessionStatePublisher(() => {});
			setSessionProjectResolver(() => null);
		},
	};
}

test("a running background command holds the idle parent's completion unread until it stops", async () => {
	const p = await parent();
	const commandId = await launch(p);
	const recorder = recordStates(p.sessionId);
	try {
		expect(getSessionState(p.sessionId)).toMatchObject({
			execution: "idle",
			completion: { outcome: "succeeded" },
			completionUnread: false,
			backgroundWork: true,
		});
		await stopBackgroundCommand(p.workspaceId, p.sessionId, commandId, p.cwd);
		await waitFor(async () => recorder.states.at(-1)?.completionUnread === true);
		expect(getSessionState(p.sessionId)).toMatchObject({
			execution: "idle",
			completionUnread: true,
			backgroundWork: false,
		});
	} finally {
		recorder.stop();
		await removeSession(p.sessionId);
	}
});

test("a waking command completion never publishes an unread idle state before the woken turn", async () => {
	const p = await parent();
	const gate = join(p.cwd, "finish");
	await launch(p, `while ! test -f '${gate}'; do sleep 0.02; done`);
	const recorder = recordStates(p.sessionId);
	try {
		faux.setResponses([fauxAssistantMessage("WOKEN_TURN")]);
		writeFileSync(gate, "done");
		await waitFor(async () => {
			const last = recorder.states.at(-1);
			return last?.execution === "idle" && last.completionUnread;
		});
		const firstUnread = recorder.states.findIndex((state) => state.completionUnread);
		const firstRunning = recorder.states.findIndex((state) => state.execution === "running");
		expect(firstRunning).toBeGreaterThan(-1);
		expect(firstUnread).toBeGreaterThan(firstRunning);
	} finally {
		writeFileSync(gate, "done");
		recorder.stop();
		await removeSession(p.sessionId);
	}
});

test("a running detached Agent child holds the idle parent's completion unread until it ends", async () => {
	const p = await parent();
	const gate = deferred();
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
	const recorder = recordStates(p.sessionId);
	try {
		await promptSession(p.sessionId, "Delegate in the background.");
		const child = (await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents[0];
		if (!child) throw new Error("missing child");
		expect(getSessionState(p.sessionId)).toMatchObject({
			execution: "idle",
			completionUnread: false,
			backgroundWork: true,
		});
		await stopSubagent(p.workspaceId, p.sessionId, child.childSessionId, p.cwd);
		gate.resolve();
		await waitFor(async () => recorder.states.at(-1)?.completionUnread === true);
		expect(getSessionState(p.sessionId)).toMatchObject({
			execution: "idle",
			completionUnread: true,
			backgroundWork: false,
		});
	} finally {
		gate.resolve();
		recorder.stop();
	}
});

test("a non-waking command completion persists only after an unrelated parent tool result", async () => {
	const p = await parent();
	const commandId = await launch(p, "sleep 30");
	const parentGate = join(p.cwd, "parent-tool-finish");
	const parentToolStarted = deferred();
	setSessionPublisher(({ sessionId, event }) => {
		if (
			sessionId === p.sessionId &&
			event.type === "tool_execution_start" &&
			event.toolName === "bash"
		)
			parentToolStarted.resolve();
	});
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("bash", {
				command: `while ! test -f '${parentGate}'; do sleep 0.02; done`,
			}),
		),
		fauxAssistantMessage("PARENT_DONE"),
	]);
	const parentRun = promptSession(p.sessionId, "Run the gated parent tool.");
	try {
		await parentToolStarted.promise;
		await stopBackgroundCommand(p.workspaceId, p.sessionId, commandId, p.cwd);
		await waitFor(
			async () =>
				(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0]?.status ===
				"stopped",
		);
		const waiting = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		expect(waiting.summary.isStreaming).toBe(true);
		expect(
			waiting.messages.some(
				(message) =>
					message.role === "custom" && message.customType === "background-command-completion",
			),
		).toBe(false);

		writeFileSync(parentGate, "done");
		await parentRun;
		await waitFor(async () => {
			const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
			return messages.some(
				(message) =>
					message.role === "custom" && message.customType === "background-command-completion",
			);
		});
		const settled = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		const assistant = settled.messages.findLast(
			(message) =>
				message.role === "assistant" &&
				message.content.some((block) => block.type === "toolCall" && block.name === "bash"),
		);
		if (assistant?.role !== "assistant") throw new Error("missing parent tool call");
		const toolCall = assistant.content.find(
			(block) => block.type === "toolCall" && block.name === "bash",
		);
		if (toolCall?.type !== "toolCall") throw new Error("missing parent bash call");
		const resultIndex = settled.messages.findIndex(
			(message) => message.role === "toolResult" && message.toolCallId === toolCall.id,
		);
		const completionIndex = settled.messages.findIndex(
			(message) =>
				message.role === "custom" && message.customType === "background-command-completion",
		);
		expect(resultIndex).toBeGreaterThan(-1);
		expect(completionIndex).toBeGreaterThan(resultIndex);
	} finally {
		writeFileSync(parentGate, "done");
		setSessionPublisher(() => {});
		await Promise.allSettled([parentRun]);
		await removeSession(p.sessionId);
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

async function launchSubagent(p: Awaited<ReturnType<typeof parent>>, finish = deferred()) {
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
			{ childSessionId: job.child.sessionId, status: "running", detached: true },
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
			{ childSessionId: job.child.sessionId, status: "completed", durationMs: expect.any(Number) },
		]);
	} finally {
		resume.resolve();
		job.finish();
		await reloading;
		AgentSession.prototype.reload = original;
		await removeSession(p.sessionId);
	}
});

const resourceQuestion = {
	questions: [
		{
			question: "Continue after stopping the resource?",
			header: "Continue",
			options: [
				{ label: "Yes", description: "Continue the parent task" },
				{ label: "No", description: "Leave the task paused" },
			],
		},
	],
};
const resourceAnswer = {
	cancelled: false,
	answers: [
		{
			questionIndex: 0,
			question: "Continue after stopping the resource?",
			kind: "option",
			answer: "Yes",
		},
	],
};

test.each([
	"command",
	"subagent",
])("stopped %s completion waits for the live question's native turn_end, not parent settlement", async (owner) => {
	const p = await parent();
	const childGate = deferred();
	const continuationGate = deferred();
	const toolCallId = `question-before-${owner}-stop`;
	const customType = owner === "command" ? "background-command-completion" : "subagent-completion";
	let askStarted = false;
	let questionTurnEnded = false;
	let continuationCalls = 0;
	let prompting: Promise<void> | undefined;
	setSessionPublisher(({ sessionId, event }) => {
		if (sessionId !== p.sessionId) return;
		if (event.type === "tool_execution_start" && event.toolCallId === toolCallId) askStarted = true;
		if (
			event.type === "turn_end" &&
			event.toolResults.some((result) => result.toolCallId === toolCallId)
		)
			questionTurnEnded = true;
	});
	try {
		const job = owner === "subagent" ? await launchSubagent(p, childGate) : undefined;
		const commandId = owner === "command" ? await launch(p) : undefined;
		if (commandId) {
			await waitFor(async () => {
				const output = await readBackgroundCommandOutput(
					p.workspaceId,
					p.sessionId,
					commandId,
					p.cwd,
				);
				return output.available && output.output.text === "ready";
			});
		}
		const callsBeforeQuestion = faux.state.callCount;
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("ask_user_question", resourceQuestion, { id: toolCallId })),
			async () => {
				continuationCalls++;
				await continuationGate.promise;
				return fauxAssistantMessage("ANSWERED_WITH_STOPPED_RESOURCE");
			},
		]);
		prompting = promptSession(p.sessionId, "Ask before continuing.");
		prompting.catch(() => {});
		await waitFor(async () => askStarted);
		const active = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
		if (commandId) {
			expect(active.commands).toMatchObject([{ id: commandId, status: "running" }]);
			expect(
				await readBackgroundCommandOutput(p.workspaceId, p.sessionId, commandId, p.cwd),
			).toMatchObject({ available: true, output: { text: "ready" } });
			await stopBackgroundCommand(p.workspaceId, p.sessionId, commandId, p.cwd);
			await waitFor(
				async () =>
					(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0]?.status ===
					"stopped",
			);
		} else if (job) {
			expect(active.subagents).toMatchObject([
				{ childSessionId: job.child.sessionId, status: "running" },
			]);
			const stopping = stopSubagent(p.workspaceId, p.sessionId, job.child.sessionId, p.cwd);
			childGate.resolve();
			await stopping;
			await waitFor(
				async () =>
					(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents[0]?.status ===
					"aborted",
			);
			expect(
				(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).subagents,
			).toMatchObject([
				{ childSessionId: job.child.sessionId, status: "aborted", abortReason: "user" },
			]);
			expect(readChildTranscript(p.workspaceId, p.sessionId, job.child.sessionId).status).toBe(
				"aborted",
			);
		}
		const waiting = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		expect(waiting.summary.isStreaming).toBe(true);
		expect(
			waiting.messages.filter((m) => m.role === "custom" && m.customType === customType),
		).toHaveLength(0);
		expect(
			waiting.messages.some((m) => m.role === "toolResult" && m.toolCallId === toolCallId),
		).toBe(false);
		expect(questionTurnEnded).toBe(false);
		expect(continuationCalls).toBe(0);

		await respondToTool(p.sessionId, toolCallId, resourceAnswer);
		await waitFor(async () => continuationCalls === 1);
		const answered = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		expect(questionTurnEnded).toBe(true);
		expect(answered.summary.isStreaming).toBe(true);
		expect(
			answered.messages.filter((m) => m.role === "custom" && m.customType === customType),
		).toHaveLength(1);
		const resultIndex = answered.messages.findIndex(
			(m) => m.role === "toolResult" && m.toolCallId === toolCallId,
		);
		expect(answered.messages[resultIndex]).toMatchObject({
			role: "toolResult",
			details: resourceAnswer,
			isError: false,
		});
		expect(
			answered.messages.findIndex((m) => m.role === "custom" && m.customType === customType),
		).toBeGreaterThan(resultIndex);
		continuationGate.resolve();
		await prompting;
		const settled = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		expect(settled.summary.isStreaming).toBe(false);
		expect(
			settled.messages.filter((m) => m.role === "custom" && m.customType === customType),
		).toHaveLength(1);
		expect(continuationCalls).toBe(1);
		expect(faux.state.callCount).toBe(callsBeforeQuestion + 2);
		expect(settled.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "ANSWERED_WITH_STOPPED_RESOURCE" }],
			stopReason: "stop",
		});
	} finally {
		childGate.resolve();
		continuationGate.resolve();
		setSessionPublisher(() => {});
		await removeSession(p.sessionId);
		await prompting?.catch(() => {});
	}
});

test("stopped command completion cannot strand a live question across polite shutdown and disk reopen", async () => {
	let p: Awaited<ReturnType<typeof parent>>;
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	try {
		p = await parent();
	} finally {
		setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	}
	const toolCallId = "resource-question-across-restart";
	let askStarted = false;
	let prompting: Promise<void> | undefined;
	setSessionPublisher(({ sessionId, event }) => {
		if (
			sessionId === p.sessionId &&
			event.type === "tool_execution_start" &&
			event.toolCallId === toolCallId
		)
			askStarted = true;
	});
	try {
		const id = await launch(p);
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("ask_user_question", resourceQuestion, { id: toolCallId })),
		]);
		prompting = promptSession(p.sessionId, "Ask and wait through restart.");
		prompting.catch(() => {});
		await waitFor(async () => askStarted);
		expect((await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands).toMatchObject([
			{ id, status: "running" },
		]);
		await stopBackgroundCommand(p.workspaceId, p.sessionId, id, p.cwd);
		await waitFor(
			async () =>
				(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).commands[0]?.status ===
				"stopped",
		);
		const waiting = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		expect(waiting.summary.isStreaming).toBe(true);
		expect(
			waiting.messages.some(
				(m) => m.role === "custom" && m.customType === "background-command-completion",
			),
		).toBe(false);
		const path = (await SessionManager.list(p.cwd)).find((row) => row.id === p.sessionId)?.path;
		if (!path) throw new Error("missing persisted parent transcript");
		await settleSessionsForShutdown(1000);
		expect((await getSessionMessages(p.sessionId, p.workspaceId, p.cwd)).summary.isStreaming).toBe(
			true,
		);
		await expect(getSessionResources(p.workspaceId, p.sessionId, p.cwd)).rejects.toMatchObject({
			code: "RESOURCE_UNAVAILABLE",
		});
		disposeAllSessions();
		await prompting;
		expect(hasSession(p.sessionId)).toBe(false);
		const persisted = SessionManager.open(path).buildSessionContext().messages;
		expect(persisted.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ type: "toolCall", name: "ask_user_question", id: toolCallId }],
		});
		expect(persisted.some((m) => m.role === "toolResult" && m.toolCallId === toolCallId)).toBe(
			false,
		);
		expect(readFileSync(path, "utf8")).not.toContain(
			'"customType":"background-command-completion"',
		);

		const reopened = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		expect(reopened.summary.isStreaming).toBe(false);
		const ack = reopened.messages.filter(
			(m) => m.role === "toolResult" && m.toolCallId === toolCallId,
		);
		expect(ack).toMatchObject([
			{
				toolName: "ask_user_question",
				content: [{ type: "text", text: TOOL_RESPONSE_PENDING_TEXT }],
				details: { kind: "ack" },
				isError: false,
			},
		]);
		expect(
			assessRespondability(
				reopened.messages,
				toolCallId,
				interactiveTools(() => false),
			).ok,
		).toBe(true);
		expect(SessionManager.open(path).buildSessionContext().messages.at(-1)).toEqual(ack[0]);
		const reopenedResources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
		expect(reopenedResources.commands).toMatchObject([{ id, status: "stopped" }]);
		expect(reopenedResources.commands[0]?.interrupted).toBeUndefined();
		faux.setResponses([fauxAssistantMessage("RESOURCE_QUESTION_RESTART_ANSWERED")]);
		await respondToTool(p.sessionId, toolCallId, resourceAnswer);
		const answered = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		expect(answered.summary.isStreaming).toBe(false);
		expect(answered.messages.filter((m) => m.role === "custom")).toMatchObject([
			{
				customType: "tool-response",
				details: { toolCallId, response: resourceAnswer },
			},
		]);
		expect(JSON.stringify(answered.messages)).toContain("RESOURCE_QUESTION_RESTART_ANSWERED");
		expect(
			assessRespondability(
				answered.messages,
				toolCallId,
				interactiveTools(() => false),
			),
		).toEqual({
			ok: false,
			reason: "already_responded",
		});
	} finally {
		setSessionPublisher(() => {});
		setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
		if (hasSession(p.sessionId)) await removeSession(p.sessionId);
		await prompting?.catch(() => {});
	}
});

test("a command that finishes during an idle manual compaction is reported once it ends", async () => {
	const workspaceId = `resources-${++sequence}`;
	const cwd = mkdtempSync(join(root, "compact-"));
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 4096 } }),
	);
	const p = { workspaceId, cwd, ...(await createSession({ workspaceId, cwd })) };
	const gate = join(cwd, "finish");
	await launch(p, `while ! test -f '${gate}'; do sleep 0.02; done; printf COMPACTED_COMMAND`);
	faux.setResponses([fauxAssistantMessage("SEED_ANSWER")]);
	await promptSession(p.sessionId, "Seed some context to compact.");
	const summaryGate = deferred();
	const summaryStarted = deferred();
	let wokeWithReport = false;
	const summaryOrWake = (context: { messages: unknown[] }) => {
		const text = JSON.stringify(context.messages);
		if (text.includes("context summarization assistant"))
			return fauxAssistantMessage("COMPACTION_SUMMARY");
		wokeWithReport = text.includes("COMPACTED_COMMAND");
		return fauxAssistantMessage("AFTER_COMPACTION");
	};
	faux.setResponses([
		async () => {
			summaryStarted.resolve();
			await summaryGate.promise;
			return fauxAssistantMessage("COMPACTION_SUMMARY");
		},
		summaryOrWake,
		summaryOrWake,
	]);
	const compaction = compactSession(p.sessionId);
	await summaryStarted.promise;
	writeFileSync(gate, "done");
	await waitFor(async () => {
		const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
		return resources.commands.at(-1)?.status === "completed";
	});
	await Bun.sleep(20);
	const during = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	expect(
		during.messages.filter(
			(m) => m.role === "custom" && m.customType === "background-command-completion",
		),
	).toHaveLength(0);
	summaryGate.resolve();
	await compaction;
	await waitFor(async () => {
		const { messages, summary } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
		return !summary.isStreaming && JSON.stringify(messages).includes("AFTER_COMPACTION");
	});
	expect(wokeWithReport).toBe(true);
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	expect(
		messages.filter((m) => m.role === "custom" && m.customType === "background-command-completion"),
	).toHaveLength(1);
});
