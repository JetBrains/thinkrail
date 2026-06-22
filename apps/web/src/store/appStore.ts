import { create } from "zustand";
import type { ConnectionStatus } from "../transport";

interface AppState {
	status: ConnectionStatus;
	protocolVersion: number | null;
	setStatus: (status: ConnectionStatus) => void;
	setWelcome: (protocolVersion: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
	status: "connecting",
	protocolVersion: null,
	setStatus: (status) => set({ status }),
	setWelcome: (protocolVersion) => set({ protocolVersion }),
}));
