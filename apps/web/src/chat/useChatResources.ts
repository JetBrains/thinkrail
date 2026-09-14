import {
	type BackgroundCommandOutputResult,
	type SessionResources,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ChatResourceScope,
	isActiveBackgroundCommand,
	isActiveSubagent,
	isChatResourceConnectionCurrent,
	isChatResourceScopeAlive,
	selectChatResourceAuthority,
	selectChatResourceGroups,
	selectChatResourceProjection,
	selectChatResourcesLoading,
	selectChatResourcesStale,
	selectChatResourcesVisible,
	supportsChatResources,
	useAppStore,
} from "@/store";
import { errorText, getTransport, wsErrorCode } from "@/transport";
import { type DetailPollScheduler, startDetailPolling } from "./detailPolling";

type ResourceStore = ReturnType<typeof useAppStore.getState>;

export function startChatResourceSync(
	scope: ChatResourceScope,
	deps: {
		state: () => ResourceStore;
		read: () => Promise<SessionResources>;
		subscribe: (invalidate: (scope: ChatResourceScope) => void) => () => void;
	},
) {
	const generation = deps.state().connectionGeneration;
	let active = true;
	let inFlight = false;
	const current = () =>
		active &&
		isChatResourceConnectionCurrent(deps.state(), { ...scope, connectionGeneration: generation });
	const run = async () => {
		if (inFlight || !current()) return;
		const projection = selectChatResourceProjection(deps.state(), scope);
		if (!projection) return;
		const read = { ...scope, connectionGeneration: generation, revision: projection.revision };
		inFlight = true;
		try {
			const snapshot = await deps.read();
			if (snapshot.workspaceId !== scope.workspaceId || snapshot.sessionId !== scope.sessionId) {
				throw new Error("Resource snapshot belongs to another chat.");
			}
			if (current()) deps.state().installChatResources(read, snapshot);
		} catch (error) {
			if (current()) deps.state().failChatResources(read, errorText(error));
		} finally {
			inFlight = false;
			const latest = selectChatResourceProjection(deps.state(), scope);
			if (current() && latest && latest.revision !== read.revision) void run();
		}
	};
	const refresh = () => {
		if (!current()) return;
		deps.state().invalidateChatResources(scope);
		void run();
	};
	const unsubscribe = deps.subscribe((changed) => {
		if (changed.workspaceId === scope.workspaceId && changed.sessionId === scope.sessionId)
			refresh();
	});
	refresh();
	return {
		refresh,
		dispose: () => {
			active = false;
			unsubscribe();
		},
	};
}

export type ResourceActionState = Record<string, { pending: boolean; error: string | null }>;

const EMPTY_RESOURCE_ACTIONS: ResourceActionState = {};

export function createChatResourceControls(
	scope: ChatResourceScope,
	deps: {
		state: () => ResourceStore;
		stopCommand: (id: string) => Promise<unknown>;
		stopSubagent: (id: string) => Promise<unknown>;
		stopAll: () => Promise<unknown>;
		onChange: (actions: ResourceActionState) => void;
	},
) {
	const generation = deps.state().connectionGeneration;
	let active = true;
	let actions: ResourceActionState = {};
	const current = () =>
		active &&
		isChatResourceConnectionCurrent(deps.state(), { ...scope, connectionGeneration: generation });
	const run = async (key: string, request: () => Promise<unknown>) => {
		if (!current() || !selectChatResourceAuthority(deps.state(), scope) || actions[key]?.pending)
			return;
		actions = { ...actions, [key]: { pending: true, error: null } };
		deps.onChange(actions);
		let error: string | null = null;
		try {
			await request();
		} catch (failure) {
			error = errorText(failure);
		}
		if (!current()) return;
		actions = { ...actions, [key]: { pending: false, error } };
		deps.onChange(actions);
	};
	return {
		stopCommand: (id: string) => {
			const command = selectChatResourceProjection(deps.state(), scope)?.snapshot?.commands.find(
				(item) => item.id === id,
			);
			if (command && isActiveBackgroundCommand(command))
				void run(`command:${id}`, () => deps.stopCommand(id));
		},
		stopSubagent: (id: string) => {
			const child = selectChatResourceProjection(deps.state(), scope)?.snapshot?.subagents.find(
				(item) => item.childSessionId === id,
			);
			if (child && isActiveSubagent(child) && !actions.all?.pending)
				void run(`subagent:${id}`, () => deps.stopSubagent(id));
		},
		stopAll: () => {
			if (
				Object.entries(actions).some(([key, value]) => key.startsWith("subagent:") && value.pending)
			)
				return;
			void run("all", deps.stopAll);
		},
		dispose: () => {
			active = false;
		},
	};
}

export function useChatResources(workspaceId: string, sessionId: string) {
	const scope = useMemo(() => ({ workspaceId, sessionId }), [workspaceId, sessionId]);
	const projection = useAppStore((state) => selectChatResourceProjection(state, scope));
	const visible = useAppStore((state) => selectChatResourcesVisible(state, scope));
	const loading = useAppStore((state) => selectChatResourcesLoading(state, scope));
	const stale = useAppStore((state) => selectChatResourcesStale(state, scope));
	const authoritative = useAppStore((state) => selectChatResourceAuthority(state, scope));
	const status = useAppStore((state) => state.status);
	const generation = useAppStore((state) => state.connectionGeneration);
	const welcome = useAppStore((state) => state.welcomeGeneration);
	const protocol = useAppStore((state) => state.protocolVersion);
	const alive = useAppStore((state) => isChatResourceScopeAlive(state, scope));
	const supported = supportsChatResources(protocol);
	const groups = useMemo(
		() => selectChatResourceGroups(projection?.snapshot),
		[projection?.snapshot],
	);
	const sync = useRef<ReturnType<typeof startChatResourceSync> | null>(null);
	const controls = useRef<ReturnType<typeof createChatResourceControls> | null>(null);
	const [actionState, setActionState] = useState<{
		scope: ChatResourceScope;
		generation: number;
		actions: ResourceActionState;
	} | null>(null);
	const actions =
		actionState?.scope === scope && actionState.generation === generation
			? actionState.actions
			: EMPTY_RESOURCE_ACTIONS;

	useEffect(() => {
		setActionState(null);
		if (status !== "connected" || !supported || !alive) return;
		const transport = getTransport();
		const reader = startChatResourceSync(scope, {
			state: useAppStore.getState,
			read: () => transport.request("session.resources", scope),
			subscribe: (invalidate) =>
				transport.subscribe(WS_CHANNELS.sessionResourcesChanged, (payload) =>
					invalidate(payload as ChatResourceScope),
				),
		});
		const controller = createChatResourceControls(scope, {
			state: useAppStore.getState,
			stopCommand: (commandId) =>
				transport.request("backgroundCommand.stop", { ...scope, commandId }),
			stopSubagent: (childSessionId) =>
				transport.request("subagent.stop", {
					workspaceId,
					parentSessionId: sessionId,
					childSessionId,
				}),
			stopAll: () =>
				transport.request("subagent.stopAll", { workspaceId, parentSessionId: sessionId }),
			onChange: (actions) => setActionState({ scope, generation, actions }),
		});
		sync.current = reader;
		controls.current = controller;
		return () => {
			reader.dispose();
			controller.dispose();
			sync.current = null;
			controls.current = null;
		};
	}, [scope, workspaceId, sessionId, status, supported, alive, generation, welcome]);

	return {
		visible,
		loading,
		stale,
		authoritative,
		projection,
		groups,
		actions,
		retry: useCallback(() => sync.current?.refresh(), []),
		stopCommand: useCallback((id: string) => controls.current?.stopCommand(id), []),
		stopSubagent: useCallback((id: string) => controls.current?.stopSubagent(id), []),
		stopAll: useCallback(() => controls.current?.stopAll(), []),
	};
}

export interface CommandLogState {
	result: BackgroundCommandOutputResult | null;
	error: string | null;
}

export function startCommandLogPolling(
	scope: ChatResourceScope & { commandId: string },
	deps: {
		state: () => ResourceStore;
		read: () => Promise<BackgroundCommandOutputResult>;
		onResult: (result: BackgroundCommandOutputResult) => void;
		onError: (error: string) => void;
		scheduler?: DetailPollScheduler;
	},
) {
	const connectionGeneration = deps.state().connectionGeneration;
	const current = () =>
		isChatResourceConnectionCurrent(deps.state(), { ...scope, connectionGeneration });
	return startDetailPolling({
		read: async () => {
			if (!current()) throw new Error("Resource connection changed.");
			const result = await deps.read();
			if (
				result.available &&
				(result.command.id !== scope.commandId || result.command.sessionId !== scope.sessionId)
			)
				throw new Error("Command output belongs to another resource.");
			return result;
		},
		isLive: (result) => current() && result.available && isActiveBackgroundCommand(result.command),
		isPermanentError: (error) => !current() || wsErrorCode(error) === "RESOURCE_UNAVAILABLE",
		onResult: (result) => {
			if (current()) deps.onResult(result);
		},
		onError: (error) => {
			if (!current()) return;
			if (wsErrorCode(error) === "RESOURCE_UNAVAILABLE") deps.onResult({ available: false });
			else deps.onError(errorText(error));
		},
		...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
	});
}

export function useCommandLog(workspaceId: string, sessionId: string, commandId: string | null) {
	const generation = useAppStore((state) => state.connectionGeneration);
	const ready = useAppStore(
		(state) =>
			state.status === "connected" &&
			supportsChatResources(state.protocolVersion) &&
			isChatResourceScopeAlive(state, { workspaceId, sessionId }),
	);
	const [stored, setStored] = useState<{
		key: string;
		generation: number;
		state: CommandLogState;
	} | null>(null);
	const poller = useRef<ReturnType<typeof startDetailPolling> | null>(null);
	const key = JSON.stringify([workspaceId, sessionId, commandId]);
	useEffect(() => {
		if (!commandId || !ready) return;
		const polling = startCommandLogPolling(
			{ workspaceId, sessionId, commandId },
			{
				state: useAppStore.getState,
				read: () =>
					getTransport().request("backgroundCommand.output", { workspaceId, sessionId, commandId }),
				onResult: (result) => setStored({ key, generation, state: { result, error: null } }),
				onError: (error) =>
					setStored((previous) => ({
						key,
						generation,
						state: { result: previous?.key === key ? previous.state.result : null, error },
					})),
			},
		);
		poller.current = polling;
		return () => {
			polling.dispose();
			poller.current = null;
		};
	}, [workspaceId, sessionId, commandId, ready, generation, key]);
	return {
		...(stored?.key === key ? stored.state : { result: null, error: null }),
		stale: !ready || (stored?.key === key && stored.generation !== generation),
		retry: () => poller.current?.refresh(),
	};
}
