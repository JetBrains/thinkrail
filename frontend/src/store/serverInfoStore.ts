import { create } from "zustand";
import { getServerInfo } from "@/services/serverInfo.ts";
import type { ServerInfo } from "@/services/serverInfo.ts";

export type { ServerInfo };

interface ServerInfoStore {
  info: ServerInfo | null;
  fetchInfo: () => Promise<void>;
}

export const useServerInfoStore = create<ServerInfoStore>((set) => ({
  info: null,

  fetchInfo: async () => {
    try {
      const data = await getServerInfo();
      set({ info: data });
    } catch {
      // Server info is best-effort
    }
  },
}));
