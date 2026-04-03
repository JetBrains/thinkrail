import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetaTicket } from "@/types/board.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { DEFAULT_MODEL } from "@/utils/models.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import type { SessionStatus } from "@/types/session.ts";

interface TicketSessionProps {
  ticket: MetaTicket;
  embeddedSid: string | null;
  onSessionStarted: (sid: string) => void;
}

/** Determine which skill and label to use based on ticket state. */
function getPhaseConfig(ticket: MetaTicket): { skillId: string; label: string; description: string } {
  switch (ticket.status) {
    case "planned":
    case "executing":
      return {
        skillId: "ticket-execute",
        label: "Execute",
        description: "Plan is ready. Start executing to run the steps.",
      };
    case "specified":
      return {
        skillId: "ticket-plan",
        label: "Plan with AI",
        description: "Specifications are ready. Create an implementation plan.",
      };
    case "described":
      return {
        skillId: "ticket-specify",
        label: "Specify with AI",
        description: "Description is ready. Create specifications for the changes.",
      };
    default:
      return {
        skillId: "ticket-describe",
        label: "Describe with AI",
        description: "Start by formulating a clear, structured description.",
      };
  }
}

export function TicketSession({ ticket, embeddedSid, onSessionStarted }: TicketSessionProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const startSession = useSessionStore((s) => s.startSession);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interruptSession = useSessionStore((s) => s.interruptSession);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);
  const [starting, setStarting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const session = embeddedSid ? sessions.get(embeddedSid) : null;
  const phase = useMemo(() => getPhaseConfig(ticket), [ticket]);

  // Auto-restore session from disk if embeddedSid is set but session isn't in store
  useEffect(() => {
    if (embeddedSid && !session && !restoring) {
      setRestoring(true);
      restoreSession(embeddedSid)
        .catch((e) => console.error("[TicketSession] Failed to restore:", e))
        .finally(() => setRestoring(false));
    }
  }, [embeddedSid, session, restoring, restoreSession]);

  const handleStart = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      const isExecute = phase.skillId === "ticket-execute";
      const sid = await startSession({
        specIds: isExecute ? ticket.linkedSpecIds : [],
        config: {
          model: DEFAULT_MODEL,
          maxTurns: isExecute ? 100 : 50,
          permissionMode: "default",
          streamText: true,
          betas: [],
          effort: null,
        },
        name: isExecute
          ? `Execute: ${ticket.title}`
          : `${phase.label}: ${ticket.title}`,
        skillId: phase.skillId,
        metaTicketId: ticket.id,
      });
      onSessionStarted(sid);
    } catch (e) {
      console.error("[TicketSession] Failed to start session:", e);
    } finally {
      setStarting(false);
    }
  }, [starting, startSession, ticket, phase, onSessionStarted]);

  const handleSend = useCallback(
    (text: string, isMarkdown?: boolean) => {
      if (!embeddedSid || !session) return;
      if (session.pendingRequest?.type === "question") {
        resolveRequest(embeddedSid, session.pendingRequest.requestId, { text });
        return;
      }
      if (session.status === "initializing" || session.status === "idle") {
        sendMessage(embeddedSid, text, isMarkdown);
      }
    },
    [embeddedSid, session, resolveRequest, sendMessage],
  );

  const handleResolve = useCallback(
    (requestId: string, response: unknown) => {
      if (!embeddedSid) return;
      resolveRequest(embeddedSid, requestId, response);
    },
    [embeddedSid, resolveRequest],
  );

  // No active session — show loading if restoring, or phase-appropriate start prompt
  if (!session) {
    return (
      <div className="ticket-session">
        <div className="ticket-session-header">
          <span className="ticket-session-title">Session</span>
        </div>
        <div className="ticket-session-empty">
          {restoring ? (
            <p>Loading session...</p>
          ) : (
            <>
              <p>{phase.description}</p>
              <button
                className="ticket-session-start-btn"
                onClick={handleStart}
                disabled={starting}
              >
                {starting ? "Starting..." : phase.label}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Active session — render embedded ChatStream + InputArea
  const status = session.status as SessionStatus;
  const hasPending = session.pendingRequest != null;
  const isDone = status === "done" || status === "error";
  const isRunning = status === "running";
  const canInterrupt = status === "running" || status === "waiting";

  const placeholder = hasPending
    ? session.pendingRequest?.type === "approval"
      ? "Waiting for your approval above..."
      : "Answer the question above..."
    : isDone
      ? "Session complete"
      : isRunning
        ? "Agent is working..."
        : "Message Claude...";

  const inputDisabled = isDone || isRunning || (hasPending && session.pendingRequest?.type === "approval");

  return (
    <div className="ticket-session">
      <div className="ticket-session-header">
        <span className="ticket-session-title">Session: {session.name}</span>
        <span style={{ fontSize: 10, color: status === "running" ? "var(--blue)" : "var(--hint)" }}>
          {status}
        </span>
      </div>
      <ChatStream
        events={session.events}
        answeredRequests={session.answeredRequests}
        onResolveRequest={handleResolve}
        session={session}
      />
      <InputArea
        sessionId={session.bonsaiSid}
        disabled={inputDisabled}
        placeholder={placeholder}
        onSend={handleSend}
        isRunning={isRunning}
        canInterrupt={canInterrupt}
        onInterrupt={() => interruptSession(session.bonsaiSid)}
      />
    </div>
  );
}
