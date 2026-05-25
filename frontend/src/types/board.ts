/** Mirrors backend/app/board/models.py — JSON wire format (camelCase). */

export const META_TICKET_STATUSES = [
  "idea",
  "described",
  "specified",
  "planned",
  "executing",
  "done",
] as const;
export type MetaTicketStatus = (typeof META_TICKET_STATUSES)[number];

export const META_TICKET_TYPES = [
  "feature",
  "bug",
  "idea",
  "improvement",
] as const;
export type MetaTicketType = (typeof META_TICKET_TYPES)[number];

export interface SpecPatch {
  specId: string;
  specTitle: string;
  operation: "created" | "modified" | "deleted";
  patchPath: string;
  specPath: string;
  sessionId: string;
  created: string;
}

export interface MetaTicket {
  id: string;
  title: string;
  body: string;
  status: MetaTicketStatus;
  type: MetaTicketType;
  planPath: string | null;
  orchestratorSessionId: string | null;
  linkedSpecIds: string[];
  sessionIds: string[];
  specPatches: SpecPatch[];
  order: number;
  created: string;
  updated: string;
}

export interface MetaTicketSummary {
  id: string;
  title: string;
  status: MetaTicketStatus;
  type: MetaTicketType;
  planPath: string | null;
  orchestratorSessionId: string | null;
  linkedSpecIds: string[];
  sessionIds: string[];
  specPatchCount?: number;
  order: number;
  created: string;
  updated: string;
}
