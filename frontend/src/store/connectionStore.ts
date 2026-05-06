/**
 * Tracks connected clients for presence indicators (multi-client).
 *
 * Populated entirely by connection/didJoin and connection/didLeave
 * notifications — there is no connection/list RPC in the single-user model.
 */

import { create } from "zustand";

export interface ConnectedClient {
  connId: string;
  userId: string;
  displayName: string;
  connectedAt: number;
}

interface ConnectionStore {
  clients: ConnectedClient[];
  /** Handle a new client joining. */
  onClientJoin: (client: ConnectedClient) => void;
  /** Handle a client leaving. */
  onClientLeave: (connId: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  clients: [],

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
