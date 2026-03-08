import { useState, useRef, useEffect, useCallback } from "react";
import type { SessionMetrics, SessionStatus } from "@/types/session.ts";

const MODELS = [
  { value: "claude-opus-4-6", label: "opus-4-6" },
  { value: "claude-sonnet-4-6", label: "sonnet-4-6" },
  { value: "claude-haiku-4-5-20251001", label: "haiku-4-5" },
];

const PERMISSION_MODES = [
  { value: "default", label: "default" },
  { value: "acceptEdits", label: "accept edits" },
  { value: "bypassPermissions", label: "yolo" },
  { value: "plan", label: "plan" },
];

function displayModel(model: string): string {
  return MODELS.find((m) => m.value === model)?.label ?? model;
}

function displayMode(mode: string): string {
  return PERMISSION_MODES.find((m) => m.value === mode)?.label ?? mode;
}

function statusInfo(status: SessionStatus): { icon: string; label: string; cssClass: string } {
  switch (status) {
    case "running":
      return { icon: "", label: "running", cssClass: "running" };
    case "waiting":
      return { icon: "\u23F3", label: "waiting", cssClass: "waiting" };
    case "idle":
      return { icon: "\uD83D\uDCA4", label: "idle", cssClass: "idle" };
    case "interrupted":
      return { icon: "\u23F8", label: "interrupted", cssClass: "interrupted" };
    case "done":
    case "error":
      return { icon: "\u23F9", label: "ended", cssClass: "ended" };
  }
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return { open, ref, toggle, close } as const;
}

interface SessionStatusLineProps {
  model: string;
  permissionMode: string;
  metrics: SessionMetrics;
  status: SessionStatus;
  projectCost: number;
  disabled?: boolean;
  onChangeModel?: (model: string) => void;
  onChangePermissionMode?: (mode: string) => void;
}

export function SessionStatusLine({
  model,
  permissionMode,
  metrics,
  status,
  projectCost,
  disabled,
  onChangeModel,
  onChangePermissionMode,
}: SessionStatusLineProps) {
  const running = status === "running";
  const { icon: statusIcon, label: statusLabel, cssClass: statusClass } = statusInfo(status);
  const modelDd = useDropdown();
  const modeDd = useDropdown();

  const contextPct =
    metrics.contextMax > 0
      ? Math.round((metrics.contextTokens / metrics.contextMax) * 100)
      : 0;
  const contextColor =
    contextPct > 80
      ? "var(--red)"
      : contextPct > 50
        ? "var(--gold)"
        : "var(--green)";

  return (
    <div className="session-status-line">
      <div className="ssl-selector" ref={modelDd.ref}>
        <button
          className={`ssl-selector-btn${disabled ? " ssl-selector-disabled" : ""}`}
          onClick={() => !disabled && modelDd.toggle()}
          disabled={disabled}
        >
          {displayModel(model)}
        </button>
        {modelDd.open && (
          <div className="ssl-dropdown">
            {MODELS.map((m) => (
              <button
                key={m.value}
                className={`ssl-dropdown-item${m.value === model ? " ssl-dropdown-active" : ""}`}
                onClick={() => {
                  if (m.value !== model) onChangeModel?.(m.value);
                  modelDd.close();
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="ssl-sep" />
      <div className="ssl-selector" ref={modeDd.ref}>
        <button
          className={`ssl-selector-btn${disabled ? " ssl-selector-disabled" : ""}`}
          onClick={() => !disabled && modeDd.toggle()}
          disabled={disabled}
        >
          {displayMode(permissionMode)}
        </button>
        {modeDd.open && (
          <div className="ssl-dropdown">
            {PERMISSION_MODES.map((m) => (
              <button
                key={m.value}
                className={`ssl-dropdown-item${m.value === permissionMode ? " ssl-dropdown-active" : ""}`}
                onClick={() => {
                  if (m.value !== permissionMode) onChangePermissionMode?.(m.value);
                  modeDd.close();
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="ssl-sep" />
      <span className="ssl-cost">${metrics.costUsd.toFixed(2)} | ${projectCost.toFixed(2)}</span>
      <span className="ssl-sep" />
      <span className="ssl-tools">
        {running && <span className="ssl-pulse" />}
        {metrics.toolCalls} calls
      </span>
      {metrics.contextMax > 0 && (
        <>
          <span className="ssl-sep" />
          <span className="ssl-context">
            ctx {Math.round(metrics.contextTokens / 1000)}k/
            {Math.round(metrics.contextMax / 1000)}k
          </span>
          <span
            className="ssl-context-bar"
            style={
              {
                "--pct": `${contextPct}%`,
                "--bar-color": contextColor,
              } as React.CSSProperties
            }
          />
        </>
      )}
      <span className="ssl-sep" />
      <span className={`ssl-status ssl-status-${statusClass}`}>
        {status === "running" && <span className="ssl-status-spinner" />}
        {statusIcon} {statusLabel}
      </span>
    </div>
  );
}
