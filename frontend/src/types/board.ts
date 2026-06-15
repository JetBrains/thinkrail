/** Mirrors backend/app/board/models.py — JSON wire format (camelCase). */

import type {
  Lifecycle,
  OrchestrationConfig,
  WorkNode,
} from "./rpc-methods.ts";

export type { Lifecycle, OrchestrationConfig, WorkNode };

export const LIFECYCLES = [
  "created",
  "design",
  "implementation",
  "done",
] as const;

export const TICKET_TYPES = [
  "feature",
  "bug",
  "idea",
  "improvement",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export type ArtifactKind = "product_design" | "technical_design" | "history" | "implementation_plan";

// Mirrors the generated OrchestratorRef in rpc-methods.ts; board.ts is the
// hand-maintained contract for the board RPCs (kept free of generated alias names).
export interface OrchestratorRef {
  kind: "session" | "builtin";
  sessionId: string | null;
  builtinId: string | null;
}

export interface Ticket {
  id: string;
  title: string;
  body: string;
  type: TicketType;
  stages: WorkNode[];
  orchestration: OrchestrationConfig;
  productDesignPath: string | null;
  technicalDesignPath: string | null;
  historyPath: string | null;
  implementationPlanPath: string | null;
  orchestrator: OrchestratorRef | null;
  linkedSpecIds: string[];
  sessionIds: string[];
  order: number;
  created: string;
  updated: string;
  rev: number;
}

export interface TicketSummary {
  id: string;
  title: string;
  type: TicketType;
  lifecycle: Lifecycle;
  productDesignPath: string | null;
  technicalDesignPath: string | null;
  historyPath: string | null;
  implementationPlanPath: string | null;
  orchestrator: OrchestratorRef | null;
  linkedSpecIds: string[];
  sessionIds: string[];
  order: number;
  created: string;
  updated: string;
  rev: number;
}

export interface ArtifactReadResult {
  content: string | null;
  updated: string;
}
