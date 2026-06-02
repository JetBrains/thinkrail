import type { RpcClient } from "../client.ts";
import type {
  ArtifactKind,
  ArtifactReadResult,
  Ticket,
  TicketStatus,
  TicketSummary,
  TicketType,
} from "@/types/board.ts";


export function createBoardApi(client: RpcClient) {
  return {
    list: () =>
      client.request<TicketSummary[]>("board/list"),

    get: (id: string) =>
      client.request<Ticket>("board/get", { id }),

    create: (
      title: string,
      body?: string,
      type?: TicketType,
      status?: TicketStatus,
    ) =>
      client.request<Ticket>("board/create", { title, body, type, status }),

    update: (id: string, updates: {
      title?: string;
      body?: string;
      status?: TicketStatus;
      type?: TicketType;
    }) =>
      client.request<Ticket>("board/update", { id, ...updates }),

    delete: (id: string) =>
      client.request<null>("board/delete", { id }),

    reorder: (id: string, status: TicketStatus, order: number) =>
      client.request<Ticket>("board/reorder", { id, status, order }),

    linkSpec: (ticketId: string, specId: string) =>
      client.request<Ticket>("board/linkSpec", { ticketId, specId }),

    unlinkSpec: (ticketId: string, specId: string) =>
      client.request<Ticket>("board/unlinkSpec", { ticketId, specId }),

    attachSession: (ticketId: string, sessionId: string) =>
      client.request<Ticket>("board/attachSession", { ticketId, sessionId }),

    detachSession: (ticketId: string, sessionId: string) =>
      client.request<Ticket>("board/detachSession", { ticketId, sessionId }),

    setOrchestrator: (ticketId: string, sessionId: string) =>
      client.request<Ticket>("board/setOrchestrator", { ticketId, sessionId }),

    skipPhase: (ticketId: string, phase: TicketStatus) =>
      client.request<Ticket>("board/skipPhase", { ticketId, phase }),

    unskipPhase: (ticketId: string, phase: TicketStatus) =>
      client.request<Ticket>("board/unskipPhase", { ticketId, phase }),

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

    // Artifact methods
    readArtifact: (ticketId: string, kind: ArtifactKind) =>
      client.request<ArtifactReadResult>("board/readArtifact", { ticketId, kind }),

    // History (per-ticket ProposeChange log, parsed)
    getHistory: (ticketId: string) =>
      client.request<HistoryEntry[]>("board/getHistory", { ticketId }),
  };
}

export interface HistoryEntry {
  index: number;
  skill: string | null;
  filePath: string;
  specId: string | null;
  section: string | null;
  rationale: string | null;
  appliedAs: "original" | "edited";
  validation: "ok" | "warnings";
  timestamp: string;
  diff: string;
}

export type BoardApi = ReturnType<typeof createBoardApi>;
