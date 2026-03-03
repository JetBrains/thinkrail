import { useCallback } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import type { SessionStatus } from "@/types/session.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import { SessionStatusLine } from "@/components/ChatStream/SessionStatusLine.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import { FileViewer } from "@/components/FileViewer/FileViewer.tsx";
import { SessionTabBar } from "./SessionTabBar.tsx";

export function SessionPanel() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const switchSession = useSessionStore((s) => s.switchSession);
  const closeSession = useSessionStore((s) => s.closeSession);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);
  const sendMessage = useSessionStore((s) => s.sendMessage);

  const openFiles = useFileStore((s) => s.openFiles);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const activateFile = useFileStore((s) => s.activateFile);
  const closeFile = useFileStore((s) => s.closeFile);

  const sessionList = Array.from(sessions.values());
  const fileList = Array.from(openFiles.values());
  const activeSession = activeSessionId && !activeFilePath ? sessions.get(activeSessionId) : null;
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;

  const handleSwitchSession = useCallback(
    (taskId: string) => {
      switchSession(taskId);
      // Clear file selection when switching to a session
      useFileStore.getState().activeFilePath = null;
      useFileStore.setState({ activeFilePath: null });
    },
    [switchSession],
  );

  const handleSwitchFile = useCallback(
    (path: string) => {
      activateFile(path);
    },
    [activateFile],
  );

  const handleResolve = useCallback(
    (requestId: string, response: unknown) => {
      if (!activeSessionId) return;
      resolveRequest(activeSessionId, requestId, response);
    },
    [activeSessionId, resolveRequest],
  );

  const handleSend = useCallback(
    (text: string) => {
      if (!activeSessionId || !activeSession) return;
      if (activeSession.pendingRequest && activeSession.pendingRequest.type === "question") {
        resolveRequest(activeSessionId, activeSession.pendingRequest.requestId, { text });
        return;
      }
      if (activeSession.status === "idle") {
        sendMessage(activeSessionId, text);
      }
    },
    [activeSessionId, activeSession, resolveRequest, sendMessage],
  );

  if (sessionList.length === 0 && fileList.length === 0) {
    return (
      <div className="center-placeholder">
        Select a session or create a new one (Cmd+T)
      </div>
    );
  }

  // Determine what to show in the content area
  const showFile = activeFile != null;
  const showSession = activeSession != null && !showFile;

  const status = activeSession?.status as SessionStatus | undefined;
  const hasPending = activeSession?.pendingRequest != null;
  const isDone = status === "done" || status === "error";
  const isRunning = status === "running";

  const placeholder = hasPending
    ? activeSession?.pendingRequest?.type === "approval"
      ? "Waiting for your approval above..."
      : "Answer the question above or type a response..."
    : isDone
      ? status === "done"
        ? "Session complete"
        : "Session ended with error"
      : isRunning
        ? "Agent is working..."
        : "Message Claude...";

  const inputDisabled = isDone || isRunning || (hasPending && activeSession?.pendingRequest?.type === "approval");

  return (
    <>
      <SessionTabBar
        sessions={sessionList}
        activeSessionId={activeFilePath ? null : activeSessionId}
        onSwitchSession={handleSwitchSession}
        onCloseSession={closeSession}
        files={fileList}
        activeFilePath={activeFilePath}
        onSwitchFile={handleSwitchFile}
        onCloseFile={closeFile}
      />
      {showFile && activeFile ? (
        <FileViewer file={activeFile} />
      ) : showSession && activeSession ? (
        <>
          <ChatStream
            events={activeSession.events}
            answeredRequests={activeSession.answeredRequests}
            onResolveRequest={handleResolve}
          />
          <SessionStatusLine
            model={activeSession.model}
            metrics={activeSession.metrics}
            running={isRunning}
          />
          <InputArea
            disabled={inputDisabled}
            placeholder={placeholder}
            onSend={handleSend}
          />
        </>
      ) : (
        <div className="center-placeholder">Select a tab</div>
      )}
    </>
  );
}
