import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetaTicket } from "@/types/board.ts";
import type { SessionStatus } from "@/types/session.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { DEFAULT_MODEL } from "@/utils/models.ts";
import { ChatStream } from "@/components/ChatStream/ChatStream.tsx";
import { InputArea } from "@/components/ChatStream/InputArea.tsx";
import { MarkdownEditor } from "@/components/MarkdownEditor/MarkdownEditor.tsx";

interface TicketDescriptionViewProps {
  ticket: MetaTicket;
  onTicketUpdated?: (ticket: MetaTicket) => void;
}

export function TicketDescriptionView({ ticket, onTicketUpdated }: TicketDescriptionViewProps) {
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const sessions = useSessionStore((s) => s.sessions);
  const createDraft = useSessionStore((s) => s.createDraft);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interruptSession = useSessionStore((s) => s.interruptSession);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.body);
  const [embeddedSid, setEmbeddedSid] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Restore an existing describe session for this ticket
  useEffect(() => {
    if (embeddedSid) return;
    for (const [sid, s] of sessions) {
      if (s.skillId === "ticket-describe" && s.metaTicketId === ticket.id) {
        setEmbeddedSid(sid);
        break;
      }
    }
  }, [sessions, ticket.id, embeddedSid]);

  // Sync draft when ticket.body changes externally (e.g., agent direct-apply)
  useEffect(() => {
    if (!editing) {
      setDraft(ticket.body);
    }
  }, [ticket.body, editing]);

  const session = embeddedSid ? sessions.get(embeddedSid) : null;

  // Auto-enter edit mode when the draft session starts running
  useEffect(() => {
    if (session && session.status !== "draft" && !editing) {
      setDraft(ticket.body);
      setEditing(true);
    }
  }, [session?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    const updated = await updateTicket(ticket.id, { body: draft });
    onTicketUpdated?.(updated as MetaTicket);
    setEditing(false);
  }, [ticket.id, draft, updateTicket, onTicketUpdated]);

  const handleStartAI = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      const sid = await createDraft({
        specIds: [],
        config: {
          model: DEFAULT_MODEL,
          maxTurns: 50,
          permissionMode: "default",
          streamText: true,
          betas: [],
          effort: null,
        },
        name: `Describe: ${ticket.title}`,
        skillId: "ticket-describe",
        metaTicketId: ticket.id,
      });
      setEmbeddedSid(sid);
    } catch (e) {
      console.error("[TicketDescriptionView] Failed to create describe session:", e);
    } finally {
      setStarting(false);
    }
  }, [starting, createDraft, ticket]);

  const handleApplyDescription = useCallback((text: string) => {
    setDraft(text);
    if (!editing) {
      setEditing(true);
    }
  }, [editing]);

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

  // Session status helpers
  const status = (session?.status ?? "idle") as SessionStatus;
  const hasPending = session?.pendingRequest != null;
  const isDone = status === "done" || status === "error";
  const isRunning = status === "running";
  const canInterrupt = status === "running" || status === "waiting";

  const placeholder = useMemo(() => {
    if (!session) return "";
    if (hasPending) {
      return session.pendingRequest?.type === "approval"
        ? "Waiting for your approval above..."
        : "Answer the question above...";
    }
    if (isDone) return "Session complete";
    if (isRunning) return "Agent is working...";
    return "Message Claude...";
  }, [session, hasPending, isDone, isRunning]);

  const inputDisabled = isDone || isRunning || (hasPending && session?.pendingRequest?.type === "approval");

  // --- Editor pane (always shown) ---
  const editorPane = (
    <div className={session ? "ticket-describe-editor" : "ticket-right-body"}>
      <MarkdownEditor
        value={editing ? draft : ticket.body}
        onChange={(v) => {
          if (!editing) {
            setDraft(v);
            setEditing(true);
          } else {
            setDraft(v);
          }
        }}
        preview={true}
        initialMode={editing ? "edit" : "preview"}
      />
      {editing && (
        <div className="ticket-right-actions">
          <button className="ticket-section-action" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="ticket-section-action ticket-section-action--primary" onClick={handleSave}>
            Save
          </button>
        </div>
      )}
    </div>
  );

  // --- With active session: split pane ---
  if (session) {
    return (
      <div className="ticket-right-panel">
        <div className="ticket-right-header">
          <span className="ticket-right-title">Description</span>
        </div>
        <div className="ticket-describe-split">
          {editorPane}
          <div className="ticket-describe-chat">
            <div className="ticket-describe-chat-header">
              <span className="ticket-describe-chat-title">AI Assist</span>
              <span
                className="ticket-describe-chat-status"
                style={{ color: isRunning ? "var(--blue)" : "var(--hint)" }}
              >
                {status}
              </span>
            </div>
            <ChatStream
              events={session.events}
              answeredRequests={session.answeredRequests}
              onResolveRequest={handleResolve}
              session={session}
              onApplyDescription={handleApplyDescription}
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
        </div>
      </div>
    );
  }

  // --- No session: editor only with "Describe with AI" button ---
  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Description</span>
        <div className="ticket-right-header-actions">
          <button
            className="ticket-section-action ticket-describe-ai-btn"
            onClick={handleStartAI}
            disabled={starting}
          >
            {starting ? "Starting..." : "Describe with AI"}
          </button>
        </div>
      </div>
      {editorPane}
    </div>
  );
}
