import type { RpcClient } from "../client.ts";
import type { TrashedItem } from "@/types/trash.ts";

export function createTrashApi(client: RpcClient) {
  return {
    list: (type?: string) =>
      client.request<TrashedItem[]>("trash/list", type ? { type } : {}),

    restoreSpec: (specId: string) =>
      client.request<{ registryEntry: Record<string, unknown>; links: Record<string, unknown>[] }>(
        "trash/restoreSpec", { specId },
      ),

    purge: (type: string, id: string) =>
      client.request<null>("trash/purge", { type, id }),

    empty: (type?: string) =>
      client.request<null>("trash/empty", type ? { type } : {}),

    restoreSession: (bonsaiSid: string) =>
      client.request<null>("session/restore", { bonsaiSid }),

    // No backend RPC for ticket restore yet — stub that rejects with a message
    restoreTicket: (_ticketId: string) =>
      Promise.reject(new Error("Ticket restore not yet implemented in backend")),
  };
}

export type TrashApi = ReturnType<typeof createTrashApi>;
