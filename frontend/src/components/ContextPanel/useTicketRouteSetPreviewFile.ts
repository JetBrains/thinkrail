import { useEffect, useRef } from "react";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import type { Ticket } from "@/types/board.ts";
import type { TicketStatus } from "@/components/TicketDetail/phases.ts";
import type { Session } from "@/types/session.ts";
import type { SelectedArtifact } from "@/components/TicketDetail/useTicketArtifacts.ts";

/** Keeps the ticket route's `selectedArtifact` in sync with the centre
 *  session as the user navigates the phase tree.
 *
 *  Two coordinated triggers, in one hook so they can't fight each other:
 *
 *  1. **previewPath change** — when the agent calls SetPreviewFile inside
 *     the centre session, the new path lands on `session.previewPath`.
 *     We map it to the canonical artifact when it matches one of the
 *     ticket's canonical paths (so the right panel uses TicketArtifactView,
 *     which tolerates missing-on-disk files), otherwise to a file entry.
 *  2. **session change with no previewPath** — when the user clicks a
 *     different phase row, `centerSessionId` (and so the centre session)
 *     changes. If the new session hasn't set a previewPath, we fall back
 *     to the canonical artifact implied by its skill so the right panel
 *     follows the active phase instead of stickying on the previous one.
 */
export function useTicketRouteSetPreviewFile(
  session: Session | null,
  ticket: Ticket | null,
) {
  const setSelectedArtifact = useTicketRouteStore((s) => s.setSelectedArtifact);
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    if (!session) return;
    const previewPath = session.previewPath;
    const key = `${session.thinkrailSid}:${previewPath ?? ""}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    if (previewPath) {
      setSelectedArtifact(mapPath(previewPath, ticket));
      return;
    }
    const skill = session.skillId;
    if (skill) {
      const phase = SKILL_TO_PHASE[skill];
      if (phase) {
        const defaultArtifact = PHASE_TO_DEFAULT[phase];
        if (defaultArtifact) { setSelectedArtifact(defaultArtifact); return; }
      }
    }
    // No preview, no skill match: fall back to the session's first artifact so
    // stage nodes whose agent never called SetPreviewFile still focus something.
    const first = session.artifacts[0];
    if (first) setSelectedArtifact(mapPath(first.path, ticket));
  }, [session, ticket, setSelectedArtifact]);
}

function mapPath(p: string, ticket: Ticket | null): SelectedArtifact {
  if (ticket) {
    if (p === ticket.productDesignPath)
      return { kind: "canonical", artifact: "product_design" };
    if (p === ticket.technicalDesignPath)
      return { kind: "canonical", artifact: "technical_design" };
    if (p === ticket.historyPath)
      return { kind: "history", phaseFilter: "amend-specs" };
    if (p === ticket.implementationPlanPath)
      return { kind: "plan" };
    // The canonical artifact may not be written yet (so the ticket's *Path
    // field is still null), but its location is predictable. Recognize it by
    // the per-ticket folder + canonical filename so the preview uses
    // TicketArtifactView (which reads via the board RPC and shows "not on disk
    // yet" gracefully) instead of a raw /api/file/read that 404s mid-write.
    if (p.includes(`tickets/${ticket.id}/`)) {
      if (p.endsWith("/product-design.md"))
        return { kind: "canonical", artifact: "product_design" };
      if (p.endsWith("/technical-design.md"))
        return { kind: "canonical", artifact: "technical_design" };
      if (p.endsWith("/history.patch"))
        return { kind: "history", phaseFilter: "amend-specs" };
      if (p.endsWith("/implementation-plan.md"))
        return { kind: "plan" };
    }
  }
  return { kind: "file", filePath: p };
}

const SKILL_TO_PHASE: Record<string, TicketStatus> = {
  "ticket-product-design": "product-design",
  "ticket-technical-design": "technical-design",
  "ticket-amend-specs": "amend-specs",
  "ticket-implementation-plan": "implementation-plan",
  "ticket-implement": "implementing",
};

const PHASE_TO_DEFAULT: Partial<Record<TicketStatus, SelectedArtifact>> = {
  "product-design": { kind: "canonical", artifact: "product_design" },
  "technical-design": { kind: "canonical", artifact: "technical_design" },
  "amend-specs": { kind: "history", phaseFilter: "amend-specs" },
  "implementation-plan": { kind: "plan" },
  implementing: { kind: "plan" },
};
