import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetaTicket } from "@/types/board.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { DEFAULT_MODEL } from "@/utils/models.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import type { ChatStreamHandle } from "@/components/ChatStream/ChatStream.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import { SessionStatusLine } from "@/components/ChatStream/SessionStatusLine.tsx";
import { StickyContextBar } from "@/components/SessionPanel/StickyContextBar.tsx";
import { useMessageHistoryStore } from "@/store/messageHistoryStore";
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
  const endSession = useSessionStore((s) => s.endSession);
  const closeSession = useSessionStore((s) => s.closeSession);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const restartSession = useSessionStore((s) => s.restartSession);
  const projectCost = useSessionStore((s) => s.projectCost);
  const [starting, setStarting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [contextCardVisible, setContextCardVisible] = useState(true);
  const chatStreamRef = useRef<ChatStreamHandle>(null);

  const session = embeddedSid ? sessions.get(embeddedSid) : null;
  const phase = useMemo(() => getPhaseConfig(ticket), [ticket]);

  // Auto-restore session from disk if embeddedSid is set but session isn't in store
  useEffect(() => {
    if (embeddedSid && !session && !restoring) {
      setRestoring(true);
      restoreSession(embeddedSid, { noTab: true })
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
      useMessageHistoryStore.getState().addMessage(text);
    },
    [embeddedSid, session, resolveRequest, sendMessage],
  );

  const handleContinue = useCallback(() => {
    if (!embeddedSid || !session) return;
    if (session.pendingRequest?.type === "question") {
      resolveRequest(embeddedSid, session.pendingRequest.requestId, { text: "continue" });
      return;
    }
    if (session.status === "initializing" || session.status === "idle" || session.status === "interrupted") {
      sendMessage(embeddedSid, "continue");
    }
  }, [embeddedSid, session, resolveRequest, sendMessage]);

  const handleStartSession = useCallback(() => {
    if (!embeddedSid || !session) return;
    if (session.status === "initializing" || session.status === "idle") {
      sendMessage(embeddedSid, "start");
    }
  }, [embeddedSid, session, sendMessage]);

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

  const isDraft = status === "draft";
  const inputDisabled = isDone || isRunning || (hasPending && session.pendingRequest?.type === "approval");
  const showContinue = !inputDisabled && !canInterrupt && !isDraft && (session.events.length ?? 0) > 0;
  const showStartSession = !inputDisabled && !canInterrupt && !isDraft
    && (session.events.length ?? 0) === 0
    && session.skillId != null;

  return (
    <div className="ticket-session">
      <div className="ticket-session-header">
        <span className="ticket-session-title">Session: {session.name}</span>
        <span style={{ fontSize: 10, color: status === "running" ? "var(--blue)" : "var(--hint)" }}>
          {status}
        </span>
      </div>
      {!contextCardVisible && session.events.length > 0 && (
        <StickyContextBar
          skillId={session.skillId ?? undefined}
          specCount={session.specIds.length}
          model={session.model}
          permissionMode={session.permissionMode}
          onScrollToTop={() => chatStreamRef.current?.scrollToTop()}
        />
      )}
      <ChatStream
        ref={chatStreamRef}
        events={session.events}
        answeredRequests={session.answeredRequests}
        onResolveRequest={handleResolve}
        session={session}
        onContextCardVisibility={setContextCardVisible}
      />
      {!isDraft && (
        <SessionStatusLine
          model={session.model}
          permissionMode={session.permissionMode}
          effort={session.effort ?? null}
          metrics={session.metrics}
          status={status ?? "idle"}
          projectCost={projectCost}
          disabled={session.restored || isDone}
          onChangeModel={(m) => updateConfig(session.bonsaiSid, { model: m })}
          onChangePermissionMode={(m) => updateConfig(session.bonsaiSid, { permissionMode: m })}
          onChangeEffort={async (e) => {
            await updateConfig(session.bonsaiSid, { effort: e });
            await restartSession(session.bonsaiSid);
          }}
          onInterrupt={() => interruptSession(session.bonsaiSid)}
          onEndSession={() => endSession(session.bonsaiSid)}
          onBackground={() => closeSession(session.bonsaiSid)}
        />
      )}
      {session.restored || isDone ? (
        <RestoredSessionBar bonsaiSid={session.bonsaiSid} ended={isDone && !session.restored} />
      ) : (
        <InputArea
          sessionId={session.bonsaiSid}
          disabled={inputDisabled}
          placeholder={placeholder}
          onSend={handleSend}
          isRunning={isRunning}
          canInterrupt={canInterrupt}
          onInterrupt={() => interruptSession(session.bonsaiSid)}
          showContinue={showContinue}
          onContinue={handleContinue}
          showStartSession={showStartSession}
          onStartSession={handleStartSession}
          skillId={session.skillId}
        />
      )}
    </div>
  );
}

function RestoredSessionBar({ bonsaiSid, ended }: { bonsaiSid: string; ended?: boolean }) {
  const handleResume = useCallback(async () => {
    try {
      await useSessionStore.getState().continueSession(bonsaiSid);
    } catch (e) {
      console.error("Failed to resume session:", e);
    }
  }, [bonsaiSid]);

  return (
    <div className="restored-bar">
      <span className="restored-bar-text">
        {ended ? "Session ended" : "This is a restored session (read-only)"}
      </span>
      <button className="restored-bar-btn" onClick={handleResume}>
        Resume Session
      </button>
    </div>
  );
}
