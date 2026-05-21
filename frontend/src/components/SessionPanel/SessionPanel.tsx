import { useCallback, useRef, useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useNotificationStore } from "@/store/notificationStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { modLabel } from "@/utils/platform.ts";
import type { SessionStatus } from "@/types/session.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import type { ChatStreamHandle } from "@/components/ChatStream/ChatStream.tsx";
import { SessionStatusLine } from "@/components/ChatStream/SessionStatusLine.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import { FileViewer } from "@/components/FileViewer/FileViewer.tsx";
import { useMessageHistoryStore } from "@/store/messageHistoryStore";
import { SessionTabBar } from "./SessionTabBar.tsx";
import { StickyContextBar } from "./StickyContextBar.tsx";
import "./SessionPanel.css";

export function SessionPanel({
  hideTabBar = false,
  hideStickyBar = false,
  hideContextCard = false,
}: {
  hideTabBar?: boolean;
  hideStickyBar?: boolean;
  hideContextCard?: boolean;
} = {}) {
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
  const createNewSession = useSessionStore((s) => s.createNewSession);

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
  // Shared portal target: SessionStatusLine exposes a slot ref; InputArea
  // portals its action buttons (Continue / Start / Stop / Send) there so
  // they appear right of the session status indicator.
  const [actionSlot, setActionSlot] = useState<HTMLSpanElement | null>(null);

  const openTabs = useSessionStore((s) => s.openTabs);
  const sessionList = Array.from(sessions.values()).filter((s) => openTabs.has(s.bonsaiSid));
  const fileList = Array.from(openFiles.values());
  const activeSession = activeSessionId && !activeFilePath && !previewFilePath ? sessions.get(activeSessionId) : null;

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const displayFile = activeFile ?? (previewFilePath ? previewFileObj : null);

  const handleSwitchSession = useCallback(
    (taskId: string) => {
      switchSession(taskId);
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

  // Board mode and new-project goal-entry screen are hoisted to AppShell so
  // they occupy the full window. SessionPanel only renders for centerView === "sessions".
  // Determine what to show in the content area
  const showFile = displayFile != null;
  const showSession = activeSession != null && !showFile;

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
      {!hideTabBar && (
        <div className="session-tabs-row">
          <SessionTabBar
            sessions={sessionList}
            activeSessionId={!showFile ? activeSessionId : null}
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
          <button
            className="session-new-btn"
            onClick={() => createNewSession()}
            title={`New session (${modLabel("T")})`}
          >
            + New
          </button>
        </div>
      )}
      {showFile && displayFile ? (
        <FileViewer file={displayFile} />
      ) : showSession && activeSession ? (
        <>
          {!hideStickyBar && !contextCardVisible && activeSession.events.length > 0 && (
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
            events={
              hideContextCard
                ? activeSession.events.filter((e) => e.eventType !== "sessionStart")
                : activeSession.events
            }
            answeredRequests={activeSession.answeredRequests}
            onResolveRequest={handleResolve}
            session={activeSession}
            onContextCardVisibility={setContextCardVisible}
          />
          <div className="session-bottom">
            {/* Render the status line in every session state — including
                "draft" — so the model picker, permission mode, effort and
                the Start/Stop/Continue action slot are present regardless
                of how the session was started. Keeps the wizard chat and
                the regular session window visually 1:1. */}
            <SessionStatusLine
              model={activeSession.model}
              permissionMode={activeSession.permissionMode}
              effort={activeSession.effort ?? null}
              metrics={activeSession.metrics}
              status={status ?? "idle"}
              projectCost={projectCost}
              disabled={activeSession.restored || isDone}
              actionSlotRef={setActionSlot}
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
                actionPortalTarget={actionSlot}
              />
            )}
          </div>
        </>
      ) : (
        <div className="session-empty">
          <div className="session-empty-title">No active session</div>
          <div className="session-empty-hint">
            Press <span className="session-empty-kbd">⌘T</span> or click <b>+ New</b> above to start a session.
          </div>
        </div>
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
