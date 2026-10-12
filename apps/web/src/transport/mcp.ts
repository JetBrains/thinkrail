import type { McpListResult, WsParams } from "@thinkrail/contracts";
import { selectMcpRead, selectMcpWorkspaceStarting, useAppStore } from "../store";
import { getTransport } from "./wireTransport";

export type McpListMethod =
	| "mcp.list"
	| "mcp.add"
	| "mcp.update"
	| "mcp.remove"
	| "mcp.setProjectOverride"
	| "mcp.approve"
	| "mcp.shareWithRepo";

export const MCP_STARTING_POLL_MS: readonly number[] = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000];

const listTails = new Map<
	string,
	{ connectionGeneration: number; method: McpListMethod; request: Promise<McpListResult> }
>();

export function requestMcpList<M extends McpListMethod>(
	method: M,
	params: WsParams<M>,
): Promise<McpListResult> {
	const { workspaceId } = params;
	const scope = selectMcpRead(useAppStore.getState(), workspaceId);
	if (!scope)
		return Promise.reject(new Error("MCP servers are unavailable until the host reconnects."));
	const { connectionGeneration } = scope;
	const tail = listTails.get(workspaceId);
	const pending = tail?.connectionGeneration === connectionGeneration ? tail : undefined;
	if (method === "mcp.list" && pending?.method === "mcp.list") return pending.request;
	const dispatch = async (): Promise<McpListResult> => {
		const read = selectMcpRead(useAppStore.getState(), workspaceId);
		if (!read || read.connectionGeneration !== connectionGeneration)
			throw new Error("MCP servers are unavailable until the host reconnects.");
		const result = await getTransport().request(method, params);
		useAppStore.getState().installMcpList(read, result);
		return result;
	};
	const request = (pending ? pending.request.then(dispatch, dispatch) : dispatch()).finally(() => {
		if (listTails.get(workspaceId)?.request === request) listTails.delete(workspaceId);
	});
	listTails.set(workspaceId, { connectionGeneration, method, request });
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

export function watchMcpWorkspace(
	workspaceId: string,
	onRead?: (error: unknown) => void,
): () => void {
	return startMcpWorkspaceWatch({
		read: () => requestMcpList("mcp.list", { workspaceId }),
		starting: () => selectMcpWorkspaceStarting(useAppStore.getState(), workspaceId),
		subscribe: (listener) => useAppStore.subscribe(listener),
		setTimer: (run, ms) => setTimeout(run, ms),
		clearTimer: (timer) => clearTimeout(timer),
		...(onRead ? { onRead } : {}),
	});
}
