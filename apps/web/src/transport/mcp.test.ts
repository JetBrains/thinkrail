import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	MCP_PROTOCOL_VERSION,
	type McpListResult,
	type McpStatusSnapshot,
	type WsMethodName,
	type WsParams,
	type WsResult,
} from "@thinkrail/contracts";
import { useAppStore } from "../store";
import {
	MCP_STARTING_POLL_MS,
	type McpWatchDeps,
	requestMcpList,
	startMcpWorkspaceWatch,
} from "./mcp";
import { WsTransport } from "./transport";
import * as wireTransport from "./wireTransport";

function harness(options: { starting: boolean; failRead?: boolean }) {
	let starting = options.starting;
	let listener: () => void = () => {};
	const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
	const reads: { resolve: () => void; reject: (error: Error) => void }[] = [];
	const results: unknown[] = [];
	const deps: McpWatchDeps = {
		read: () =>
			new Promise<void>((resolve, reject) => {
				reads.push({ resolve, reject });
			}),
		starting: () => starting,
		subscribe: (next) => {
			listener = next;
			return () => {
				listener = () => {};
			};
		},
		setTimer: (run, ms) => {
			const timer = { run, ms, cleared: false };
			timers.push(timer);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: (handle) => {
			const timer = timers[(handle as unknown as number) - 1];
			if (timer) timer.cleared = true;
		},
		onRead: (error) => results.push(error),
	};
	return {
		deps,
		timers,
		reads,
		results,
		setStarting: (value: boolean) => {
			starting = value;
			listener();
		},
		settleRead: async (fail = false) => {
			const read = reads.at(-1);
			if (fail) read?.reject(new Error("offline"));
			else read?.resolve();
			await Promise.resolve();
			await Promise.resolve();
		},
		fire: () => {
			const timer = timers.at(-1);
			if (timer && !timer.cleared) timer.run();
		},
	};
}

test("the watch reads once and polls with backoff only while a server is starting", async () => {
	const h = harness({ starting: true });
	const stop = startMcpWorkspaceWatch(h.deps);
	expect(h.reads).toHaveLength(1);
	await h.settleRead();
	expect(h.results).toEqual([null]);
	expect(h.timers.map((timer) => timer.ms)).toEqual([MCP_STARTING_POLL_MS[0]]);
	h.fire();
	expect(h.reads).toHaveLength(2);
	await h.settleRead(true);
	expect(h.results[1]).toBeInstanceOf(Error);
	expect(h.timers.map((timer) => timer.ms)).toEqual(MCP_STARTING_POLL_MS.slice(0, 2));
	h.setStarting(false);
	h.fire();
	await h.settleRead();
	expect(h.timers).toHaveLength(2);
	stop();
});

test("the poll budget is bounded and resets once nothing is starting", async () => {
	const h = harness({ starting: true });
	const stop = startMcpWorkspaceWatch(h.deps);
	await h.settleRead();
	for (let attempt = 0; attempt < MCP_STARTING_POLL_MS.length + 2; attempt++) {
		h.fire();
		await h.settleRead();
	}
	expect(h.timers.map((timer) => timer.ms)).toEqual([...MCP_STARTING_POLL_MS]);
	h.setStarting(false);
	h.setStarting(true);
	expect(h.timers.at(-1)?.ms).toBe(MCP_STARTING_POLL_MS[0]);
	stop();
	expect(h.timers.at(-1)?.cleared).toBe(true);
});

test("a quiet workspace is read once, and a disposed watch reports nothing", async () => {
	const h = harness({ starting: false });
	const stop = startMcpWorkspaceWatch(h.deps);
	await h.settleRead();
	expect(h.timers).toHaveLength(0);
	h.setStarting(true);
	expect(h.timers).toHaveLength(1);
	stop();
	const late = harness({ starting: true });
	const stopLate = startMcpWorkspaceWatch(late.deps);
	stopLate();
	await late.settleRead();
	expect(late.results).toEqual([]);
	expect(late.timers).toHaveLength(0);
});

const workspaceId = "mcp-ordering";
const state = useAppStore.getState;
const snapshot = (sessionId: string, workspace = workspaceId): McpStatusSnapshot => ({
	workspaceId: workspace,
	sessionId,
	generation: 1,
	servers: [{ name: "docs", state: "connected", updatedAt: 10 }],
});
const listResult = (name: string, workspace = workspaceId): McpListResult => ({
	servers: [
		{
			name,
			scope: "user",
			source: "/agent/mcp.json",
			transport: "stdio",
			endpoint: `bun ${name}.ts`,
			exposure: "deferred",
			effectiveExposure: "deferred",
			enabled: true,
			oauth: false,
		},
	],
	configErrors: [{ source: "/project/.pi/mcp.json", message: name }],
	handledElsewhere: { by: name },
	statuses: [snapshot(name, workspace)],
});

function expectInstalled(result: McpListResult, workspace = workspaceId) {
	const projection = state().mcpByWorkspace[workspace];
	expect(projection).toMatchObject({
		servers: result.servers,
		configErrors: result.configErrors ?? [],
		handledElsewhere: result.handledElsewhere ?? null,
	});
	expect(Object.values(projection?.sessions ?? {}).map((held) => held.snapshot)).toEqual(
		result.statuses,
	);
}

class DeferredTransport extends WsTransport {
	readonly requests: {
		method: WsMethodName;
		params: unknown;
		resolve: (result: McpListResult) => void;
		reject: (error: Error) => void;
	}[] = [];

	override request<M extends WsMethodName>(method: M, params: WsParams<M>): Promise<WsResult<M>> {
		return new Promise<McpListResult>((resolve, reject) => {
			this.requests.push({ method, params, resolve, reject });
		}) as Promise<WsResult<M>>;
	}

	at(index: number) {
		const request = this.requests[index];
		if (!request) throw new Error(`Request ${index} has not been dispatched`);
		return request;
	}
}

const mutations = [
	[
		"mcp.add",
		() =>
			requestMcpList("mcp.add", {
				workspaceId,
				scope: "user",
				name: "docs",
				entry: { command: "docs" },
			}),
	],
	[
		"mcp.update",
		() =>
			requestMcpList("mcp.update", {
				workspaceId,
				scope: "user",
				name: "docs",
				entry: { command: "docs" },
			}),
	],
	["mcp.remove", () => requestMcpList("mcp.remove", { workspaceId, scope: "user", name: "docs" })],
	[
		"mcp.setProjectOverride",
		() => requestMcpList("mcp.setProjectOverride", { workspaceId, name: "docs", enabled: false }),
	],
	[
		"mcp.approve",
		() => requestMcpList("mcp.approve", { workspaceId, name: "docs", fingerprint: "fingerprint" }),
	],
	["mcp.shareWithRepo", () => requestMcpList("mcp.shareWithRepo", { workspaceId, name: "docs" })],
] as const;

const remove = () => requestMcpList("mcp.remove", { workspaceId, scope: "user", name: "docs" });
const read = (workspace = workspaceId) => requestMcpList("mcp.list", { workspaceId: workspace });

describe("MCP list request ordering", () => {
	let transport: DeferredTransport;
	let restoreTransport: () => void;
	let previousState: ReturnType<typeof state>;

	beforeEach(() => {
		previousState = state();
		useAppStore.setState({
			mcpByWorkspace: {},
			mcpRevision: 0,
			removedWorkspaceIds: {},
			deletedSessionsByWorkspace: {},
			status: "connected",
			connectionGeneration: 3,
			protocolVersion: MCP_PROTOCOL_VERSION,
		});
		transport = new DeferredTransport({ url: "ws://localhost:24242/ws" });
		const spy = spyOn(wireTransport, "getTransport").mockReturnValue(transport);
		restoreTransport = () => spy.mockRestore();
	});

	afterEach(() => {
		restoreTransport();
		useAppStore.setState(previousState, true);
	});

	test.each(mutations)("a pending read installs before dispatching %s", async (method, mutate) => {
		const reading = read();
		expect(read()).toBe(reading);
		const mutation = mutate();
		expect(transport.requests.map((request) => request.method)).toEqual(["mcp.list"]);
		const old = listResult("old");
		transport.at(0).resolve(old);
		expect(await reading).toBe(old);
		expectInstalled(old);
		expect(transport.requests.map((request) => request.method)).toEqual(["mcp.list", method]);
		const updated = listResult("updated");
		transport.at(1).resolve(updated);
		expect(await mutation).toBe(updated);
		expectInstalled(updated);
	});

	test("mutations are serialized and never coalesced, even with identical parameters", async () => {
		const first = remove();
		const second = remove();
		expect(second).not.toBe(first);
		expect(transport.requests).toHaveLength(1);
		const old = listResult("old");
		transport.at(0).resolve(old);
		await first;
		expectInstalled(old);
		expect(transport.requests.map((request) => request.method)).toEqual([
			"mcp.remove",
			"mcp.remove",
		]);
		const updated = listResult("updated");
		transport.at(1).resolve(updated);
		await second;
		expectInstalled(updated);
	});

	test("reads share only the last tail, never a read preceding a queued mutation", async () => {
		const before = read();
		const firstMutation = remove();
		const between = read();
		expect(between).not.toBe(before);
		expect(read()).toBe(between);
		const secondMutation = remove();
		const after = read();
		expect(after).not.toBe(between);
		expect(read()).toBe(after);
		expect(transport.requests).toHaveLength(1);
		for (const [index, request] of [
			before,
			firstMutation,
			between,
			secondMutation,
			after,
		].entries()) {
			const result = listResult(`result-${index}`);
			transport.at(index).resolve(result);
			await request;
			expectInstalled(result);
		}
		expect(transport.requests.map((request) => request.method)).toEqual([
			"mcp.list",
			"mcp.remove",
			"mcp.list",
			"mcp.remove",
			"mcp.list",
		]);
		const next = read();
		expect(next).not.toBe(after);
		expect(transport.requests).toHaveLength(6);
		transport.at(5).resolve(listResult("next"));
		await next;
	});

	test("installation tokens are captured at dispatch, preserving only pushes during that request", async () => {
		const first = read();
		const mutation = remove();
		const last = read();
		state().applyMcpStatus(snapshot("before-mutation"));
		transport.at(0).resolve({ servers: [], statuses: [] });
		await first;
		expect(Object.keys(state().mcpByWorkspace[workspaceId]?.sessions ?? {})).toEqual([
			"before-mutation",
		]);
		state().applyMcpStatus(snapshot("during-mutation"));
		transport.at(1).resolve({ servers: [], statuses: [] });
		await mutation;
		expect(Object.keys(state().mcpByWorkspace[workspaceId]?.sessions ?? {})).toEqual([
			"during-mutation",
		]);
		state().applyMcpStatus(snapshot("during-last-read"));
		state().deleteChat(workspaceId, "deleted");
		transport.at(2).resolve({ servers: [], statuses: [snapshot("deleted")] });
		await last;
		expect(Object.keys(state().mcpByWorkspace[workspaceId]?.sessions ?? {})).toEqual([
			"during-last-read",
		]);
	});

	test("read and mutation failures reject their callers without poisoning queued work or retries", async () => {
		const first = read();
		const readError = new Error("read failed");
		const readFailed = first.catch((error: unknown) => error);
		const mutation = remove();
		const mutationError = new Error("mutation failed");
		const mutationFailed = mutation.catch((error: unknown) => error);
		const last = read();
		transport.at(0).reject(readError);
		expect(await readFailed).toBe(readError);
		expect(transport.requests).toHaveLength(2);
		transport.at(1).reject(mutationError);
		expect(await mutationFailed).toBe(mutationError);
		expect(state().mcpByWorkspace[workspaceId]).toBeUndefined();
		expect(transport.requests).toHaveLength(3);
		const recovered = listResult("recovered");
		transport.at(2).resolve(recovered);
		await last;
		expectInstalled(recovered);
		const retry = remove();
		expect(transport.requests).toHaveLength(4);
		const retried = listResult("retried");
		transport.at(3).resolve(retried);
		await retry;
		expectInstalled(retried);
	});

	test.each([
		["read", read],
		["mutation", remove],
	] as const)("a failed %s tail is cleared for an immediate retry", async (_name, start) => {
		const first = start();
		const failure = first.catch((error: unknown) => error);
		const error = new Error("retryable failure");
		transport.at(0).reject(error);
		expect(await failure).toBe(error);
		const retry = start();
		expect(retry).not.toBe(first);
		expect(transport.requests).toHaveLength(2);
		const recovered = listResult("recovered");
		transport.at(1).resolve(recovered);
		await retry;
		expectInstalled(recovered);
	});

	test.each([
		["read", read],
		["mutation", remove],
	] as const)("reconnect fences the old %s and rejects queued work without delaying new reads", async (_name, start) => {
		const old = start();
		const mutation = remove();
		const afterMutation = read();
		const failures = Promise.allSettled([mutation, afterMutation]);
		state().setStatus("disconnected");
		state().setStatus("connected");
		useAppStore.setState({ protocolVersion: MCP_PROTOCOL_VERSION });
		const fresh = read();
		expect(fresh).not.toBe(old);
		expect(transport.requests).toHaveLength(2);
		transport.at(0).resolve(listResult("obsolete"));
		await old;
		expect(await failures).toEqual([
			{
				status: "rejected",
				reason: new Error("MCP servers are unavailable until the host reconnects."),
			},
			{
				status: "rejected",
				reason: new Error("MCP servers are unavailable until the host reconnects."),
			},
		]);
		expect(state().mcpByWorkspace[workspaceId]).toBeUndefined();
		expect(transport.requests).toHaveLength(2);
		expect(read()).toBe(fresh);
		const current = listResult("current");
		transport.at(1).resolve(current);
		await fresh;
		expectInstalled(current);
	});

	test.each([
		["disconnect", () => state().setStatus("disconnected")],
		["unsupported host", () => state().installWelcomeSnapshot(MCP_PROTOCOL_VERSION - 1, [], [])],
		["workspace removal", () => state().applyWorkspaceRemoved("project", workspaceId)],
	] as const)("%s prevents queued work from dispatching and late replies from installing", async (_name, invalidate) => {
		const first = read();
		const mutation = remove();
		const afterMutation = read();
		const failures = Promise.allSettled([mutation, afterMutation]);
		invalidate();
		transport.at(0).resolve(listResult("obsolete"));
		await first;
		expect(await failures).toEqual([
			{
				status: "rejected",
				reason: new Error("MCP servers are unavailable until the host reconnects."),
			},
			{
				status: "rejected",
				reason: new Error("MCP servers are unavailable until the host reconnects."),
			},
		]);
		expect(transport.requests).toHaveLength(1);
		expect(state().mcpByWorkspace[workspaceId]).toBeUndefined();
		await expect(read()).rejects.toThrow("until the host reconnects");
		await expect(remove()).rejects.toThrow("until the host reconnects");
		expect(transport.requests).toHaveLength(1);
	});

	test("workspaces dispatch independently and install only their own results", async () => {
		const first = read();
		const queued = remove();
		const otherWorkspace = "other-workspace";
		const other = requestMcpList("mcp.remove", {
			workspaceId: otherWorkspace,
			scope: "user",
			name: "docs",
		});
		const otherRead = read(otherWorkspace);
		expect(transport.requests).toHaveLength(2);
		expect(transport.at(1).params).toEqual({
			workspaceId: otherWorkspace,
			scope: "user",
			name: "docs",
		});
		transport.at(1).resolve(listResult("other", otherWorkspace));
		await other;
		expect(transport.at(2).params).toEqual({ workspaceId: otherWorkspace });
		const otherCurrent = listResult("other-current", otherWorkspace);
		transport.at(2).resolve(otherCurrent);
		await otherRead;
		expectInstalled(otherCurrent, otherWorkspace);
		expect(state().mcpByWorkspace[workspaceId]).toBeUndefined();
		transport.at(0).resolve(listResult("first"));
		await first;
		expect(transport.at(3).params).toEqual({ workspaceId, scope: "user", name: "docs" });
		const updated = listResult("updated");
		transport.at(3).resolve(updated);
		await queued;
		expectInstalled(updated);
		expectInstalled(otherCurrent, otherWorkspace);
	});
});
