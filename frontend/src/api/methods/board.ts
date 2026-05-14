import type { RpcClient } from "../client.ts";
import type { MetaTicket, MetaTicketSummary, MetaTicketStatus, MetaTicketType } from "@/types/board.ts";


export function createBoardApi(client: RpcClient) {
  return {
    list: () =>
      client.request<MetaTicketSummary[]>("board/list"),

    get: (id: string) =>
      client.request<MetaTicket>("board/get", { id }),

    create: (
      title: string,
      body?: string,
      type?: MetaTicketType,
      status?: MetaTicketStatus,
    ) =>
      client.request<MetaTicket>("board/create", { title, body, type, status }),

    update: (id: string, updates: {
      title?: string;
      body?: string;
      status?: MetaTicketStatus;
      type?: MetaTicketType;
    }) =>
      client.request<MetaTicket>("board/update", { id, ...updates }),

    delete: (id: string) =>
      client.request<null>("board/delete", { id }),

    reorder: (id: string, status: MetaTicketStatus, order: number) =>
      client.request<MetaTicket>("board/reorder", { id, status, order }),

    linkSpec: (ticketId: string, specId: string) =>
      client.request<MetaTicket>("board/linkSpec", { ticketId, specId }),

    unlinkSpec: (ticketId: string, specId: string) =>
      client.request<MetaTicket>("board/unlinkSpec", { ticketId, specId }),

    attachSession: (ticketId: string, sessionId: string) =>
      client.request<MetaTicket>("board/attachSession", { ticketId, sessionId }),

    detachSession: (ticketId: string, sessionId: string) =>
      client.request<MetaTicket>("board/detachSession", { ticketId, sessionId }),

    setPlanPath: (ticketId: string, planPath: string) =>
      client.request<MetaTicket>("board/setPlanPath", { ticketId, planPath }),

    setOrchestrator: (ticketId: string, sessionId: string) =>
      client.request<MetaTicket>("board/setOrchestrator", { ticketId, sessionId }),

    // Plan methods
    getPlan: (ticketId: string) =>
      client.request<Record<string, unknown> | null>("board/getPlan", { ticketId }),

    createPlan: (ticketId: string, title: string, steps: Record<string, unknown>[], verification?: Record<string, unknown>[]) =>
      client.request<Record<string, unknown>>("board/createPlan", { ticketId, title, steps, verification }),

    savePlan: (ticketId: string, plan: Record<string, unknown>) =>
      client.request<Record<string, unknown>>("board/savePlan", { ticketId, plan }),

    getPlanRaw: (ticketId: string) =>
      client.request<{ content: string }>("board/getPlanRaw", { ticketId }),

    savePlanRaw: (ticketId: string, content: string) =>
      client.request<Record<string, unknown>>("board/savePlanRaw", { ticketId, content }),

    updateStep: (ticketId: string, stepNumber: number, status: string, sessionId?: string) =>
      client.request<Record<string, unknown>>("board/updateStep", { ticketId, stepNumber, status, sessionId }),

    getNextStep: (ticketId: string) =>
      client.request<Record<string, unknown> | null>("board/getNextStep", { ticketId }),

    // Spec draft methods
    listDrafts: (ticketId: string) =>
      client.request<Record<string, unknown>[]>("board/listDrafts", { ticketId }),

    getDraftDiff: (ticketId: string, index: number) =>
      client.request<{ original: string; draft: string; path: string; operation: string; registryId: string; registryTitle: string }>(
        "board/getDraftDiff", { ticketId, index },
      ),

    applyDraft: (ticketId: string, index: number) =>
      client.request<null>("board/applyDraft", { ticketId, index }),

    applyAllDrafts: (ticketId: string) =>
      client.request<null>("board/applyAllDrafts", { ticketId }),

    discardDraft: (ticketId: string, index: number) =>
      client.request<null>("board/discardDraft", { ticketId, index }),

    discardAllDrafts: (ticketId: string) =>
      client.request<null>("board/discardAllDrafts", { ticketId }),

    // Spec patch methods (history)
    listPatches: (ticketId: string) =>
      client.request<Record<string, unknown>[]>("board/listPatches", { ticketId }),

    getPatchDiff: (ticketId: string, index: number) =>
      client.request<{ original: string; modified: string; path: string; operation: string }>(
        "board/getPatchDiff", { ticketId, index },
      ),

    revertPatch: (ticketId: string, index: number) =>
      client.request<MetaTicket>("board/revertPatch", { ticketId, index }),
  };
}

export type BoardApi = ReturnType<typeof createBoardApi>;
