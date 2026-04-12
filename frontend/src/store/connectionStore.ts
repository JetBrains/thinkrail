/**
 * Tracks connected clients for presence indicators (multi-client).
 *
 * Populated by connection/didJoin and connection/didLeave notifications,
 * with initial state fetched via connection/list RPC on connect.
 */

import { create } from "zustand";
import { getClient } from "@/api/index.ts";

export interface ConnectedClient {
  connId: string;
  userId: string;
  displayName: string;
  connectedAt: number;
}

interface ConnectionStore {
  clients: ConnectedClient[];
  /** Fetch the current connection list from the backend. */
  fetchConnections: () => Promise<void>;
  /** Handle a new client joining. */
  onClientJoin: (client: ConnectedClient) => void;
  /** Handle a client leaving. */
  onClientLeave: (connId: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  clients: [],

  fetchConnections: async () => {
    try {
      const result = await getClient().request<ConnectedClient[]>("connection/list");
      set({ clients: result });
    } catch {
      // Connection not ready yet — will be populated by events
    }
  },

  onClientJoin: (client) => {
    set((s) => {
      // Dedup by connId
      if (s.clients.some((c) => c.connId === client.connId)) return s;
      return { clients: [...s.clients, client] };
    });
  },

  onClientLeave: (connId) => {
    set((s) => ({
      clients: s.clients.filter((c) => c.connId !== connId),
    }));
  },
}));
