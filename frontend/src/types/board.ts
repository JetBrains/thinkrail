/** Mirrors backend/app/board/models.py — JSON wire format (camelCase). */

export type MetaTicketStatus =
  | "idea"
  | "specified"
  | "planned"
  | "executing"
  | "done";

export type MetaTicketType = "feature" | "bug" | "idea" | "improvement";

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
  created: string;
  updated: string;
}
