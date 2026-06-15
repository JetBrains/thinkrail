import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import type { SessionMetrics, SessionStatus } from "@/types/session.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import type { EventCategory } from "./renderers/categories.ts";

// ── Static option lists ──────────────────────────────────────────────

const CATEGORY_LABELS: Record<EventCategory, string> = {
  dialog: "dialog",
  tools: "tools",
  system: "system",
};

interface StatusInfo { icon: ReactNode; label: string; cssClass: string }

/** Small lucide-style hourglass — minimal line art, theme-aware. */
const IconHourglass = () => (
  <svg
    className="ssl-status-icon"
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <path d="M5 22h14" />
    <path d="M5 2h14" />
    <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
  </svg>
);

function statusInfo(status: SessionStatus): StatusInfo {
  switch (status) {
    case "draft":
    case "initializing": return { icon: "✏",              label: status, cssClass: "idle" };
    case "running":      return { icon: "",                label: "running", cssClass: "running" };
    case "waiting":      return { icon: <IconHourglass />, label: "waiting", cssClass: "waiting" };
    case "idle":         return { icon: "💤",              label: "idle", cssClass: "idle" };
    case "interrupted":  return { icon: "⚡",              label: "interrupted", cssClass: "idle" };
    case "finished":
    case "done":
    case "error":        return { icon: "⏹",              label: status === "error" ? "error" : "done", cssClass: "ended" };
    default:             return { icon: "?",               label: status as string, cssClass: "idle" };
  }
}

// ── Reusable hooks ───────────────────────────────────────────────────

/** Dropdown open/close + outside-click handling, anchored to a wrapper ref. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return { open, ref, toggle, close } as const;
}

interface AnchoredPos { bottom: number; left: number }

/** Position a portaled popover *above* a trigger.  Right-aligned, clamped
 *  to the viewport, recomputed on scroll/resize.  Closes on outside click. */
function useAnchoredPopover(
  triggerRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  fallbackWidth = 320,
): AnchoredPos | null {
  const [pos, setPos] = useState<AnchoredPos | null>(null);

  const compute = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    const popWidth = popRef.current?.offsetWidth ?? fallbackWidth;
    let left = r.right - popWidth;
    if (left < margin) left = margin;
    if (left + popWidth > window.innerWidth - margin) {
      left = window.innerWidth - popWidth - margin;
    }
    setPos({ bottom: window.innerHeight - r.top + margin, left });
  }, [triggerRef, popRef, fallbackWidth]);

  useLayoutEffect(() => {
    if (open) compute();
    else setPos(null);
  }, [open, compute]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) onClose();
    };
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, compute, onClose, popRef, triggerRef]);

  return pos;
}

// ── Sub-components ───────────────────────────────────────────────────

interface ChipGroupProps<T> {
  label: string;
  items: ReadonlyArray<{ value: T; label: string }>;
  /** Equality predicate so callers control how "active" is matched
   *  (e.g., `value === current` or visibility-map lookup). */
  isActive: (value: T) => boolean;
  onSelect: (value: T) => void;
  disabled?: boolean;
  /** Strike-through inactive chips. Use for toggleable visibility groups
   *  ("hidden" semantics); leave off for single-select switchers. */
  strikeOff?: boolean;
}

function ChipGroup<T extends string | null>({ label, items, isActive, onSelect, disabled, strikeOff }: ChipGroupProps<T>) {
  return (
    <>
      <div className="ssl-more-group">{label}</div>
      <div className="ssl-more-chips">
        {items.map((item) => {
          const active = isActive(item.value);
          const offClass = strikeOff ? " ssl-chip-off ssl-chip-off-strike" : " ssl-chip-off";
          return (
            <button
              key={String(item.value ?? "_null")}
              className={`ssl-chip${active ? " ssl-chip-on" : offClass}`}
              disabled={disabled}
              onClick={() => onSelect(item.value)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

interface InfoStat { value: ReactNode; sub: string }

/** Tiny down-chevron icon — signals that a button opens a dropdown. */
const ChevronDown = () => (
  <svg
    className="ssl-chevron"
    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function InfoBlock({ label, stats }: { label: string; stats: InfoStat[] }) {
  return (
    <>
      <div className="ssl-more-group">{label}</div>
      {stats.map((s, i) => (
        <div key={i} className="ssl-more-stat-row">
          <span className="ssl-more-stat-val">{s.value}</span>
          <span className="ssl-more-stat-sub">{s.sub}</span>
        </div>
      ))}
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────

interface SessionStatusLineProps {
  model: string;
  permissionMode: string;
  effort: string;
  metrics: SessionMetrics;
  status: SessionStatus;
  disabled?: boolean;
  onChangeModel?: (model: string) => void;
  onChangePermissionMode?: (mode: string) => void;
  onChangeEffort?: (effort: string) => void;
  onInterrupt?: () => void;
  onEndSession?: () => void;
  onBackground?: () => void;
  onPromoteToTicket?: () => void;
  /** Ref-callback for the right-aligned slot where InputArea portals
   *  its session-action buttons (Continue / Start / Stop). */
  actionSlotRef?: (el: HTMLSpanElement | null) => void;
}

export function SessionStatusLine({
  model,
  permissionMode,
  effort,
  metrics,
  status,
  disabled,
  onChangeModel,
  onChangePermissionMode,
  onChangeEffort,
  onInterrupt,
  onEndSession,
  onBackground,
  onPromoteToTicket,
  actionSlotRef,
}: SessionStatusLineProps) {
  // ── Runtime capabilities (drives the pickers) ──
  const caps = useRuntimeCapsStore((s) => s.capsByRuntime["claude"]);
  const modelOptions = caps?.models ?? [];
  const permissionModes = caps?.permissionModes ?? [];
  const effortLevels = caps?.effortLevels ?? [];
  const categoryVisibility = useUiStore((s) => s.chatCategoryVisibility);
  const toggleCategory = useUiStore((s) => s.toggleChatCategory);

  // ── Derived flags ──
  const isStreaming = status === "running" || status === "waiting";
  const isTerminal = status === "finished" || status === "done" || status === "error" || status === "interrupted";
  const canInterrupt = isStreaming;
  const { icon: statusIcon, label: statusLabel, cssClass: statusClass } = statusInfo(status);

  const activeOption = modelOptions.find((o) => o.value === model);

  // ── Dropdowns (model, permission, status) ──
  const modelDd = useDropdown();
  const permDd = useDropdown();
  const statusDd = useDropdown();

  const activePermission = permissionModes.find((p) => p.value === permissionMode);

  // ── More popover (portaled to body — ancestors have overflow:hidden) ──
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const morePopRef = useRef<HTMLDivElement>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const morePos = useAnchoredPopover(moreTriggerRef, morePopRef, moreOpen, closeMore);

  // ── Context-token bar ──
  const contextPct =
    metrics.contextMax > 0 ? Math.round((metrics.contextTokens / metrics.contextMax) * 100) : 0;
  const contextColor =
    contextPct > 80 ? "var(--red)" : contextPct > 50 ? "var(--gold)" : "var(--green)";

  // Surface an out-of-caps active model (e.g. after a model retirement) as a
  // raw entry so the picker still shows what's selected.
  const modelDropdownOptions = activeOption
    ? modelOptions
    : [{ value: model, label: model }, ...modelOptions];

  const renderModelOption = (o: { value: string; label: string }) => (
    <button
      key={o.value}
      className={`ssl-dropdown-item${o.value === model ? " ssl-dropdown-active" : ""}`}
      onClick={() => {
        if (o.value !== model) onChangeModel?.(o.value);
        modelDd.close();
      }}
    >
      {o.label}
    </button>
  );

  return (
    <div className="session-status-line">
      {/* ── Model selector ── */}
      <div className="ssl-selector" ref={modelDd.ref}>
        <button
          className={`ssl-selector-btn${disabled ? " ssl-selector-disabled" : ""}`}
          onClick={() => !disabled && modelDd.toggle()}
          disabled={disabled}
        >
          {activeOption?.label ?? model}
          <ChevronDown />
        </button>
        {modelDd.open && (
          <div className="ssl-dropdown">
            {modelDropdownOptions.map(renderModelOption)}
          </div>
        )}
      </div>

      {/* ── Permission selector ── */}
      <span className="ssl-sep" />
      <div className="ssl-selector" ref={permDd.ref}>
        <button
          className={`ssl-selector-btn${disabled ? " ssl-selector-disabled" : ""}`}
          onClick={() => !disabled && permDd.toggle()}
          disabled={disabled}
          title="Permission mode"
        >
          {activePermission?.label ?? permissionMode}
          <ChevronDown />
        </button>
        {permDd.open && (
          <div className="ssl-dropdown">
            {permissionModes.map((m) => (
              <button
                key={m.value}
                className={`ssl-dropdown-item${m.value === permissionMode ? " ssl-dropdown-active" : ""}`}
                onClick={() => {
                  if (m.value !== permissionMode) onChangePermissionMode?.(m.value);
                  permDd.close();
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Context tokens (inline, next to permission) ── */}
      {metrics.contextMax > 0 && (
        <>
          <span className="ssl-sep" />
          <span
            className="ssl-context"
            title={`${metrics.contextTokens.toLocaleString()} tokens (${(
              metrics.contextUsage.cacheReadTokens + metrics.contextUsage.cacheCreationTokens
            ).toLocaleString()} cached)`}
          >
            {Math.round(metrics.contextTokens / 1000)}k/{Math.round(metrics.contextMax / 1000)}k
          </span>
          <span
            className="ssl-context-bar"
            style={{ "--pct": `${contextPct}%`, "--bar-color": contextColor } as React.CSSProperties}
          />
        </>
      )}

      <span className="ssl-sep" />

      {/* ── More options (⋯) — portaled popover ── */}
      <div className="ssl-selector">
        <button
          ref={moreTriggerRef}
          className="ssl-selector-btn ssl-more-btn"
          onClick={() => setMoreOpen((v) => !v)}
          title="Session options"
          aria-label="More session options"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
        >
          ⋯
        </button>
        {moreOpen && morePos && createPortal(
          <div
            ref={morePopRef}
            className="ssl-more-popover ssl-more-popover--portal"
            style={{ bottom: morePos.bottom, left: morePos.left }}
          >
            <section className="ssl-more-col">
              <div className="ssl-more-col-title">Settings</div>
              <ChipGroup
                label="Effort"
                items={effortLevels}
                isActive={(v) => v === effort}
                onSelect={(v) => onChangeEffort?.(v)}
                disabled={disabled}
              />
              <ChipGroup
                label="View"
                items={(Object.keys(CATEGORY_LABELS) as EventCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
                isActive={(v) => categoryVisibility[v]}
                onSelect={toggleCategory}
                strikeOff
              />
            </section>

            <section className="ssl-more-col ssl-more-col-info">
              <div className="ssl-more-col-title">Info</div>
              <InfoBlock
                label="Cost"
                stats={[
                  {
                    value: (
                      <span className={isStreaming ? "ssl-cost-active" : undefined}>
                        {isStreaming ? `~$${metrics.costUsd.toFixed(2)}` : `$${metrics.costUsd.toFixed(2)}`}
                      </span>
                    ),
                    sub: "session total",
                  },
                ]}
              />
              <InfoBlock
                label="Tool calls"
                stats={[{
                  value: (
                    <>
                      {isStreaming && <span className="ssl-pulse" />}
                      {metrics.toolCalls}
                    </>
                  ),
                  sub: isStreaming ? "in progress" : "completed",
                }]}
              />
              {metrics.contextMax > 0 && (
                <InfoBlock
                  label="Context"
                  stats={[{
                    value: `${Math.round(metrics.contextTokens / 1000)}k / ${Math.round(metrics.contextMax / 1000)}k`,
                    sub: `${contextPct}% used`,
                  }]}
                />
              )}
            </section>
          </div>,
          document.body,
        )}
      </div>

      {/* ── Status indicator (right-aligned via margin-left:auto) ── */}
      <div className="ssl-selector ssl-status-wrap" ref={statusDd.ref}>
        <button
          className={`ssl-selector-btn ssl-status ssl-status-${statusClass}`}
          onClick={() => !isTerminal && statusDd.toggle()}
          disabled={isTerminal}
        >
          {status === "running" && <span className="ssl-status-spinner" />}
          {statusIcon} {statusLabel}
          {!isTerminal && <ChevronDown />}
        </button>
        {statusDd.open && (
          <div className="ssl-dropdown ssl-dropdown-right">
            {canInterrupt && (
              <button className="ssl-dropdown-item" onClick={() => { onInterrupt?.(); statusDd.close(); }}>
                ■ Interrupt
              </button>
            )}
            <button className="ssl-dropdown-item" onClick={() => { onEndSession?.(); statusDd.close(); }}>
              ⏹ End session
            </button>
            <button className="ssl-dropdown-item" onClick={() => { onBackground?.(); statusDd.close(); }}>
              ↓ Background
            </button>
            {onPromoteToTicket && (
              <button className="ssl-dropdown-item" onClick={() => { onPromoteToTicket(); statusDd.close(); }}>
                ↑ Promote to ticket
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Slot for InputArea's action buttons (Continue / Start / Stop) ── */}
      <span className="ssl-action-slot" ref={actionSlotRef} />
    </div>
  );
}
