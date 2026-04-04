import { useCallback, useEffect, useRef, useState } from "react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { DEFAULT_MODEL } from "@/utils/models.ts";
import type { MetaTicket } from "@/types/board.ts";
import { TicketInfo } from "./TicketInfo.tsx";
import { TicketSession } from "./TicketSession.tsx";
import { TicketDescriptionView } from "./TicketDescriptionView.tsx";
import { TicketSpecView } from "./TicketSpecView.tsx";
import { TicketProgressBar } from "./TicketProgressBar.tsx";
import { TicketPlanView } from "./TicketPlanView.tsx";
import { TicketSpecDiffsView } from "./TicketSpecDiffsView.tsx";
import "./MetaTicketDetail.css";

export type RightPanelContent =
  | { type: "description" }
  | { type: "spec"; specId: string; specTitle: string }
  | { type: "spec-diffs" }
  | { type: "plan" }
  | { type: "session"; sessionId: string };

interface MetaTicketDetailProps {
  ticketId: string;
}

export function MetaTicketDetail({ ticketId }: MetaTicketDetailProps) {
  const [ticket, setTicket] = useState<MetaTicket | null>(null);
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanelContent>({ type: "description" });
  const [leftWidth, setLeftWidth] = useState(280);
  const sessions = useSessionStore((s) => s.sessions);

  useEffect(() => {
    const api = createBoardApi(getClient());
    api
      .get(ticketId)
      .then((t) => {
        setTicket(t);
        // Auto-select right panel based on ticket state
        let defaultPanel: RightPanelContent = { type: "description" };
        // Check for active sessions
        for (let i = t.sessionIds.length - 1; i >= 0; i--) {
          if (sessions.has(t.sessionIds[i])) {
            defaultPanel = { type: "session", sessionId: t.sessionIds[i] };
            break;
          }
        }
        // If ticket has plan and no active session, show plan
        if (defaultPanel.type === "description" && t.planPath) {
          defaultPanel = { type: "plan" };
        }
        setRightPanel(defaultPanel);
        // Fetch plan if ticket has one
        if (t.planPath) {
          lastPlanPath.current = t.planPath;
          api.getPlan(ticketId).then(setPlan).catch(() => {});
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch full ticket (and plan) when boardStore summary changes (e.g., agent direct-apply)
  const boardSummary = useBoardStore((s) => s.tickets.get(ticketId));
  const lastUpdated = useRef(boardSummary?.updated);
  const lastPlanPath = useRef<string | null>(null);
  useEffect(() => {
    if (!boardSummary || boardSummary.updated === lastUpdated.current) return;
    lastUpdated.current = boardSummary.updated;
    const api = createBoardApi(getClient());
    api.get(ticketId).then((t) => {
      setTicket(t);
      // Re-fetch plan when planPath changes (e.g., after ticket-plan session)
      if (t.planPath && t.planPath !== lastPlanPath.current) {
        lastPlanPath.current = t.planPath;
        api.getPlan(ticketId).then((p) => {
          setPlan(p);
          // Auto-switch to plan view when plan first appears
          setRightPanel((prev) => prev.type === "description" ? { type: "plan" } : prev);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, [boardSummary?.updated, ticketId]);

  // Resize handler
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftWidth;

      const handleMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setLeftWidth(Math.max(200, Math.min(startWidth + delta, window.innerWidth * 0.5)));
      };
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [leftWidth],
  );

  const handleSessionStarted = useCallback((sid: string) => {
    setRightPanel({ type: "session", sessionId: sid });
  }, []);

  const createDraft = useSessionStore((s) => s.createDraft);

  const handleStartSession = useCallback(async (skillId: string) => {
    if (!ticket) return;
    const isExecute = skillId === "ticket-execute";
    const sid = await createDraft({
      specIds: isExecute ? ticket.linkedSpecIds : [],
      config: {
        model: DEFAULT_MODEL,
        maxTurns: isExecute ? 100 : 50,
        permissionMode: "default",
        streamText: true,
        betas: [],
        effort: null,
      },
      name: isExecute ? `Execute: ${ticket.title}` : `${skillId.replace("ticket-", "")}: ${ticket.title}`,
      skillId,
      metaTicketId: ticket.id,
    });
    setRightPanel({ type: "session", sessionId: sid });
  }, [ticket, createDraft]);

  if (error) {
    return <div className="center-placeholder">Error loading ticket: {error}</div>;
  }
  if (!ticket) {
    return <div className="center-placeholder">Loading ticket...</div>;
  }

  // Get the embedded session ID (if right panel is showing a session)
  const embeddedSid = rightPanel.type === "session" ? rightPanel.sessionId : null;

  return (
    <div className="ticket-detail">
      {/* Left sidebar */}
      <div className="ticket-info" style={{ width: leftWidth, flex: `0 0 ${leftWidth}px` }}>
        <TicketInfo
          ticket={ticket}
          plan={plan}
          onTicketUpdated={setTicket}
          rightPanel={rightPanel}
          onSelectPanel={setRightPanel}
        />
      </div>

      {/* Resize handle */}
      <div className="ticket-detail-resize" onMouseDown={handleResizeMouseDown}>
        <div className="ticket-detail-resize-grip" />
      </div>

      {/* Right content area */}
      <div className="ticket-right-area">
        <TicketProgressBar
          ticket={ticket}
          onStartSession={handleStartSession}
          onSelectPanel={setRightPanel}
        />
        {rightPanel.type === "description" && (
          <TicketDescriptionView ticket={ticket} onTicketUpdated={setTicket} />
        )}
        {rightPanel.type === "spec" && (
          <TicketSpecView
            specId={rightPanel.specId}
            specTitle={rightPanel.specTitle}
            ticketId={ticketId}
            ticket={ticket}
          />
        )}
        {rightPanel.type === "spec-diffs" && (
          <TicketSpecDiffsView
            ticketId={ticketId}
            ticket={ticket}
            onTicketUpdated={setTicket}
          />
        )}
        {rightPanel.type === "plan" && (
          <TicketPlanView
            plan={plan}
            ticketId={ticketId}
            onPlanUpdated={setPlan}
          />
        )}
        {rightPanel.type === "session" && (
          <TicketSession
            ticket={ticket}
            embeddedSid={embeddedSid}
            onSessionStarted={handleSessionStarted}
          />
        )}
      </div>
    </div>
  );
}
