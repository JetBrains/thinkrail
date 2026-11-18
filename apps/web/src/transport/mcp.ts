import {
	MCP_USER_SERVERS_PROTOCOL_VERSION,
	type McpListResult,
	type WsParams,
} from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { selectMcpRead, selectMcpWorkspaceStarting, useAppStore } from "../store";
import { getTransport } from "./wireTransport";

export type McpListMethod =
	| "mcp.list"
	| "mcp.add"
	| "mcp.update"
	| "mcp.remove"
	| "mcp.setProjectOverride"
	| "mcp.approve"
	| "mcp.revokeToolGrant"
	| "mcp.shareWithRepo";

export const MCP_STARTING_POLL_MS: readonly number[] = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000];

export type UserMcpListMethod =
	| "mcp.list"
	| "mcp.add"
	| "mcp.update"
	| "mcp.remove"
	| "mcp.setUserServer";

interface ListTail {
	connectionGeneration: number;
	method: McpListMethod | UserMcpListMethod;
	request: Promise<McpListResult>;
}

const listTails = new Map<string, ListTail>();
const userListTails = new Map<"user", ListTail>();

function enqueueList<K extends string>(
	tails: Map<K, ListTail>,
	key: K,
	connectionGeneration: number,
	method: ListTail["method"],
	dispatch: () => Promise<McpListResult>,
): Promise<McpListResult> {
	const tail = tails.get(key);
	const pending = tail?.connectionGeneration === connectionGeneration ? tail : undefined;
	if (method === "mcp.list" && pending?.method === "mcp.list") return pending.request;
	const request = (pending ? pending.request.then(dispatch, dispatch) : dispatch()).finally(() => {
		if (tails.get(key)?.request === request) tails.delete(key);
	});
	tails.set(key, { connectionGeneration, method, request });
	return request;
}

export function requestMcpList<M extends McpListMethod>(
	method: M,
	params: WsParams<M>,
): Promise<McpListResult> {
	const scope =
		params.workspaceId === undefined
			? null
			: selectMcpRead(useAppStore.getState(), params.workspaceId);
	if (!scope) return Promise.reject(new Error(t("app.transport.mcpUnavailable")));
	const { workspaceId, connectionGeneration } = scope;
	return enqueueList(listTails, workspaceId, connectionGeneration, method, async () => {
		const read = selectMcpRead(useAppStore.getState(), workspaceId);
		if (!read || read.connectionGeneration !== connectionGeneration)
			throw new Error(t("app.transport.mcpUnavailable"));
		const result = await getTransport().request(method, params);
		useAppStore.getState().installMcpList(read, result);
		return result;
	});
}

export function supportsUserMcp(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= MCP_USER_SERVERS_PROTOCOL_VERSION;
}

function userMcpGeneration(): number | null {
	const { status, protocolVersion, connectionGeneration } = useAppStore.getState();
	return status === "connected" && supportsUserMcp(protocolVersion) ? connectionGeneration : null;
}

export function requestUserMcpList<M extends UserMcpListMethod>(
	method: M,
	params: WsParams<M> & { workspaceId?: never },
): Promise<McpListResult> {
	const connectionGeneration = userMcpGeneration();
	if (connectionGeneration === null)
		return Promise.reject(new Error(t("app.transport.mcpUnavailable")));
	return enqueueList(userListTails, "user", connectionGeneration, method, async () => {
		if (userMcpGeneration() !== connectionGeneration)
			throw new Error(t("app.transport.mcpUnavailable"));
		return getTransport().request(method, params);
	});
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
