import type { Workspace } from "@thinkrail/contracts";
import {
	selectAttentionCenterTab,
	selectCurrentRouteChatTarget,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import type { NavigationDriver } from "./driver";
import { type NavigationLocation, parseFragment, serializeLocation } from "./location";

export interface NavigationDeps {
	driver: NavigationDriver;
	listWorkspaces: (projectId: string) => Promise<Workspace[]>;
}

export function deriveLocation(state: {
	activeWorkspaceId: string | null;
	selectedProjectId: string | null;
	workspaces: Record<string, Workspace[]>;
	layoutDocumentsByWorkspace: Parameters<
		typeof selectAttentionCenterTab
	>[0]["layoutDocumentsByWorkspace"];
	layoutAttentionByWorkspace: Parameters<
		typeof selectAttentionCenterTab
	>[0]["layoutAttentionByWorkspace"];
}): NavigationLocation | null {
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) {
		const workspace = selectWorkspaceById(state, workspaceId);
		if (!workspace) return null;
		const active = selectAttentionCenterTab(state, workspaceId);
		if (active?.kind === "chat") {
			return {
				kind: "chat",
				projectId: workspace.projectId,
				workspaceId,
				sessionId: active.sessionId,
			};
		}
		return { kind: "workspace", projectId: workspace.projectId, workspaceId };
	}
	if (state.selectedProjectId) return { kind: "project", projectId: state.selectedProjectId };
	return { kind: "main" };
}

export function startNavigation({ driver, listWorkspaces }: NavigationDeps): () => void {
	let generation = 0;
	let pending: { generation: number; location: NavigationLocation } | null = null;
	const attempting = new Set<number>();
	let lastWritten = "";

	const syncNow = () => {
		if (pending) return;
		const state = useAppStore.getState();
		if (state.routeChatTarget) return;
		const location = deriveLocation(state);
		if (!location) return;
		const fragment = serializeLocation(location);
		if (fragment === lastWritten) return;
		driver.replace(fragment);
		lastWritten = fragment;
	};

	const resolvePending = (gen: number) => {
		if (pending?.generation === gen) pending = null;
		syncNow();
	};

	const attempt = async (gen: number) => {
		if (pending?.generation !== gen || attempting.has(gen)) return;
		const location = pending.location;
		if (location.kind === "main") {
			useAppStore.getState().selectMain();
			resolvePending(gen);
			return;
		}
		const state = useAppStore.getState();
		if (state.welcomeGeneration === 0) return;
		if (!state.projects.some((p) => p.id === location.projectId)) {
			useAppStore.getState().selectMain();
			resolvePending(gen);
			return;
		}
		if (location.kind === "project") {
			useAppStore.getState().selectProject(location.projectId);
			resolvePending(gen);
			return;
		}
		attempting.add(gen);
		let rows: Workspace[];
		try {
			rows = await listWorkspaces(location.projectId);
		} catch {
			attempting.delete(gen);
			return;
		}
		attempting.delete(gen);
		if (pending?.generation !== gen) return;
		const now = useAppStore.getState();
		if (!now.projects.some((p) => p.id === location.projectId)) {
			useAppStore.getState().selectMain();
			resolvePending(gen);
			return;
		}
		now.setWorkspaces(location.projectId, rows);
		const workspace = rows.find((w) => w.id === location.workspaceId);
		if (!workspace) {
			useAppStore.getState().selectProject(location.projectId);
			resolvePending(gen);
			return;
		}
		useAppStore
			.getState()
			.activateWorkspaceFromRoute(
				workspace,
				location.kind === "chat" ? location.sessionId : undefined,
			);
		resolvePending(gen);
	};

	const acceptFragment = (fragment: string) => {
		const location = parseFragment(fragment);
		generation += 1;
		pending = { generation, location };
		useAppStore.getState().clearRouteChatTarget();
		const canonical = serializeLocation(location);
		if (canonical !== fragment) driver.replace(canonical);
		lastWritten = canonical;
		void attempt(generation);
	};

	const unsubscribeDriver = driver.onIncoming(acceptFragment);
	const unsubscribeStore = useAppStore.subscribe((state, previous) => {
		if (
			pending &&
			(state.selectedProjectId !== previous.selectedProjectId ||
				state.activeWorkspaceId !== previous.activeWorkspaceId ||
				state.navTickByWorkspace !== previous.navTickByWorkspace)
		) {
			pending = null;
		}
		if (state.welcomeGeneration !== previous.welcomeGeneration && pending) {
			void attempt(pending.generation);
		}
		if (state.routeChatTarget && !selectCurrentRouteChatTarget(state)) {
			state.clearRouteChatTarget();
			return;
		}
		syncNow();
	});

	acceptFragment(driver.read());

	return () => {
		unsubscribeDriver();
		unsubscribeStore();
		pending = null;
	};
}
