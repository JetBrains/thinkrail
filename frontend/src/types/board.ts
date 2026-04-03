/** Mirrors backend/app/board/models.py — JSON wire format (camelCase). */

export type MetaTicketStatus =
  | "idea"
  | "described"
  | "specified"
  | "planned"
  | "executing"
  | "done";

export type MetaTicketType = "feature" | "bug" | "idea" | "improvement";

export type SpecChangeType = "created" | "modified" | "deleted";

export interface SpecChange {
  specId: string;
  specTitle: string;
  changeType: SpecChangeType;
  summary: string;
  sectionsChanged: string[];
  detail: string;
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
  specChanges: SpecChange[];
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
  specChangeCount?: number;
  order: number;
  created: string;
  updated: string;
}
