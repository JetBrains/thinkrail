import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@/api/hooks/useRpc.tsx";
import { createSessionApi, type SessionSummary } from "@/api/methods/sessions.ts";
import { createAgentApi } from "@/api/methods/agents.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { timeAgo } from "@/utils/format.ts";
import { getStatusStyle } from "@/utils/status.ts";
import { modLabel } from "@/utils/platform.ts";
import "./SessionManager.css";

export function SessionManager() {
  const client = useRpc();
  const projectPath = useUiStore((s) => s.projectPath);
  const focusSessions = useUiStore((s) => s.focusSessions);
  const switchSession = useSessionStore((s) => s.switchSession);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const endSession = useSessionStore((s) => s.endSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const list = await createSessionApi(client).list();
        if (!cancelled) setSessions(list);
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load sessions: ${getErrorMessage(e)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, projectPath]);

  const refresh = useCallback(async () => {
    try {
      const list = await createSessionApi(client).list();
      setSessions(list);
      setError(null);
    } catch (e) {
      setError(`Failed to load sessions: ${getErrorMessage(e)}`);
    }
  }, [client]);

  const handleContinue = useCallback(
    async (taskId: string) => {
      focusSessions();
      try {
        await useSessionStore.getState().continueSession(taskId);
      } catch (e) {
        console.error("Failed to continue session:", e);
        setError(`Failed to resume session: ${getErrorMessage(e)}`);
      }
    },
    [focusSessions],
  );

  const handleStop = useCallback(
    async (taskId: string) => {
      try {
        await createAgentApi(client).end(taskId);
        if (useSessionStore.getState().sessions.has(taskId)) {
          try { await endSession(taskId); } catch { /* ignore */ }
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.bonsaiSid === taskId ? { ...s, status: "done" as const } : s,
          ),
        );
      } catch (e) {
        console.error("Failed to stop session:", e);
      }
    },
    [client, endSession],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      try {
        await deleteSession(taskId);
        setSessions((prev) => prev.filter((s) => s.bonsaiSid !== taskId));
      } catch (e) {
        console.error("Failed to delete session:", e);
      }
    },
    [deleteSession],
  );

  const handleOpen = useCallback(
    async (taskId: string) => {
      focusSessions();
      try {
        if (useSessionStore.getState().sessions.has(taskId)) {
          switchSession(taskId);
        } else {
          await restoreSession(taskId);
        }
      } catch (e) {
        console.error("Failed to open session:", e);
        setError(`Failed to open session: ${getErrorMessage(e)}`);
      }
    },
    [focusSessions, switchSession, restoreSession],
  );

  if (loading) {
    return <div className="sm-loading">Loading sessions...</div>;
  }

  const active = sessions.filter(
    (s) => s.status === "idle" || s.status === "running",
  );
  const completed = sessions.filter((s) => s.status === "done");
  const errored = sessions.filter((s) => s.status === "error");

  return (
    <div className="session-manager">
      <div className="sm-header">
        <button className="sm-refresh" onClick={refresh} title="Refresh sessions">
          {"\u21BB"}
        </button>
      </div>

      <div className="sm-content">
        {error && <div className="sm-error">{error}</div>}

        {sessions.length === 0 && !error && (
          <div className="sm-empty">No sessions yet. Create one with {modLabel("T")}.</div>
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
        const badge = getStatusStyle(s.status);
        const isActive = s.status === "idle" || s.status === "running";
        const isDead = s.status === "done" || s.status === "error";
        return (
          <div key={`sm-${s.bonsaiSid}`} className="sm-card" onClick={() => onOpen(s.bonsaiSid)}>
            <div className="sm-card-top">
              <span className={`sm-badge ${badge.cls}`}>{badge.label}</span>
              <span className="sm-card-name">{s.name || s.bonsaiSid.slice(0, 8)}</span>
              <span className="sm-card-time">{timeAgo(s.createdAt)}</span>
            </div>
            <div className="sm-card-meta">
              {s.model && <span>{s.model}</span>}
            </div>
            {isActive && (
              <div className="sm-card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="sm-btn" onClick={() => onOpen(s.bonsaiSid)}>
                  Switch to
                </button>
                <button className="sm-btn sm-btn-stop" onClick={() => onStop(s.bonsaiSid)}>
                  Stop
                </button>
              </div>
            )}
            {isDead && (
              <div className="sm-card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="sm-btn sm-btn-continue" onClick={() => onContinue(s.bonsaiSid)}>
                  Continue
                </button>
                <button className="sm-btn sm-btn-delete" onClick={() => onDelete(s.bonsaiSid)}>
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
