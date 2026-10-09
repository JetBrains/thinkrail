import type { McpListResult } from "@thinkrail/contracts";
import { type McpRead, selectMcpRead, selectMcpWorkspaceStarting, useAppStore } from "../store";
import { getTransport } from "./wireTransport";

export const MCP_STARTING_POLL_MS: readonly number[] = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000];

const inFlightLists = new Map<string, { read: McpRead; request: Promise<McpListResult> }>();

// Concurrent watchers of one workspace share a single in-flight read, so two lists started from the
// same revision can never land out of order and drop a chat the newer one installed. A read captured
// on an earlier connection is never reused: its result would be rejected at installation.
function requestMcpList(workspaceId: string): Promise<McpListResult> {
	const read = selectMcpRead(useAppStore.getState(), workspaceId);
	if (!read)
		return Promise.reject(new Error("MCP servers are unavailable until the host reconnects."));
	const pending = inFlightLists.get(workspaceId);
	if (pending && pending.read.connectionGeneration === read.connectionGeneration)
		return pending.request;
	const request: Promise<McpListResult> = getTransport()
		.request("mcp.list", { workspaceId })
		.then((result: McpListResult) => {
			useAppStore.getState().installMcpList(read, result);
			return result;
		})
		.finally(() => {
			if (inFlightLists.get(workspaceId)?.request === request) inFlightLists.delete(workspaceId);
		});
	inFlightLists.set(workspaceId, { read, request });
	return request;
}

export interface McpWatchDeps {
	read: () => Promise<unknown>;
	starting: () => boolean;
	subscribe: (listener: () => void) => () => void;
	setTimer: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
	onRead?: (error: unknown) => void;
}

export function startMcpWorkspaceWatch(deps: McpWatchDeps): () => void {
	let disposed = false;
	let reading = false;
	let attempt = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const schedule = () => {
		if (disposed || reading || timer !== null || !deps.starting()) return;
		const delay = MCP_STARTING_POLL_MS[attempt];
		if (delay === undefined) return;
		attempt += 1;
		timer = deps.setTimer(() => {
			timer = null;
			void run();
		}, delay);
	};
	const run = async () => {
		reading = true;
		let failure: unknown = null;
		try {
			await deps.read();
		} catch (error) {
			failure = error;
		}
		reading = false;
		if (disposed) return;
		deps.onRead?.(failure);
		schedule();
	};
	const unsubscribe = deps.subscribe(() => {
		if (deps.starting()) schedule();
		else attempt = 0;
	});
	void run();
	return () => {
		disposed = true;
		unsubscribe();
		if (timer !== null) deps.clearTimer(timer);
	};
}

export function watchMcpWorkspace(workspaceId: string): () => void {
	return startMcpWorkspaceWatch({
		read: () => requestMcpList(workspaceId),
		starting: () => selectMcpWorkspaceStarting(useAppStore.getState(), workspaceId),
		subscribe: (listener) => useAppStore.subscribe(listener),
		setTimer: (run, ms) => setTimeout(run, ms),
		clearTimer: (timer) => clearTimeout(timer),
	});
}
