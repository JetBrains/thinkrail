import { useCallback } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import { SessionStatusLine } from "@/components/ChatStream/SessionStatusLine.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import { SessionTabBar } from "./SessionTabBar.tsx";

export function SessionPanel() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const switchSession = useSessionStore((s) => s.switchSession);
  const closeSession = useSessionStore((s) => s.closeSession);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);

  const sessionList = Array.from(sessions.values());
  const active = activeId ? sessions.get(activeId) : null;

  const handleResolve = useCallback(
    (requestId: string, response: unknown) => {
      if (!activeId) return;
      resolveRequest(activeId, requestId, response);
    },
    [activeId, resolveRequest],
  );

  const handleSend = useCallback(
    (text: string) => {
      if (!activeId || !active) return;
      // If there's a pending question, send text as the answer
      if (active.pendingRequest && active.pendingRequest.type === "question") {
        resolveRequest(activeId, active.pendingRequest.requestId, { text });
        return;
      }
      // Otherwise, no-op for now (mid-session messaging not yet supported)
    },
    [activeId, active, resolveRequest],
  );

  if (sessionList.length === 0) {
    return (
      <div className="center-placeholder">
        Select a session or create a new one (Cmd+T)
      </div>
    );
  }

  const isRunning = active?.status === "running";
  const hasPending = active?.pendingRequest != null;
  const isDone = active?.status === "done" || active?.status === "error";

  const placeholder = hasPending
    ? active?.pendingRequest?.type === "approval"
      ? "Waiting for your approval above..."
      : "Answer the question above or type a response..."
    : isDone
      ? active?.status === "done"
        ? "Session complete"
        : "Session ended with error"
      : "Message Claude...";

  const inputDisabled = isDone || (hasPending && active?.pendingRequest?.type === "approval");

  return (
    <>
      <SessionTabBar
        sessions={sessionList}
        activeId={activeId}
        onSwitch={switchSession}
        onClose={closeSession}
      />
      {active ? (
        <>
          <ChatStream
            events={active.events}
            answeredRequests={active.answeredRequests}
            onResolveRequest={handleResolve}
          />
          <SessionStatusLine
            model={active.model}
            metrics={active.metrics}
            running={isRunning}
          />
          <InputArea
            disabled={inputDisabled}
            placeholder={placeholder}
            onSend={handleSend}
          />
        </>
      ) : (
        <div className="center-placeholder">Select a session tab</div>
      )}
    </>
  );
}
