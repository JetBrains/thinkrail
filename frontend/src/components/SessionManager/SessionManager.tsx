import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@/api/hooks/useRpc.tsx";
import { createSessionApi, type SessionSummary } from "@/api/methods/sessions.ts";
import { createAgentApi } from "@/api/methods/agents.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import type { AgentEvent } from "@/types/agent.ts";
import "./SessionManager.css";

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "idle":
      return { label: "Idle", cls: "badge-idle" };
    case "running":
      return { label: "Running", cls: "badge-running" };
    case "done":
      return { label: "Done", cls: "badge-done" };
    case "error":
      return { label: "Error", cls: "badge-error" };
    default:
      return { label: status, cls: "" };
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function SessionManager({ onClose }: { onClose?: () => void }) {
  const client = useRpc();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const switchSession = useSessionStore((s) => s.switchSession);
  const activeSessions = useSessionStore((s) => s.sessions);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const endSession = useSessionStore((s) => s.endSession);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = createSessionApi(client);
      const list = await api.list();
      setSessions(list);
    } catch (e) {
      setError(`Failed to load sessions: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleContinue = useCallback(
    async (taskId: string) => {
      try {
        const api = createSessionApi(client);
        const { taskId: newTaskId } = await api.continue(taskId);

        // Load old session events from backend
        const oldData = await api.get(taskId);
        const oldEvents: AgentEvent[] = (oldData?.events ?? []).map(
          (ev: Record<string, unknown>) => ({
            taskId,
            sessionId: ((ev.payload as Record<string, unknown>)?.sessionId as string) ?? "",
            eventType: ((ev.eventType as string) ?? "notification") as AgentEvent["eventType"],
            payload: (ev.payload as Record<string, unknown>) ?? ev,
          }),
        );

        // Prefer in-memory events (fresher) over disk events
        const inMemory = useSessionStore.getState().sessions.get(taskId);
        const events = inMemory?.events?.length ? inMemory.events : oldEvents;
        const baseName = (oldData?.name ?? inMemory?.name ?? "session")
          .replace(" (continued)", "");

        // Create the new session in the store with old events carried over
        useSessionStore.setState((s) => {
          const next = new Map(s.sessions);
          next.delete(taskId);
          if (!next.has(newTaskId)) {
            next.set(newTaskId, {
              taskId: newTaskId,
              name: `${baseName} (continued)`,
              skillId: (oldData?.skillId as string) ?? inMemory?.skillId ?? null,
              specIds: oldData?.specIds ?? inMemory?.specIds ?? [],
              status: "idle",
              model: (oldData?.config?.model as string) ?? inMemory?.model ?? "",
              permissionMode: (oldData?.config?.permissionMode as string) ?? inMemory?.permissionMode ?? "default",
              startedAt: inMemory?.startedAt ?? Date.now(),
              events,
              metrics: inMemory?.metrics ?? { costUsd: 0, turns: 0, toolCalls: 0, contextTokens: 0, contextMax: 0, durationMs: 0, filesChanged: {} },
              pendingRequest: null,
              answeredRequests: new Map(),
            });
          }
          return { sessions: next, activeSessionId: newTaskId };
        });
        onClose?.();
      } catch (e) {
        console.error("Failed to continue session:", e);
      }
    },
    [client, onClose],
  );

  const handleStop = useCallback(
    async (taskId: string) => {
      try {
        const api = createAgentApi(client);
        await api.end(taskId);
        // Also end it in the local store if present
        if (activeSessions.has(taskId)) {
          try { await endSession(taskId); } catch { /* ignore */ }
        }
        fetchSessions();
      } catch (e) {
        console.error("Failed to stop session:", e);
      }
    },
    [client, activeSessions, endSession, fetchSessions],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      try {
        const api = createSessionApi(client);
        await api.delete(taskId);
        fetchSessions();
      } catch (e) {
        console.error("Failed to delete session:", e);
      }
    },
    [client, fetchSessions],
  );

  const handleOpen = useCallback(
    async (taskId: string) => {
      if (activeSessions.has(taskId)) {
        switchSession(taskId);
      } else {
        await restoreSession(taskId);
      }
      onClose?.();
    },
    [activeSessions, switchSession, restoreSession, onClose],
  );

  if (loading) {
    return <div className="sm-loading">Loading sessions...</div>;
  }

  // Hide sessions that have been superseded by a continuation
  const superseded = new Set(
    sessions.filter((s) => s.continuedFrom).map((s) => s.continuedFrom!),
  );
  const visible = sessions.filter((s) => !superseded.has(s.taskId));

  const active = visible.filter(
    (s) => s.status === "idle" || s.status === "running",
  );
  const completed = visible.filter((s) => s.status === "done");
  const errored = visible.filter((s) => s.status === "error");

  return (
    <div className="session-manager">
      <div className="sm-header">
        <h3 className="sm-title">Sessions</h3>
        <button className="sm-refresh" onClick={fetchSessions} title="Refresh">
          {"\u21BB"}
        </button>
      </div>

      {error && <div className="sm-error">{error}</div>}

      {sessions.length === 0 && !error && (
        <div className="sm-empty">No sessions yet. Create one with Cmd+T.</div>
      )}

      {active.length > 0 && (
        <SessionGroup
          label="Active"
          sessions={active}
          onOpen={handleOpen}
          onStop={handleStop}
          onContinue={handleContinue}
          onDelete={handleDelete}
        />
      )}
      {completed.length > 0 && (
        <SessionGroup
          label="Completed"
          sessions={completed}
          onOpen={handleOpen}
          onStop={handleStop}
          onContinue={handleContinue}
          onDelete={handleDelete}
        />
      )}
      {errored.length > 0 && (
        <SessionGroup
          label="Errors"
          sessions={errored}
          onOpen={handleOpen}
          onStop={handleStop}
          onContinue={handleContinue}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function SessionGroup({
  label,
  sessions,
  onOpen,
  onStop,
  onContinue,
  onDelete,
}: {
  label: string;
  sessions: SessionSummary[];
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  onContinue: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="sm-group">
      <div className="sm-group-label">{label}</div>
      {sessions.map((s) => {
        const badge = statusBadge(s.status);
        const isActive = s.status === "idle" || s.status === "running";
        const isDead = s.status === "done" || s.status === "error";
        return (
          <div key={`sm-${s.taskId}`} className="sm-card" onClick={() => onOpen(s.taskId)}>
            <div className="sm-card-top">
              <span className={`sm-badge ${badge.cls}`}>{badge.label}</span>
              <span className="sm-card-name">{s.name || s.taskId.slice(0, 8)}</span>
              <span className="sm-card-time">{timeAgo(s.createdAt)}</span>
            </div>
            <div className="sm-card-meta">
              {s.model && <span>{s.model}</span>}
              {s.continuedFrom && <span>continued</span>}
            </div>
            {isActive && (
              <div className="sm-card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="sm-btn" onClick={() => onOpen(s.taskId)}>
                  Switch to
                </button>
                <button className="sm-btn sm-btn-stop" onClick={() => onStop(s.taskId)}>
                  Stop
                </button>
              </div>
            )}
            {isDead && (
              <div className="sm-card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="sm-btn sm-btn-continue" onClick={() => onContinue(s.taskId)}>
                  Continue
                </button>
                <button className="sm-btn sm-btn-delete" onClick={() => onDelete(s.taskId)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
