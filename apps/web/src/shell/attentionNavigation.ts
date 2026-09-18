import type { Workspace } from "@thinkrail/contracts";
import { tupleKey } from "../lib";
import { isUserNavigationEdge } from "../navigation";
import {
	type AttentionDirection,
	type AttentionSessionTarget,
	attentionSessionTargets,
	type ChatLocationRequest,
	nextAttentionSessionTarget,
	selectAttentionCenterTab,
	useAppStore,
} from "../store";
import { supportsAttentionNavigation } from "../transport";

export interface AttentionSessionNavigationOptions {
	listWorkspaces: (projectId: string) => Promise<Workspace[]>;
	onInfo: (message: string) => void;
	onError: (error: unknown) => void;
}

export interface AttentionSessionNavigation {
	next(): void;
	previous(): void;
	stop(): void;
}

type PendingNavigation = {
	target: AttentionSessionTarget;
	phase: "resolving" | "dispatching" | "opening";
	openRequest?: ChatLocationRequest;
	navTick?: number;
};

function activeChatSessionId(state: ReturnType<typeof useAppStore.getState>): string | null {
	const { activeWorkspaceId } = state;
	if (!activeWorkspaceId) return null;
	const selected = selectAttentionCenterTab(state, activeWorkspaceId);
	return selected?.kind === "chat" ? selected.sessionId : null;
}

function sameTarget(left: AttentionSessionTarget, right: AttentionSessionTarget): boolean {
	return (
		left.projectId === right.projectId &&
		left.workspaceId === right.workspaceId &&
		left.sessionId === right.sessionId &&
		left.attentionId === right.attentionId
	);
}

function targetKey(target: AttentionSessionTarget): string {
	return tupleKey(
		"attention-target",
		target.projectId,
		target.workspaceId,
		target.sessionId,
		target.attentionId,
	);
}

export function startAttentionSessionNavigation({
	listWorkspaces,
	onInfo,
	onError,
}: AttentionSessionNavigationOptions): AttentionSessionNavigation {
	let stopped = false;
	let generation = 0;
	let pending: PendingNavigation | null = null;
	let activeOpenRequest: ChatLocationRequest | null = null;
	let activeOpenTarget: AttentionSessionTarget | null = null;
	const workspaceLoads = new Map<string, Promise<Workspace[]>>();

	const clearOwnedOpen = (): void => {
		const request = activeOpenRequest;
		activeOpenRequest = null;
		activeOpenTarget = null;
		if (request && useAppStore.getState().chatLocationRequest === request) {
			useAppStore.getState().clearChatLocation();
		}
	};

	const cancel = (): void => {
		generation += 1;
		pending = null;
		clearOwnedOpen();
	};

	const loadProjectWorkspaces = (projectId: string): Promise<Workspace[]> => {
		const existing = workspaceLoads.get(projectId);
		if (existing) return existing;
		const request = listWorkspaces(projectId).finally(() => {
			if (workspaceLoads.get(projectId) === request) workspaceLoads.delete(projectId);
		});
		workspaceLoads.set(projectId, request);
		return request;
	};

	const isOwnedLanding = (state: ReturnType<typeof useAppStore.getState>): boolean =>
		activeOpenRequest !== null &&
		state.chatLocationRequest === activeOpenRequest &&
		activeOpenTarget !== null &&
		state.selectedProjectId === activeOpenTarget.projectId &&
		state.activeWorkspaceId === activeOpenTarget.workspaceId &&
		activeChatSessionId(state) === activeOpenTarget.sessionId;

	const unsubscribe = useAppStore.subscribe((state, previous) => {
		if (stopped) return;
		if (
			state.connectionGeneration !== previous.connectionGeneration ||
			state.status !== "connected" ||
			!supportsAttentionNavigation(state.protocolVersion)
		) {
			cancel();
			return;
		}

		const previousOwnedRequest = activeOpenRequest;
		if (previousOwnedRequest && state.chatLocationRequest !== previousOwnedRequest) {
			activeOpenRequest = null;
			activeOpenTarget = null;
			if (pending?.openRequest === previousOwnedRequest) pending = null;
		}
		if (!pending || pending.phase === "dispatching") return;
		if (!isUserNavigationEdge(state, previous)) return;
		if (pending.phase === "resolving" && isOwnedLanding(state)) return;
		if (
			pending.phase === "opening" &&
			pending.openRequest === state.chatLocationRequest &&
			state.selectedProjectId === pending.target.projectId &&
			state.activeWorkspaceId === pending.target.workspaceId &&
			(state.navTickByWorkspace[pending.target.workspaceId] ?? 0) === pending.navTick &&
			activeChatSessionId(state) === pending.target.sessionId
		) {
			return;
		}
		cancel();
	});

	const resolveTarget = async (
		requestGeneration: number,
		direction: AttentionDirection,
		initialTarget: AttentionSessionTarget,
	): Promise<void> => {
		const excluded = new Set<string>();
		let target = initialTarget;
		for (;;) {
			if (stopped || requestGeneration !== generation) return;
			let state = useAppStore.getState();
			let projectOpen = state.projects.some((project) => project.id === target.projectId);
			let targetWorkspace = projectOpen
				? state.workspaces[target.projectId]?.find(
						(workspace) => workspace.id === target.workspaceId,
					)
				: undefined;
			if (projectOpen && !targetWorkspace) {
				let rows: Workspace[];
				try {
					rows = await loadProjectWorkspaces(target.projectId);
				} catch (error) {
					if (!stopped && requestGeneration === generation) {
						pending = null;
						onError(error);
					}
					return;
				}
				if (stopped || requestGeneration !== generation) return;
				state = useAppStore.getState();
				projectOpen = state.projects.some((project) => project.id === target.projectId);
				if (projectOpen) state.setWorkspaces(target.projectId, rows);
				targetWorkspace = projectOpen
					? rows.find((workspace) => workspace.id === target.workspaceId)
					: undefined;
			}

			state = useAppStore.getState();
			const targets = attentionSessionTargets(state.attentionByWorkspace);
			const current = targets.find((candidate) => sameTarget(candidate, target));
			if (current && targetWorkspace) {
				pending = { target: current, phase: "dispatching" };
				state.requestChatLocation({
					kind: "open-chat",
					projectId: current.projectId,
					workspaceId: current.workspaceId,
					sessionId: current.sessionId,
				});
				if (stopped || requestGeneration !== generation) return;
				const opened = useAppStore.getState();
				const openRequest = opened.chatLocationRequest;
				if (
					openRequest?.kind !== "open-chat" ||
					openRequest.projectId !== current.projectId ||
					openRequest.workspaceId !== current.workspaceId ||
					openRequest.sessionId !== current.sessionId
				) {
					pending = null;
					return;
				}
				activeOpenRequest = openRequest;
				activeOpenTarget = current;
				pending = {
					target: current,
					phase: "opening",
					openRequest,
					navTick: opened.navTickByWorkspace[current.workspaceId] ?? 0,
				};
				return;
			}

			excluded.add(targetKey(target));
			const remaining = targets.filter((candidate) => !excluded.has(targetKey(candidate)));
			const next = nextAttentionSessionTarget(remaining, activeChatSessionId(state), direction);
			if (!next) {
				pending = null;
				onInfo("No chats need attention.");
				return;
			}
			target = next;
			pending = { target, phase: "resolving" };
		}
	};

	const move = (direction: AttentionDirection): void => {
		if (stopped) return;
		const state = useAppStore.getState();
		if (state.status !== "connected" || !supportsAttentionNavigation(state.protocolVersion)) return;
		const targets = attentionSessionTargets(state.attentionByWorkspace);
		if (targets.length === 0) {
			cancel();
			onInfo("No chats need attention.");
			return;
		}
		const pendingNavigation = pending;
		const pendingTarget = pendingNavigation
			? targets.find((target) => sameTarget(target, pendingNavigation.target))
			: undefined;
		const activeSessionId = activeChatSessionId(state);
		const target = nextAttentionSessionTarget(
			targets,
			pendingTarget?.sessionId ?? activeSessionId,
			direction,
		);
		if (!target) return;
		if (!pendingTarget && targets.length === 1 && target.sessionId === activeSessionId) {
			onInfo("This is the only chat needing attention.");
			return;
		}
		if (pendingTarget && sameTarget(pendingTarget, target) && targets.length === 1) return;

		generation += 1;
		const requestGeneration = generation;
		pending = { target, phase: "resolving" };
		void resolveTarget(requestGeneration, direction, target);
	};

	return {
		next: () => move("next"),
		previous: () => move("previous"),
		stop() {
			if (stopped) return;
			stopped = true;
			generation += 1;
			pending = null;
			workspaceLoads.clear();
			unsubscribe();
			clearOwnedOpen();
		},
	};
}
