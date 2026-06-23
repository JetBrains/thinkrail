import type { Project, Workspace } from "@thinkrail-pi/contracts";
import { create } from "zustand";
import type { ConnectionStatus } from "../transport";

/** An open center tab. V1 has file tabs; chat tabs (M11) join the same strip with a `kind` discriminant. */
export interface EditorTab {
	id: string; // `${workspaceId}:${path}` — stable, so re-opening a file focuses its tab
	workspaceId: string;
	path: string;
	name: string;
	content: string;
}

interface AppState {
	status: ConnectionStatus;
	protocolVersion: number | null;
	projects: Project[];
	workspaces: Record<string, Workspace[]>;
	selectedProjectId: string | null;
	activeWorkspaceId: string | null;
	openTabs: EditorTab[];
	activeTabId: string | null;
	setStatus: (status: ConnectionStatus) => void;
	setWelcome: (protocolVersion: number) => void;
	setProjects: (projects: Project[]) => void;
	setWorkspaces: (projectId: string, workspaces: Workspace[]) => void;
	selectProject: (projectId: string) => void;
	setActiveWorkspace: (id: string) => void;
	openTab: (tab: EditorTab) => void;
	closeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
	status: "connecting",
	protocolVersion: null,
	projects: [],
	workspaces: {},
	selectedProjectId: null,
	activeWorkspaceId: null,
	openTabs: [],
	activeTabId: null,
	setStatus: (status) => set({ status }),
	setWelcome: (protocolVersion) => set({ protocolVersion }),
	setProjects: (projects) => set({ projects }),
	setWorkspaces: (projectId, workspaces) =>
		set((s) => ({ workspaces: { ...s.workspaces, [projectId]: workspaces } })),
	selectProject: (selectedProjectId) => set({ selectedProjectId }),
	setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
	openTab: (tab) =>
		set((s) =>
			s.openTabs.some((t) => t.id === tab.id)
				? { activeTabId: tab.id }
				: { openTabs: [...s.openTabs, tab], activeTabId: tab.id },
		),
	closeTab: (id) =>
		set((s) => {
			const openTabs = s.openTabs.filter((t) => t.id !== id);
			const activeTabId = s.activeTabId === id ? (openTabs.at(-1)?.id ?? null) : s.activeTabId;
			return { openTabs, activeTabId };
		}),
	setActiveTab: (activeTabId) => set({ activeTabId }),
}));
