import type { Ticket } from "@/types/board.ts";
import type { Session, ArchivedSession } from "@/types/session.ts";
import type { SessionSummary } from "@/api/methods/sessions.ts";
import { PHASE_SKILLS } from "./phases.ts";

/** The session that drives the ticket's right-panel artifact view by default:
 *  the one attached to the ticket's CURRENT phase.
 *
 *  When several sessions share that phase (orphan drafts accumulate from past
 *  auto-create races) we prefer a worked-on session over a draft, then the
 *  most recent. Live sessions lack `updatedAt`, so live entries order by
 *  `startedAt`. Returns null when the phase has no skill (idea/done) or no
 *  attached session matches. */
export function resolvePhaseDefaultSid(
  ticket: Ticket | null,
  liveSessions: Map<string, Session>,
  archivedSessions: ArchivedSession[],
  sessionSummaries: Map<string, SessionSummary>,
): string | null {
  if (!ticket) return null;
  const skill = PHASE_SKILLS[ticket.status];
  if (!skill) return null;

  const matches: { sid: string; isDraft: boolean; ts: number }[] = [];
  for (const sid of ticket.sessionIds) {
    const live = liveSessions.get(sid);
    const archived = !live ? archivedSessions.find((a) => a.thinkrailSid === sid) : null;
    const summary = !live && !archived ? sessionSummaries.get(sid) : null;
    const skillId = live?.skillId ?? archived?.skillId ?? summary?.skillId ?? null;
    if (skillId !== skill) continue;
    const status = live?.status ?? archived?.result ?? summary?.status ?? "draft";
    const ts =
      live?.startedAt ??
      archived?.endedAt ??
      (summary?.updatedAt ? Date.parse(summary.updatedAt) : 0);
    matches.push({ sid, isDraft: status === "draft", ts: ts || 0 });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.isDraft !== b.isDraft) return a.isDraft ? 1 : -1;
    return b.ts - a.ts;
  });
  return matches[0].sid;
}
