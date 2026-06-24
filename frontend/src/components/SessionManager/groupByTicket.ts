import type { SessionSummary } from "@/api/methods/sessions.ts";
import { SessionStatus } from "@/constants/status.ts";

export interface TicketGroup {
  kind: "ticket";
  ticketId: string;
  sessions: SessionSummary[];
  /** Most-recent updatedAt/createdAt across the group's sessions, ISO. */
  latestActivity: string;
  /** Count of attached sessions currently `running`. */
  runningCount: number;
  /** Count of attached sessions in `waiting` or `error` status. */
  attentionCount: number;
}

export interface StandaloneEntry {
  kind: "session";
  session: SessionSummary;
  /** Same shape as TicketGroup so the renderer can sort the unioned list. */
  latestActivity: string;
}

export type GroupedEntry = TicketGroup | StandaloneEntry;

function ts(s: SessionSummary): string {
  return s.updatedAt || s.createdAt || "";
}

/** A session needs user attention when it's waiting for input or errored. */
const needsAttention = (s: SessionSummary["status"]): boolean =>
  s === SessionStatus.Waiting || s === SessionStatus.Error;

/** Aggregate sessions into ticket groups + standalone entries, ordered by
 *  recency descending. Input is expected to already be sorted by recency
 *  (we still re-sort to be defensive). */
export function groupByTicket(sessions: SessionSummary[]): GroupedEntry[] {
  // Defensive sort: caller usually pre-sorts, but ticket grouping relies
  // on "first encountered is freshest" so the order matters.
  const ordered = [...sessions].sort(
    (a, b) => (Date.parse(ts(b)) || 0) - (Date.parse(ts(a)) || 0),
  );

  const groupMap = new Map<string, TicketGroup>();
  const standalones: StandaloneEntry[] = [];
  for (const s of ordered) {
    if (s.ticketId) {
      const existing = groupMap.get(s.ticketId);
      if (existing) {
        existing.sessions.push(s);
        if (s.status === SessionStatus.Running) existing.runningCount += 1;
        if (needsAttention(s.status)) existing.attentionCount += 1;
      } else {
        groupMap.set(s.ticketId, {
          kind: "ticket",
          ticketId: s.ticketId,
          sessions: [s],
          latestActivity: ts(s),
          runningCount: s.status === SessionStatus.Running ? 1 : 0,
          attentionCount:
            needsAttention(s.status) ? 1 : 0,
        });
      }
    } else {
      standalones.push({ kind: "session", session: s, latestActivity: ts(s) });
    }
  }

  const merged: GroupedEntry[] = [
    ...Array.from(groupMap.values()),
    ...standalones,
  ];
  merged.sort(
    (a, b) => (Date.parse(b.latestActivity) || 0) - (Date.parse(a.latestActivity) || 0),
  );
  return merged;
}

/** Pick the "session of interest" for a ticket group: prefer attention-
 *  needing sessions (waiting/error), then running, then most-recent. */
export function pickFocusSession(group: TicketGroup): SessionSummary {
  const byRecency = [...group.sessions].sort(
    (a, b) => (Date.parse(ts(b)) || 0) - (Date.parse(ts(a)) || 0),
  );
  const attention = byRecency.find(
    (s) => needsAttention(s.status),
  );
  if (attention) return attention;
  const running = byRecency.find((s) => s.status === SessionStatus.Running);
  if (running) return running;
  return byRecency[0];
}
