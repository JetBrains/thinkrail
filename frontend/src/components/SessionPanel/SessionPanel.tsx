import { useCallback } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useRpc } from "@/api/hooks/useRpc.tsx";
import { createSessionApi } from "@/api/methods/sessions.ts";
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
  const previewFilePath = useFileStore((s) => s.previewFilePath);
  const previewFileObj = useFileStore((s) => s.previewFile);
  const clearPreview = useFileStore((s) => s.clearPreview);
  const pinPreview = useFileStore((s) => s.pinPreview);

  const sessionList = Array.from(sessions.values());
  const fileList = Array.from(openFiles.values());
  const activeSession = activeSessionId && !activeFilePath && !previewFilePath ? sessions.get(activeSessionId) : null;
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const displayFile = activeFile ?? (previewFilePath ? previewFileObj : null);

  const handleSwitchSession = useCallback(
    (taskId: string) => {
      switchSession(taskId);
      useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });
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

  if (sessionList.length === 0 && fileList.length === 0 && !previewFilePath) {
    return (
      <div className="center-placeholder">
        Select a session or create a new one (Cmd+T)
      </div>
    );
  }

  // Determine what to show in the content area
  const showFile = displayFile != null;
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
        activeSessionId={activeFilePath || previewFilePath ? null : activeSessionId}
        onSwitchSession={handleSwitchSession}
        onCloseSession={closeSession}
        files={fileList}
        activeFilePath={activeFilePath}
        onSwitchFile={handleSwitchFile}
        onCloseFile={closeFile}
        previewFile={previewFileObj}
        previewFilePath={previewFilePath}
        onClearPreview={clearPreview}
        onPinPreview={pinPreview}
      />
      {showFile && displayFile ? (
        <FileViewer file={displayFile} />
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
          {activeSession.restored ? (
            <RestoredBar taskId={activeSession.taskId} />
          ) : (
            <InputArea
              disabled={inputDisabled}
              placeholder={placeholder}
              onSend={handleSend}
            />
          )}
        </>
      ) : (
        <div className="center-placeholder">Select a tab</div>
      )}
    </>
  );
}

function RestoredBar({ taskId }: { taskId: string }) {
  const client = useRpc();
  const sessions = useSessionStore((s) => s.sessions);

  const handleResume = useCallback(async () => {
    try {
      const api = createSessionApi(client);
      const { taskId: newTaskId } = await api.continue(taskId);

      // Get the old session's data to carry over into the new tab
      const oldSession = sessions.get(taskId);
      const baseName = (oldSession?.name ?? "session").replace(" (resumed)", "");
      const name = `${baseName} (resumed)`;

      // Create a placeholder that carries over the old conversation history
      useSessionStore.setState((s) => {
        const next = new Map(s.sessions);
        const old = next.get(taskId);
        next.delete(taskId);
        if (!next.has(newTaskId)) {
          next.set(newTaskId, {
            taskId: newTaskId,
            name,
            skillId: old?.skillId ?? null,
            specIds: old?.specIds ?? [],
            status: "idle",
            model: old?.model ?? "",
            startedAt: old?.startedAt ?? Date.now(),
            // Carry over old events so the chat history is preserved
            events: old?.events ?? [],
            metrics: old?.metrics ?? { costUsd: 0, turns: 0, toolCalls: 0, contextTokens: 0, contextMax: 0, durationMs: 0, filesChanged: {} },
            pendingRequest: null,
            answeredRequests: old?.answeredRequests ?? new Map(),
          });
        }
        return { sessions: next, activeSessionId: newTaskId };
      });
    } catch (e) {
      console.error("Failed to resume session:", e);
    }
  }, [client, taskId, sessions]);

  return (
    <div className="restored-bar">
      <span className="restored-bar-text">
        This is a restored session (read-only)
      </span>
      <button className="restored-bar-btn" onClick={handleResume}>
        Resume Session
      </button>
    </div>
  );
}
