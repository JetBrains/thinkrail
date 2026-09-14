import { beforeEach, expect, test } from "bun:test";
import {
	type BackgroundCommandOutputResult,
	CHAT_RESOURCES_PROTOCOL_VERSION,
	type SessionResources,
} from "@thinkrail/contracts";
import { type ChatResourceScope, selectChatResourceProjection, useAppStore } from "@/store";
import { RequestError } from "@/transport";
import type { DetailPollScheduler } from "./detailPolling";
import {
	createChatResourceControls,
	type ResourceActionState,
	startChatResourceSync,
	startCommandLogPolling,
} from "./useChatResources";

const scope = { workspaceId: "w-resource", sessionId: "s-resource" };
const snapshot: SessionResources = {
	...scope,
	commands: [
		{
			id: "cmd",
			sessionId: scope.sessionId,
			name: "build",
			command: "bun run build",
			status: "running",
			startedAt: 1,
		},
	],
	subagents: [
		{
			childSessionId: "child",
			parentSessionId: scope.sessionId,
			task: "inspect",
			status: "queued",
			createdAt: "2026-01-01",
		},
	],
};
const state = useAppStore.getState;
const projection = () => selectChatResourceProjection(state(), scope);
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	useAppStore.setState({
		status: "connected",
		connectionGeneration: 10,
		protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION,
		resourceSnapshots: {},
		resourceRevision: 0,
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
	});
});

function syncFixture() {
	const reads: ReturnType<typeof deferred<SessionResources>>[] = [];
	let invalidate: (scope: ChatResourceScope) => void = () => {};
	let unsubscribed = false;
	const sync = startChatResourceSync(scope, {
		state,
		read: () => {
			const read = deferred<SessionResources>();
			reads.push(read);
			return read.promise;
		},
		subscribe: (listener) => {
			invalidate = listener;
			return () => {
				unsubscribed = true;
			};
		},
	});
	return {
		reads,
		sync,
		invalidate: (changed = scope) => invalidate(changed),
		unsubscribed: () => unsubscribed,
	};
}

test("mount hydration and scoped invalidations coalesce behind one read, rejecting its obsolete result", async () => {
	const f = syncFixture();
	expect(f.reads).toHaveLength(1);
	f.invalidate({ ...scope, sessionId: "other" });
	f.invalidate({ ...scope, workspaceId: "other" });
	expect(projection()?.revision).toBe(1);
	f.invalidate();
	f.invalidate();
	expect(f.reads).toHaveLength(1);
	f.reads[0]?.resolve(snapshot);
	await flush();
	expect(projection()?.snapshot).toBeNull();
	expect(f.reads).toHaveLength(2);
	f.invalidate();
	f.reads[1]?.resolve({ ...snapshot, commands: [] });
	await flush();
	expect(projection()?.snapshot).toBeNull();
	expect(f.reads).toHaveLength(3);
	f.reads[2]?.resolve(snapshot);
	await flush();
	expect(projection()).toMatchObject({ snapshot, fresh: true });
	f.sync.dispose();
	expect(f.unsubscribed()).toBe(true);
});

test("dirty invalidations survive a rejected in-flight read and failed refreshes retain stale data", async () => {
	const f = syncFixture();
	f.invalidate();
	f.reads[0]?.reject(new Error("obsolete"));
	await flush();
	expect(projection()?.error).toBeNull();
	expect(f.reads).toHaveLength(2);
	f.reads[1]?.resolve(snapshot);
	await flush();
	f.invalidate();
	f.reads[2]?.reject(new Error("offline"));
	await flush();
	expect(projection()).toMatchObject({ snapshot, fresh: false, error: "offline" });
	f.sync.refresh();
	f.reads[3]?.resolve(snapshot);
	await flush();
	expect(projection()).toMatchObject({ fresh: true, error: null });
	f.sync.dispose();
});

test("disposed views, generations, unsupported welcomes, cleared entries and tombstones reject late reads", async () => {
	for (const retire of [
		(f: ReturnType<typeof syncFixture>) => f.sync.dispose(),
		() => {
			state().setStatus("disconnected");
			state().setStatus("connected");
			state().installWelcomeSnapshot(CHAT_RESOURCES_PROTOCOL_VERSION, [], []);
		},
		() => state().installWelcomeSnapshot(CHAT_RESOURCES_PROTOCOL_VERSION - 1, [], []),
		() => state().clearChatResources(scope),
		() => state().deleteChat(scope.workspaceId, scope.sessionId),
		() => state().applyWorkspaceRemoved("p", scope.workspaceId),
	]) {
		useAppStore.setState({
			status: "connected",
			protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION,
			resourceSnapshots: {},
			removedWorkspaceIds: {},
			deletedSessionsByWorkspace: {},
		});
		const f = syncFixture();
		retire(f);
		f.reads[0]?.resolve(snapshot);
		await flush();
		expect(projection()?.snapshot ?? null).toBeNull();
		f.sync.dispose();
	}
});

test("mismatched read identity is a visible error, not a catalog installation", async () => {
	const f = syncFixture();
	f.reads[0]?.resolve({ ...snapshot, workspaceId: "foreign" });
	await flush();
	expect(projection()).toMatchObject({
		snapshot: null,
		fresh: false,
		error: "Resource snapshot belongs to another chat.",
	});
	f.sync.dispose();
});

function controlsFixture() {
	state().invalidateChatResources(scope);
	state().installChatResources(
		{
			...scope,
			connectionGeneration: state().connectionGeneration,
			revision: projection()?.revision ?? -1,
		},
		snapshot,
	);
	const requests: { key: string; request: ReturnType<typeof deferred<unknown>> }[] = [];
	let actions: ResourceActionState = {};
	const request = (key: string) => {
		const pending = deferred<unknown>();
		requests.push({ key, request: pending });
		return pending.promise;
	};
	const controls = createChatResourceControls(scope, {
		state,
		stopCommand: (id) => request(`command:${id}`),
		stopSubagent: (id) => request(`subagent:${id}`),
		stopAll: () => request("all"),
		onChange: (next) => {
			actions = next;
		},
	});
	return { requests, controls, actions: () => actions };
}

test("individual controls prevent duplicates, expose row errors and never synthesize terminal state", async () => {
	const f = controlsFixture();
	f.controls.stopCommand("cmd");
	f.controls.stopCommand("cmd");
	f.controls.stopCommand("foreign");
	f.controls.stopSubagent("child");
	f.controls.stopAll();
	expect(f.requests.map((item) => item.key)).toEqual(["command:cmd", "subagent:child"]);
	f.requests[0]?.request.reject(new Error("Command cannot stop"));
	f.requests[1]?.request.resolve({ ok: true });
	await flush();
	expect(f.actions()["command:cmd"]).toEqual({ pending: false, error: "Command cannot stop" });
	expect(f.actions()["subagent:child"]).toEqual({ pending: false, error: null });
	expect(projection()?.snapshot).toBe(snapshot);
	f.controls.stopAll();
	f.controls.stopAll();
	f.controls.stopSubagent("child");
	expect(f.requests.map((item) => item.key)).toEqual(["command:cmd", "subagent:child", "all"]);
	f.requests[2]?.request.reject(new Error("Stop all failed"));
	await flush();
	expect(f.actions().all?.error).toBe("Stop all failed");
	f.controls.dispose();
});

test("stale controls do not dispatch and late acknowledgements/errors cannot affect a new owner", async () => {
	for (const retire of [
		(f: ReturnType<typeof controlsFixture>) => f.controls.dispose(),
		() => state().setStatus("disconnected"),
		() => {
			state().setStatus("connected");
			state().installWelcomeSnapshot(CHAT_RESOURCES_PROTOCOL_VERSION, [], []);
		},
		() => state().deleteChat(scope.workspaceId, scope.sessionId),
	]) {
		useAppStore.setState({
			status: "connected",
			protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION,
			removedWorkspaceIds: {},
			deletedSessionsByWorkspace: {},
		});
		const f = controlsFixture();
		f.controls.stopCommand("cmd");
		const before = f.actions();
		retire(f);
		f.controls.stopSubagent("child");
		f.requests[0]?.request.reject(new Error("late"));
		await flush();
		expect(f.requests).toHaveLength(1);
		expect(f.actions()).toBe(before);
		f.controls.dispose();
	}
});

function logFixture() {
	const reads: ReturnType<typeof deferred<BackgroundCommandOutputResult>>[] = [];
	const tasks: (() => void)[] = [];
	const scheduler: DetailPollScheduler = {
		set: (callback) => {
			tasks.push(callback);
			return callback;
		},
		clear: (callback) => {
			const index = tasks.indexOf(callback as () => void);
			if (index !== -1) tasks.splice(index, 1);
		},
	};
	let result: BackgroundCommandOutputResult | null = null;
	let error: string | null = null;
	const polling = startCommandLogPolling(
		{ ...scope, commandId: "cmd" },
		{
			state,
			read: () => {
				const read = deferred<BackgroundCommandOutputResult>();
				reads.push(read);
				return read.promise;
			},
			onResult: (next) => {
				result = next;
				error = null;
			},
			onError: (next) => {
				error = next;
			},
			scheduler,
		},
	);
	return {
		reads,
		tasks,
		polling,
		result: () => result,
		error: () => error,
		tick: () => tasks.shift()?.(),
	};
}
const output = (
	text: string,
	status: "running" | "completed" = "running",
): BackgroundCommandOutputResult => ({
	available: true,
	command: {
		id: "cmd",
		sessionId: scope.sessionId,
		name: "Build",
		command: "build",
		status,
		startedAt: 1,
	},
	output: { text, truncated: true },
});

test("log snapshots replace instead of append and terminal output stops polling", async () => {
	const f = logFixture();
	f.reads[0]?.resolve(output("old tail"));
	await flush();
	expect(f.tasks).toHaveLength(1);
	f.tick();
	f.polling.refresh();
	expect(f.reads).toHaveLength(2);
	f.reads[1]?.resolve(output("new tail", "completed"));
	await flush();
	expect(f.result()).toEqual(output("new tail", "completed"));
	expect(f.tasks).toHaveLength(0);
	f.polling.refresh();
	expect(f.reads).toHaveLength(2);
	f.polling.dispose();
});

test("log errors preserve the previous output, retry transient errors, and stop on permanent unavailable", async () => {
	const f = logFixture();
	f.reads[0]?.resolve(output("before failure"));
	await flush();
	f.tick();
	f.reads[1]?.reject(new Error("Network failed"));
	await flush();
	expect(f.result()).toEqual(output("before failure"));
	expect(f.error()).toBe("Network failed");
	expect(f.tasks).toHaveLength(1);
	f.polling.refresh();
	expect(f.tasks).toHaveLength(0);
	f.reads[2]?.reject(new RequestError("RESOURCE_UNAVAILABLE", "evicted"));
	await flush();
	expect(f.result()).toEqual({ available: false });
	expect(f.error()).toBeNull();
	expect(f.tasks).toHaveLength(0);
	f.polling.refresh();
	expect(f.reads).toHaveLength(3);
	f.polling.dispose();
});

test("unavailable output stops its loop without manufacturing empty logs", async () => {
	const f = logFixture();
	f.reads[0]?.resolve({ available: false });
	await flush();
	expect(f.result()).toEqual({ available: false });
	expect(f.tasks).toHaveLength(0);
	f.polling.dispose();
});

test("closed logs, old connections, foreign responses and removed parents cannot install output", async () => {
	for (const retire of [
		(f: ReturnType<typeof logFixture>) => f.polling.dispose(),
		() => state().setStatus("disconnected"),
		() => {
			state().setStatus("connected");
			state().installWelcomeSnapshot(CHAT_RESOURCES_PROTOCOL_VERSION, [], []);
		},
		() => state().deleteChat(scope.workspaceId, scope.sessionId),
		() => state().applyWorkspaceRemoved("p", scope.workspaceId),
	]) {
		useAppStore.setState({
			status: "connected",
			protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION,
			removedWorkspaceIds: {},
			deletedSessionsByWorkspace: {},
		});
		const f = logFixture();
		retire(f);
		f.reads[0]?.resolve(output("late"));
		await flush();
		expect(f.result()).toBeNull();
		expect(f.tasks).toHaveLength(0);
		f.polling.dispose();
	}
	useAppStore.setState({
		status: "connected",
		protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION,
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
	});
	const f = logFixture();
	const foreign = output("foreign");
	if (foreign.available) foreign.command.id = "foreign";
	f.reads[0]?.resolve(foreign);
	await flush();
	expect(f.result()).toBeNull();
	expect(f.error()).toBe("Command output belongs to another resource.");
	f.polling.dispose();
});
