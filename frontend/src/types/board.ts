/** Mirrors backend/app/board/models.py — JSON wire format (camelCase). */

export const TICKET_STATUSES = [
  "idea",
  "product-design",
  "technical-design",
  "amend-specs",
  "implementation-plan",
  "implementing",
  "done",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_TYPES = [
  "feature",
  "bug",
  "idea",
  "improvement",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export type ArtifactKind = "product_design" | "technical_design" | "history" | "implementation_plan";

export interface Ticket {
  id: string;
  title: string;
  body: string;
  status: TicketStatus;
  type: TicketType;
  productDesignPath: string | null;
  technicalDesignPath: string | null;
  historyPath: string | null;
  implementationPlanPath: string | null;
  technicalDesignStale: boolean;
  historyStale: boolean;
  implementationPlanStale: boolean;
  orchestratorSessionId: string | null;
  linkedSpecIds: string[];
  sessionIds: string[];
  order: number;
  created: string;
  updated: string;
  skippedPhases: TicketStatus[];
}

export interface TicketSummary {
  id: string;
  title: string;
  status: TicketStatus;
  type: TicketType;
  productDesignPath: string | null;
  technicalDesignPath: string | null;
  historyPath: string | null;
  implementationPlanPath: string | null;
  technicalDesignStale: boolean;
  historyStale: boolean;
  implementationPlanStale: boolean;
  orchestratorSessionId: string | null;
  linkedSpecIds: string[];
  sessionIds: string[];
  order: number;
  created: string;
  updated: string;
  skippedPhases: TicketStatus[];
}

export interface ArtifactReadResult {
  content: string | null;
  stale: boolean;
  updated: string;
}
