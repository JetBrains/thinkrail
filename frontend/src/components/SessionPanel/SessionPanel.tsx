import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useNotificationStore } from "@/store/notificationStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import type { SessionStatus } from "@/types/session.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import type { ChatStreamHandle } from "@/components/ChatStream/ChatStream.tsx";
import { SessionStatusLine } from "@/components/ChatStream/SessionStatusLine.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import { FileViewer } from "@/components/FileViewer/FileViewer.tsx";
import { Card } from "@/components/ui/index.ts";
import { useMessageHistoryStore } from "@/store/messageHistoryStore";
import { ContextPanel, TicketRouteContextPanel } from "@/components/ContextPanel/ContextPanel.tsx";
import { ResizeHandle } from "@/components/AppShell/ResizeHandle.tsx";
import { useBoardStore } from "@/store/boardStore.ts";
import { TicketInfo } from "@/components/TicketDetail/TicketInfo.tsx";
import { useTicketRouteData } from "@/components/TicketDetail/useTicketRouteData.ts";
import { SessionTabBar } from "./SessionTabBar.tsx";
import { useActiveTabKind } from "./useActiveTabKind.ts";
import { StickyContextBar } from "./StickyContextBar.tsx";
import { SessionContentLayout } from "./SessionContentLayout.tsx";
import "./SessionPanel.css";

const CONTEXT_DEFAULT_W = 360;
const CONTEXT_MIN_W = 240;

interface Props {
  hideTabBar?: boolean;
  hideStickyBar?: boolean;
  hideContextCard?: boolean;
  /** When set, SessionPanel locks to this session id instead of the global
   *  `activeSessionId`, suppresses the tab bar + file viewer overlay, and
   *  auto-restores the session from disk if it isn't in the in-memory map
   *  yet. Use from embedded contexts like the ticket route. */
  embeddedSid?: string | null;
  /** Forwarded to ChatStream — used by the ticket route to apply
   *  agent-suggested ticket descriptions to the ticket body. */
  onApplyDescription?: (text: string) => void | Promise<void>;
}

export function SessionPanel({
  hideTabBar = false,
  hideStickyBar = false,
  hideContextCard = false,
  embeddedSid = null,
  onApplyDescription,
}: Props = {}) {
  const isEmbedded = embeddedSid != null;
  const sessions = useSessionStore((s) => s.sessions);
  const globalActiveSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSessionId = isEmbedded ? embeddedSid : globalActiveSessionId;
  const switchSession = useSessionStore((s) => s.switchSession);
  const closeSession = useSessionStore((s) => s.closeSession);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interruptSession = useSessionStore((s) => s.interruptSession);
  const endSession = useSessionStore((s) => s.endSession);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const restartSession = useSessionStore((s) => s.restartSession);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const projectCost = useSessionStore((s) => s.projectCost);

  const openFiles = useFileStore((s) => s.openFiles);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const activateFile = useFileStore((s) => s.activateFile);
  const closeFile = useFileStore((s) => s.closeFile);
  const previewFilePath = useFileStore((s) => s.previewFilePath);
  const previewFileObj = useFileStore((s) => s.previewFile);
  const clearPreview = useFileStore((s) => s.clearPreview);
  const pinPreview = useFileStore((s) => s.pinPreview);

  // Cross-panel scroll: the phase tree dispatches scroll-to-event requests
  // via ticketRouteStore. We honour them only when embedded *and* the
  // request targets the session we're showing.
  const pendingScroll = useTicketRouteStore((s) => s.pendingScroll);
  const consumeScroll = useTicketRouteStore((s) => s.consumeScroll);

  const [contextCardVisible, setContextCardVisible] = useState(true);
  const chatStreamRef = useRef<ChatStreamHandle>(null);
  const [restoring, setRestoring] = useState(false);
  const failedRestoreRef = useRef<Set<string>>(new Set());

  // In-session context card (right side of the chat). Always visible — it
  // can't be collapsed away (there's no affordance to bring it back). Width
  // is local and resized with an invisible handle.
  const [contextWidth, setContextWidth] = useState(CONTEXT_DEFAULT_W);

  // Ticket tabs (ticket = folder). Embedded/wizard panels never show ticket UI.
  const activeTab = useActiveTabKind({ embedded: isEmbedded });
  const openTicketIds = useBoardStore((s) => s.openTicketIds);
  const ticketsMap = useBoardStore((s) => s.tickets);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const switchTicket = useBoardStore((s) => s.openTicket);
  const closeTicket = useBoardStore((s) => s.closeTicket);
  const ticketTabs = (isEmbedded || hideTabBar)
    ? []
    : openTicketIds.map((id) => ({
        id,
        title: ticketsMap.get(id)?.title ?? `Ticket #${id.slice(-4)}`,
      }));
  const isTicketTab = activeTab === "ticket";
  // Load ticket data into ticketRouteStore while a ticket tab is active.
  useTicketRouteData(isTicketTab ? activeTicketId : null);

  // Auto-restore session from disk in embedded mode if it isn't already
  // in the in-memory map. Restore failures are remembered per sid so a
  // persistently-bad session doesn't get retried in a tight loop when
  // the .finally below resets `restoring`.
  useEffect(() => {
    if (!isEmbedded || !embeddedSid) return;
    if (sessions.has(embeddedSid)) return;
    if (restoring) return;
    if (failedRestoreRef.current.has(embeddedSid)) return;
    setRestoring(true);
    restoreSession(embeddedSid, { noTab: true })
      .catch((e) => {
        failedRestoreRef.current.add(embeddedSid);
        console.error("[SessionPanel] auto-restore failed:", e);
      })
      .finally(() => setRestoring(false));
  }, [isEmbedded, embeddedSid, sessions, restoring, restoreSession]);

  // pendingScroll consumer (embedded mode only).
  useEffect(() => {
    if (!isEmbedded || !pendingScroll) return;
    if (pendingScroll.sessionId !== activeSessionId) return;
    const target = pendingScroll.eventIndex;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chatStreamRef.current?.scrollToEvent(target);
        consumeScroll();
      });
    });
  }, [isEmbedded, pendingScroll, activeSessionId, consumeScroll]);
  // Shared portal target: SessionStatusLine exposes a slot ref; InputArea
  // portals its action buttons (Continue / Start / Stop / Send) there so
  // they appear right of the session status indicator.
  const [actionSlot, setActionSlot] = useState<HTMLSpanElement | null>(null);

  const openTabs = useSessionStore((s) => s.openTabs);
  const sessionList = isEmbedded
    ? []
    : Array.from(sessions.values()).filter((s) => openTabs.has(s.bonsaiSid));
  const fileList = isEmbedded ? [] : Array.from(openFiles.values());
  // In embedded mode the file viewer never takes over — the ticket route
  // shows artifacts via its own right-panel surface, and the user opening
  // a file there shouldn't replace the chat in the center column.
  const activeSession = isEmbedded
    ? (activeSessionId ? sessions.get(activeSessionId) ?? null : null)
    : (activeSessionId && !activeFilePath && !previewFilePath ? sessions.get(activeSessionId) ?? null : null);

  const activeFile = !isEmbedded && activeFilePath ? openFiles.get(activeFilePath) : null;
  const displayFile = isEmbedded ? null : (activeFile ?? (previewFilePath ? previewFileObj : null));

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
      const firstQuestion = activeSession.pendingRequests.find((r) => r.type === "question");
      if (firstQuestion) {
        resolveRequest(activeSessionId, firstQuestion.requestId, { text });
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
    const firstQuestion = activeSession.pendingRequests.find((r) => r.type === "question");
    if (firstQuestion) {
      resolveRequest(activeSessionId, firstQuestion.requestId, { text: "continue" });
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
  // Context card belongs to the full session view only — not the embedded
  // (ticket-route) or wizard (hideTabBar) chats, and hidden while a file shows.
  // Shown for a session (agent context) or a ticket tab (artifacts).
  const showContext = !isEmbedded && !hideTabBar && (showSession || isTicketTab);

  const status = activeSession?.status as SessionStatus | undefined;
  const firstPending = activeSession?.pendingRequests[0] ?? null;
  const hasPending = firstPending != null;
  const isDone = status === "done" || status === "error";
  const isRunning = status === "running";
  const canInterrupt = status === "running" || status === "waiting";

  const placeholder = hasPending
    ? firstPending?.type === "approval"
      ? firstPending?.toolName === "ExitPlanMode"
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
  const inputDisabled = isDone || isRunning || (hasPending && firstPending?.type === "approval");
  const showContinue = !inputDisabled && !canInterrupt && !isDraft && (activeSession?.events.length ?? 0) > 0;

  // When not embedded and not hideTabBar, use TwoPanelLayout
  const useNewLayout = !isEmbedded && !hideTabBar;

  // Build left panel content (tabs + main content area)
  const leftPanelContent = (
    <>
      {!hideTabBar && !isEmbedded && (
        <div className="session-tabs-row">
          <SessionTabBar
            tickets={ticketTabs}
            activeTicketId={activeTicketId}
            onSwitchTicket={switchTicket}
            onCloseTicket={closeTicket}
            sessions={sessionList}
            activeSessionId={activeSessionId}
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
        </div>
      )}
      {showFile && displayFile ? (
        <FileViewer file={displayFile} />
      ) : isTicketTab ? (
        <div className="session-chat-col">
          <div className="left-panel-ticket-body">
            <TicketInfo />
          </div>
        </div>
      ) : showSession && activeSession ? (
        <div className="session-chat-col">
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
            onApplyDescription={onApplyDescription}
            answeredRequests={activeSession.answeredRequests}
            onResolveRequest={handleResolve}
            session={activeSession}
            onContextCardVisibility={setContextCardVisible}
          />
          <Card className="session-bottom">
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
          </Card>
        </div>
      ) : isEmbedded ? (
        <div className="session-empty">
          <div className="session-empty-title">
            {restoring ? "Loading session…" : "Session unavailable"}
          </div>
        </div>
      ) : (
        <div className="session-empty">
          <div className="session-empty-title">No active session</div>
          <div className="session-empty-hint">
            Press <span className="session-empty-kbd">⌘T</span> or click <b>+ New</b> in the tab bar to start a session.
          </div>
        </div>
      )}
    </>
  );

  // Build right panel content (context/artifacts)
  const rightPanelContent = showContext && useNewLayout ? (
    isTicketTab ? <TicketRouteContextPanel /> : <ContextPanel />
  ) : undefined;

  // For embedded/wizard views, use old layout with ResizeHandle
  if (isEmbedded || hideTabBar) {
    return (
      <>
        {leftPanelContent}
        {!isEmbedded && !hideTabBar && showContext && rightPanelContent && (
          <>
            <ResizeHandle
              side="right"
              invisible
              panelWidth={contextWidth}
              onResize={setContextWidth}
              onCollapse={() => {}}
              min={CONTEXT_MIN_W}
              collapseThreshold={0}
            />
            <div className="session-context-col" style={{ width: contextWidth }}>
              {rightPanelContent}
            </div>
          </>
        )}
      </>
    );
  }

  // For regular sessions view, use SessionContentLayout (content-only, no background wrapper)
  if (useNewLayout) {
    return (
      <SessionContentLayout
        leftPanel={leftPanelContent}
        rightPanel={rightPanelContent}
        rightPanelTitle={isTicketTab ? "Artifacts" : "Context"}
      />
    );
  }

  // Fallback for old layout (shouldn't reach here for new layout)
  return <div className="session-single-panel">{leftPanelContent}</div>;
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
