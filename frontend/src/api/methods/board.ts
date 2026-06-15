import type { RpcClient } from "../client.ts";
import type {
  ArtifactKind,
  ArtifactReadResult,
  Ticket,
  TicketSummary,
  TicketType,
} from "@/types/board.ts";
import type { TicketState } from "@/types/rpc-methods.ts";


export function createBoardApi(client: RpcClient) {
  return {
    list: () =>
      client.request<TicketSummary[]>("board/list"),

    get: (id: string) =>
      client.request<Ticket>("board/get", { id }),

    getState: (id: string) =>
      client.request<TicketState>("board/getState", { id }),

    applyOp: (ticketId: string, op: Record<string, unknown>) =>
      client.request<TicketState>("board/apply", { ticketId, op }),

    completeNode: (ticketId: string, nodeId: string) =>
      client.request<TicketState>("board/completeNode", { ticketId, nodeId }),

    refineNode: (ticketId: string, nodeId: string) =>
      client.request<TicketState>("board/refineNode", { ticketId, nodeId }),

    create: (
      title: string,
      body?: string,
      type?: TicketType,
    ) =>
      client.request<Ticket>("board/create", { title, body, type }),

    update: (id: string, updates: {
      title?: string;
      body?: string;
      type?: TicketType;
    }) =>
      client.request<Ticket>("board/update", { id, ...updates }),

    delete: (id: string) =>
      client.request<null>("board/delete", { id }),

    reorder: (id: string, order: number) =>
      client.request<Ticket>("board/reorder", { id, order }),

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

    setOrchestration: (ticketId: string, config: Record<string, unknown>) =>
      client.request<TicketState>("board/apply", { ticketId, op: { op: "setOrchestration", config } }),

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
