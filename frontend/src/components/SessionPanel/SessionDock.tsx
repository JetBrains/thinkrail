import { useState, type ReactNode } from "react";
import type { SessionMetrics, SessionStatus } from "@/types/session.ts";
import { SessionStatusLine } from "@/components/ChatStream/SessionStatusLine.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";

interface SessionDockProps {
  // ── Status line ──
  model: string;
  permissionMode: string;
  effort: string | null;
  metrics: SessionMetrics;
  status: SessionStatus;
  /** Status line disabled (restored / ended sessions). */
  statusDisabled?: boolean;
  onChangeModel?: (model: string) => void;
  onChangePermissionMode?: (mode: string) => void;
  onChangeEffort?: (effort: string | null) => void;
  onInterrupt?: () => void;
  onEndSession?: () => void;
  onBackground?: () => void;
  // ── Input ──
  sessionId: string;
  inputDisabled: boolean;
  placeholder: string;
  onSend: (text: string, isMarkdown?: boolean) => void;
  isRunning?: boolean;
  canInterrupt?: boolean;
  showContinue?: boolean;
  onContinue?: () => void;
  isDraft?: boolean;
  /** Rendered instead of the input when the session can't take input
   *  (e.g. a restored/ended-session bar). */
  footer?: ReactNode;
}

/**
 * The session "dock" — the bottom island of a session: the SessionStatusLine
 * (model / permission / effort / cost + action slot) above the InputArea (or a
 * provided footer). Owns the action-slot portal that lets InputArea's
 * Start/Stop/Continue buttons render inside the status line.
 */
export function SessionDock({
  model,
  permissionMode,
  effort,
  metrics,
  status,
  statusDisabled,
  onChangeModel,
  onChangePermissionMode,
  onChangeEffort,
  onInterrupt,
  onEndSession,
  onBackground,
  sessionId,
  inputDisabled,
  placeholder,
  onSend,
  isRunning,
  canInterrupt,
  showContinue,
  onContinue,
  isDraft,
  footer,
}: SessionDockProps) {
  const [actionSlot, setActionSlot] = useState<HTMLSpanElement | null>(null);

  return (
    <div className="session-bottom">
      <SessionStatusLine
        model={model}
        permissionMode={permissionMode}
        effort={effort ?? ""}
        metrics={metrics}
        status={status}
        disabled={statusDisabled}
        actionSlotRef={setActionSlot}
        onChangeModel={onChangeModel}
        onChangePermissionMode={onChangePermissionMode}
        onChangeEffort={onChangeEffort}
        onInterrupt={onInterrupt}
        onEndSession={onEndSession}
        onBackground={onBackground}
      />
      {footer ?? (
        <InputArea
          sessionId={sessionId}
          disabled={inputDisabled}
          placeholder={placeholder}
          onSend={onSend}
          isRunning={isRunning}
          canInterrupt={canInterrupt}
          onInterrupt={onInterrupt}
          showContinue={showContinue}
          onContinue={onContinue}
          isDraft={isDraft}
          actionPortalTarget={actionSlot}
        />
      )}
    </div>
  );
}
