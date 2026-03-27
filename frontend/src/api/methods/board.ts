import type { RpcClient } from "../client.ts";
import type { MetaTicket, MetaTicketSummary, MetaTicketStatus, MetaTicketType } from "@/types/board.ts";

export function createBoardApi(client: RpcClient) {
  return {
    list: () =>
      client.request<MetaTicketSummary[]>("board/list"),

    get: (id: string) =>
      client.request<MetaTicket>("board/get", { id }),

    create: (title: string, body?: string, type?: MetaTicketType) =>
      client.request<MetaTicket>("board/create", { title, body, type }),

    update: (id: string, updates: {
      title?: string;
      body?: string;
      status?: MetaTicketStatus;
      type?: MetaTicketType;
    }) =>
      client.request<MetaTicket>("board/update", { id, ...updates }),

    delete: (id: string) =>
      client.request<null>("board/delete", { id }),

    linkSpec: (ticketId: string, specId: string) =>
      client.request<MetaTicket>("board/linkSpec", { ticketId, specId }),

    unlinkSpec: (ticketId: string, specId: string) =>
      client.request<MetaTicket>("board/unlinkSpec", { ticketId, specId }),

    attachSession: (ticketId: string, sessionId: string) =>
      client.request<MetaTicket>("board/attachSession", { ticketId, sessionId }),

    setPlanPath: (ticketId: string, planPath: string) =>
      client.request<MetaTicket>("board/setPlanPath", { ticketId, planPath }),

    setOrchestrator: (ticketId: string, sessionId: string) =>
      client.request<MetaTicket>("board/setOrchestrator", { ticketId, sessionId }),

    // Plan methods
    getPlan: (ticketId: string) =>
      client.request<Record<string, unknown> | null>("board/getPlan", { ticketId }),

    createPlan: (ticketId: string, title: string, steps: Record<string, unknown>[], verification?: Record<string, unknown>[]) =>
      client.request<Record<string, unknown>>("board/createPlan", { ticketId, title, steps, verification }),

    updateStep: (ticketId: string, stepNumber: number, status: string, sessionId?: string) =>
      client.request<Record<string, unknown>>("board/updateStep", { ticketId, stepNumber, status, sessionId }),

    getNextStep: (ticketId: string) =>
      client.request<Record<string, unknown> | null>("board/getNextStep", { ticketId }),
  };
}

export type BoardApi = ReturnType<typeof createBoardApi>;
