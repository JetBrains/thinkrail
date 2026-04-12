import { useCallback, useRef, useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useNotificationStore } from "@/store/notificationStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { useFileStore } from "@/store/fileStore.ts";
import type { SessionStatus } from "@/types/session.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import type { ChatStreamHandle } from "@/components/ChatStream/ChatStream.tsx";
import { SessionStatusLine } from "@/components/ChatStream/SessionStatusLine.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import { FileViewer } from "@/components/FileViewer/FileViewer.tsx";
import { BoardView } from "@/components/BoardView/BoardView.tsx";
import { MetaTicketDetail } from "@/components/MetaTicketDetail/MetaTicketDetail.tsx";
import { useBoardStore } from "@/store/boardStore.ts";
import { useMessageHistoryStore } from "@/store/messageHistoryStore";
import { SessionTabBar } from "./SessionTabBar.tsx";
import { StickyContextBar } from "./StickyContextBar.tsx";

export function SessionPanel() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const switchSession = useSessionStore((s) => s.switchSession);
  const closeSession = useSessionStore((s) => s.closeSession);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interruptSession = useSessionStore((s) => s.interruptSession);
  const endSession = useSessionStore((s) => s.endSession);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const restartSession = useSessionStore((s) => s.restartSession);
  const projectCost = useSessionStore((s) => s.projectCost);

  const openFiles = useFileStore((s) => s.openFiles);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const activateFile = useFileStore((s) => s.activateFile);
  const closeFile = useFileStore((s) => s.closeFile);
  const previewFilePath = useFileStore((s) => s.previewFilePath);
  const previewFileObj = useFileStore((s) => s.previewFile);
  const clearPreview = useFileStore((s) => s.clearPreview);
  const pinPreview = useFileStore((s) => s.pinPreview);

  const [contextCardVisible, setContextCardVisible] = useState(true);
  const chatStreamRef = useRef<ChatStreamHandle>(null);

  const openTabs = useSessionStore((s) => s.openTabs);
  const sessionList = Array.from(sessions.values()).filter((s) => openTabs.has(s.bonsaiSid));
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
    (text: string, isMarkdown?: boolean) => {
      if (!activeSessionId || !activeSession) return;
      if (activeSession.pendingRequest && activeSession.pendingRequest.type === "question") {
        resolveRequest(activeSessionId, activeSession.pendingRequest.requestId, { text });
        return;
      }
      if (activeSession.status === "draft" || activeSession.status === "initializing" || activeSession.status === "idle") {
        sendMessage(activeSessionId, text, isMarkdown);
      }
      useMessageHistoryStore.getState().addMessage(text);
    },
    [activeSessionId, activeSession, resolveRequest, sendMessage],
  );

  const handleContinue = useCallback(() => {
    if (!activeSessionId || !activeSession) return;
    if (activeSession.pendingRequest?.type === "question") {
      resolveRequest(activeSessionId, activeSession.pendingRequest.requestId, { text: "continue" });
      return;
    }
    if (activeSession.status === "initializing" || activeSession.status === "idle") {
      sendMessage(activeSessionId, "continue");
    }
  }, [activeSessionId, activeSession, resolveRequest, sendMessage]);

  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const openTicket = useBoardStore((s) => s.openTicket);

  const handleOpenTicket = useCallback((ticketId: string) => {
    openTicket(ticketId);
  }, [openTicket]);

  // Determine what to show in the content area
  const showTicket = activeTicketId != null;
  const showFile = !showTicket && displayFile != null;
  const showSession = !showTicket && activeSession != null && !showFile;

  const status = activeSession?.status as SessionStatus | undefined;
  const hasPending = activeSession?.pendingRequest != null;
  const isDone = status === "done" || status === "error";
  const isRunning = status === "running";
  const canInterrupt = status === "running" || status === "waiting";

  const placeholder = hasPending
    ? activeSession?.pendingRequest?.type === "approval"
      ? activeSession?.pendingRequest?.toolName === "ExitPlanMode"
        ? "Review the plan above..."
        : "Waiting for your approval above..."
      : "Answer the question above or type a response..."
    : isDone
      ? status === "done"
        ? "Session complete"
        : "Session ended with error"
      : isRunning
        ? "Agent is working..."
        : status === "draft"
          ? "Type a message to start, or adjust config above..."
          : "Message Claude...";

  const isDraft = status === "draft";
  const inputDisabled = isDone || isRunning || (hasPending && activeSession?.pendingRequest?.type === "approval");
  const showContinue = !inputDisabled && !canInterrupt && !isDraft && (activeSession?.events.length ?? 0) > 0;

  return (
    <>
      <SessionTabBar
        sessions={sessionList}
        activeSessionId={!showTicket && !showFile ? activeSessionId : null}
        onSwitchSession={handleSwitchSession}
        onCloseSession={closeSession}
        files={fileList}
        activeFilePath={!showTicket ? activeFilePath : null}
        onSwitchFile={handleSwitchFile}
        onCloseFile={closeFile}
        previewFile={previewFileObj}
        previewFilePath={!showTicket ? previewFilePath : null}
        onClearPreview={clearPreview}
        onPinPreview={pinPreview}
      />
      {showTicket && activeTicketId ? (
        <MetaTicketDetail ticketId={activeTicketId} />
      ) : showFile && displayFile ? (
        <FileViewer file={displayFile} />
      ) : showSession && activeSession ? (
        <>
          {!contextCardVisible && activeSession.events.length > 0 && (
            <StickyContextBar
              skillId={activeSession.skillId ?? undefined}
              specCount={activeSession.specIds.length}
              model={activeSession.model}
              permissionMode={activeSession.permissionMode}
              createdBy={activeSession.createdBy}
              onScrollToTop={() => chatStreamRef.current?.scrollToTop()}
            />
          )}
          <ChatStream
            ref={chatStreamRef}
            events={activeSession.events}
            answeredRequests={activeSession.answeredRequests}
            onResolveRequest={handleResolve}
            session={activeSession}
            onContextCardVisibility={setContextCardVisible}
          />
          {!isDraft && (
            <SessionStatusLine
              model={activeSession.model}
              permissionMode={activeSession.permissionMode}
              effort={activeSession.effort ?? null}
              metrics={activeSession.metrics}
              status={status ?? "idle"}
              projectCost={projectCost}
              disabled={activeSession.restored || isDone}
              onChangeModel={(m) => updateConfig(activeSession.bonsaiSid, { model: m })}
              onChangePermissionMode={(m) => updateConfig(activeSession.bonsaiSid, { permissionMode: m })}
              onInterrupt={() => interruptSession(activeSession.bonsaiSid)}
              onEndSession={() => endSession(activeSession.bonsaiSid)}
              onBackground={() => closeSession(activeSession.bonsaiSid)}
              onChangeEffort={async (e) => {
                await updateConfig(activeSession.bonsaiSid, { effort: e });
                await restartSession(activeSession.bonsaiSid);
              }}
            />
          )}
          {activeSession.restored || isDone ? (
            <RestoredBar bonsaiSid={activeSession.bonsaiSid} ended={isDone && !activeSession.restored} />
          ) : (
            <InputArea
              sessionId={activeSession.bonsaiSid}
              disabled={inputDisabled}
              placeholder={placeholder}
              onSend={handleSend}
              isRunning={isRunning}
              canInterrupt={canInterrupt}
              onInterrupt={() => interruptSession(activeSession!.bonsaiSid)}
              showContinue={showContinue}
              onContinue={handleContinue}
              isDraft={isDraft}
            />
          )}
        </>
      ) : (
        <BoardView onOpenTicket={handleOpenTicket} />
      )}
    </>
  );
}

function RestoredBar({ bonsaiSid, ended }: { bonsaiSid: string; ended?: boolean }) {
  const handleResume = useCallback(async () => {
    try {
      await useSessionStore.getState().continueSession(bonsaiSid);
    } catch (e) {
      console.error("Failed to resume session:", e);
      useNotificationStore.getState().addToast({
        eventType: "error",
        message: `Resume failed: ${getErrorMessage(e)}`,
        persistent: true,
        bonsaiSid,
      });
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
