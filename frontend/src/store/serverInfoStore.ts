import { create } from "zustand";

export interface TailscaleInfo {
  ip: string | null;
  hostname: string | null;
  active: boolean;
}

export interface ServerInfo {
  hostname: string;
  lanIps: string[];
  tailscale: TailscaleInfo;
  version: string;
}

interface ServerInfoStore {
  info: ServerInfo | null;
  fetchInfo: () => Promise<void>;
}

export const useServerInfoStore = create<ServerInfoStore>((set) => ({
  info: null,

  fetchInfo: async () => {
    try {
      const res = await fetch("/api/server-info");
      if (!res.ok) return;
      const data: ServerInfo = await res.json();
      set({ info: data });
    } catch {
      // Server info is best-effort
    }
  },
}));
