import type { Project } from "@thinkrail-pi/contracts";
import { create } from "zustand";
import type { ConnectionStatus } from "../transport";

interface AppState {
	status: ConnectionStatus;
	protocolVersion: number | null;
	projects: Project[];
	setStatus: (status: ConnectionStatus) => void;
	setWelcome: (protocolVersion: number) => void;
	setProjects: (projects: Project[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
	status: "connecting",
	protocolVersion: null,
	projects: [],
	setStatus: (status) => set({ status }),
	setWelcome: (protocolVersion) => set({ protocolVersion }),
	setProjects: (projects) => set({ projects }),
}));
