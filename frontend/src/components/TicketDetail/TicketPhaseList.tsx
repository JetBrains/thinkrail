import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { Ticket, TicketStatus, ArtifactKind } from "@/types/board.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import type { PlanModel } from "./planTypes.ts";
import { PHASE_LABELS, PHASE_ORDER, PHASE_SKILLS, STATE_ORDER } from "./phases.ts";
import "./TicketPhaseList.css";

// Re-export the phase constants from their shared home so existing importers
// (TicketInfo, TicketHistoryView, …) keep working via this module.
export { PHASE_ORDER, PHASE_SKILLS, STATE_ORDER } from "./phases.ts";

const PHASE_ARTIFACTS: Record<TicketStatus, ArtifactKind | null> = {
  idea: null,
  "product-design": "product_design",
  "technical-design": "technical_design",
  // amend-specs: no canonical artifact. Surface its changes via the per-phase
  // Changes (N) entry that uses the history log.
  "amend-specs": null,
  "implementation-plan": "implementation_plan",
  // implementing shares the plan with implementation-plan: the same
  // implementation-plan.md file appears as a sub-row under both, so the
  // user can open the plan from either phase.
  implementing: "implementation_plan",
  done: null,
};

interface PhaseDef {
  key: TicketStatus;
  label: string;
  skill: string | null;
  artifact: ArtifactKind | null;
}

const PHASES: PhaseDef[] = PHASE_ORDER.map((key) => ({
  key,
  label: PHASE_LABELS[key],
  skill: PHASE_SKILLS[key],
  artifact: PHASE_ARTIFACTS[key],
}));

/**
 * The current phase = `ticket.status`. Status is "ongoing work":
 *   - status="idea" → idea is the current phase (user has the idea, nothing started)
 *   - status="product-design" → product design is currently being worked on
 *   - status="technical-design" → technical design is currently being worked on
 *   - ... etc.
 *   - status="done" → everything finished
 *
 * The bootstrap rule (when status="idea", the `[Run]` CTA renders on the
 * `product-design` row, not on `idea`) is a button-placement rule below, not
 * a state derivation. Status transitions forward via the UI Run click (one
 * step) and via the skill's closing `ChangeTicketStatus(next)` call.
 */
export function computeCurrentPhase(ticket: Ticket): TicketStatus {
  return ticket.status;
}

const SKIPPABLE: ReadonlySet<TicketStatus> = new Set<TicketStatus>([
  "product-design",
  "technical-design",
  "amend-specs",
  "implementation-plan",
  "implementing",
]);

type RowState = "past" | "skipped" | "current" | "future";

function rowState(
  phase: TicketStatus,
  ticket: Ticket,
  currentPhase: TicketStatus,
): RowState {
  if (ticket.skippedPhases.includes(phase)) return "skipped";
  if (phase === currentPhase) return "current";
  if (STATE_ORDER[phase] < STATE_ORDER[currentPhase]) return "past";
  return "future";
}

function stateGlyph(state: RowState): string {
  switch (state) {
    case "past":    return "✓"; // ✓
    case "skipped": return "✗"; // ✗
    case "current": return "●"; // ●
    case "future":  return "○"; // ○
  }
}

export interface PhaseArtifact {
  /** Display path (clickable: opens in Monaco) */
  path: string;
  label?: string;
}

export interface PhasePlanStep {
  number: number;
  title: string;
  status: string;
  sessionId?: string | null;
  /** Set when the step ran as a subagent (Task tool call inside the
   *  orchestrator session). Click → scroll the orchestrator chat to
   *  this event. Mutually exclusive with sessionId. */
  eventIndex?: number | null;
}

export interface SessionTodoSnapshot {
  todos: { key: string; content: string; status: string }[];
  touchByKey: Map<string, number>;
}

/** What the phase-list emits when a row, sub-row, or task item is clicked.
 *  The parent (TicketInfo) routes "session" to the center-column chat and
 *  the rest to the right-panel artifact selection. */
export type PhaseListEmit =
  | { type: "session"; sessionId: string }
  | { type: "artifact"; kind: ArtifactKind }
  | { type: "plan" }
  | { type: "file"; filePath: string }
  | { type: "history"; phaseFilter?: TicketStatus };

interface Props {
  ticket: Ticket;
  plan: PlanModel | null;
  phaseSessionIds: Partial<Record<TicketStatus, string>>;
  phaseSessionArtifacts: Partial<Record<TicketStatus, PhaseArtifact[]>>;
  historyCountByPhase: Partial<Record<TicketStatus, number>>;
  /** Unique spec file paths touched during amend-specs (derived from
   *  the per-ticket history log). Drives the "Changed specs (N)"
   *  expandable sub-row under amend-specs. */
  amendSpecsFiles: string[];
  sessionTodoState: Map<string, SessionTodoSnapshot>;
  onStartSession: (skillId: string, opts?: { previewPath?: string }) => void;
  onSelectPanel: (panel: PhaseListEmit) => void;
  onScrollSessionToEvent: (bonsaiSid: string, eventIndex: number) => void;
}

const LABELS_BY_ARTIFACT: Record<ArtifactKind, string> = {
  product_design: "product-design.md",
  technical_design: "technical-design.md",
  history: "amendments.diff",
  implementation_plan: "implementation-plan.md",
};

export function TicketPhaseList({
  ticket,
  plan,
  phaseSessionIds,
  phaseSessionArtifacts,
  historyCountByPhase,
  amendSpecsFiles,
  sessionTodoState,
  onStartSession,
  onSelectPanel,
  onScrollSessionToEvent,
}: Props) {
  const liveSessions = useSessionStore((s) => s.sessions);
  const skipPhase = useBoardStore((s) => s.skipPhase);
  const unskipPhase = useBoardStore((s) => s.unskipPhase);
  const updateTicket = useBoardStore((s) => s.updateTicket);

  const orchestratorLive =
    ticket.orchestratorSessionId != null && liveSessions.has(ticket.orchestratorSessionId);

  const handleRun = useCallback((skill: string) => onStartSession(skill), [onStartSession]);
  const handleSkip = useCallback(
    async (phase: TicketStatus) => {
      await skipPhase(ticket.id, phase);
    },
    [skipPhase, ticket.id],
  );
  const handleUnskip = useCallback(
    async (phase: TicketStatus) => {
      await unskipPhase(ticket.id, phase);
    },
    [unskipPhase, ticket.id],
  );
  const handleMarkComplete = useCallback(async () => {
    await updateTicket(ticket.id, { status: "done" });
  }, [updateTicket, ticket.id]);
  const handleContinue = useCallback(() => {
    if (ticket.orchestratorSessionId) {
      onSelectPanel({ type: "session", sessionId: ticket.orchestratorSessionId });
    }
  }, [onSelectPanel, ticket.orchestratorSessionId]);

  const artifactPathMap: Record<ArtifactKind, string | null | undefined> = {
    product_design: ticket.productDesignPath,
    technical_design: ticket.technicalDesignPath,
    history: ticket.historyPath,
    implementation_plan: ticket.implementationPlanPath,
  };

  const artifactStaleMap: Record<ArtifactKind, boolean> = {
    product_design: false,
    technical_design: ticket.technicalDesignStale,
    history: ticket.historyStale,
    implementation_plan: ticket.implementationPlanStale,
  };

  const currentPhase = computeCurrentPhase(ticket);

  const [expanded, setExpanded] = useState<Partial<Record<TicketStatus, boolean>>>(() => ({}));
  const toggleExpand = useCallback((p: TicketStatus) => {
    setExpanded((prev) => ({ ...prev, [p]: !prev[p] }));
  }, []);

  const [tasksExpanded, setTasksExpanded] = useState<Partial<Record<TicketStatus, boolean>>>(() => ({}));
  const toggleTasksExpanded = useCallback((p: TicketStatus) => {
    setTasksExpanded((prev) => ({ ...prev, [p]: !prev[p] }));
  }, []);

  const [changedSpecsExpanded, setChangedSpecsExpanded] = useState(false);

  // Auto-expand the current phase row once (when currentPhase changes and
  // user hasn't expressed a preference yet).
  useEffect(() => {
    setExpanded((prev) => {
      if (prev[currentPhase] !== undefined) return prev;
      return { ...prev, [currentPhase]: true };
    });
  }, [currentPhase]);

  return (
    <div className="ticket-section">
      <div className="ticket-section-header">
        <span className="ticket-section-title">Progress</span>
      </div>
      <div className="tpl">
        {PHASES.map((phase) => {

          const state = rowState(phase.key, ticket, currentPhase);
          const isCurrent = state === "current";
          const isSkipped = state === "skipped";
          const isPast = state === "past";
          const isFuture = state === "future";
          const sid = phaseSessionIds[phase.key];
          const hasSession = sid != null;
          const sessionArts = phaseSessionArtifacts[phase.key] ?? [];

          const canonicalPath = phase.artifact ? artifactPathMap[phase.artifact] ?? null : null;
          const canonicalStale = phase.artifact ? artifactStaleMap[phase.artifact] : false;

          // Step-row rendering migrated to PlanCard inside ImplementationPhaseRow.
          // Other phases never render plan steps; keep the array empty for the
          // child-count math below.
          const isImplPlan = false;
          const stepRows: PhasePlanStep[] = [];

          // Dedup canonical artifact + session-touched artifacts robustly:
          //  - exact match (typical when backend has normalized everything)
          //  - suffix match (covers legacy entries where one side is absolute
          //    and the other is project-relative)
          const sameFile = (a: string, b: string) =>
            a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
          const seenPaths = new Set<string>();
          const dedupedSessionArts = sessionArts.filter((a) => {
            if (canonicalPath && sameFile(a.path, canonicalPath)) return false;
            // Dedup within session artifacts too (both absolute + relative of the same file).
            for (const seen of seenPaths) {
              if (sameFile(a.path, seen)) return false;
            }
            seenPaths.add(a.path);
            return true;
          });
          const changesCount = historyCountByPhase[phase.key] ?? 0;
          const isAmendSpecs = phase.key === "amend-specs";
          // amend-specs hides individual spec files from the artifact list:
          // they live behind "Changed specs (N)" + "Amendments (N)" subs.
          const visibleSessionArts = isAmendSpecs ? [] : dedupedSessionArts;
          const showAmendments = isAmendSpecs && changesCount > 0;
          const showChangedSpecs = isAmendSpecs && amendSpecsFiles.length > 0;
          // "Changes (N)" sub-row only renders for non-amend-specs phases —
          // amend-specs uses its own dedicated "Amendments" entry instead.
          const showChangesRow = !isAmendSpecs && changesCount > 0;
          // Implementing row surfaces plan steps as sub-rows so the user can
          // jump into each step session from the tree. The orchestrator
          // session itself shows via the existing "session" sub-row.
          const planSteps = phase.key === "implementing"
            ? (plan?.milestones.flatMap((m) => m.steps) ?? [])
            : [];
          const showPlanSteps = planSteps.length > 0;
          const todoSnapshot = sid ? sessionTodoState.get(sid) ?? null : null;
          const todoTotal = todoSnapshot?.todos.length ?? 0;
          const todoDone = todoSnapshot?.todos.filter((t) => t.status === "completed").length ?? 0;
          const hasTodos = todoTotal > 0;
          const tasksExpand = hasTodos && tasksExpanded[phase.key] === true;
          const childCount =
            (canonicalPath ? 1 : 0)
            + visibleSessionArts.length
            + stepRows.length
            + (showAmendments ? 1 : 0)
            + (showChangedSpecs ? 1 : 0)
            + (showChangesRow ? 1 : 0)
            + (showPlanSteps ? planSteps.length : 0)
            + (hasTodos ? 1 : 0)
            + (hasSession ? 1 : 0);
          const canExpand = childCount > 0;
          const isExpanded = canExpand && expanded[phase.key] === true;

          // A past phase reachable only via skip→unskip never produced a
          // session or artifact. Treat its row like a fresh start.
          const isPastUnstarted = isPast && phase.skill && !hasSession;

          // ── Row body click: open session if present; else canonical
          //    artifact; else (past+unstarted) start a session ─
          const handleRowClick = () => {
            if (hasSession && sid) {
              onSelectPanel({ type: "session", sessionId: sid });
              return;
            }
            if (canonicalPath && phase.artifact) {
              onSelectPanel({ type: "artifact", kind: phase.artifact });
              return;
            }
            if (isPastUnstarted && phase.skill) {
              handleRun(phase.skill);
            }
          };

          const showRun =
            (isCurrent && phase.key !== "done" && phase.key !== "idea" && phase.skill)
            || (isFuture && phase.key === "product-design" && currentPhase === "idea")
            || isPastUnstarted;
          // Past rows with a session → Refine (opens that session).
          // Skipped rows → Back (just un-skips; user can then Run if desired).
          const showRefine = isPast && phase.skill && hasSession;
          const showBack = isSkipped && phase.skill;
          const showSkip = (isCurrent || isFuture) && SKIPPABLE.has(phase.key);
          const showMarkComplete =
            phase.key === "done" && ticket.status === "implementing";

          const runHandler = () => {
            if (phase.key === "implementing" && orchestratorLive) {
              handleContinue();
            } else if (phase.skill) {
              handleRun(phase.skill);
            }
          };

          return (
            <div key={phase.key}>
              <div className={`tpl-row tpl-row--${state} ${canExpand ? "tpl-row--expandable" : ""}`}>
                <span className="tpl-glyph">{stateGlyph(state)}</span>
                <span
                  className={`tpl-label ${(hasSession || canonicalPath || isPastUnstarted) ? "tpl-label--clickable" : ""}`}
                  onClick={handleRowClick}
                  title={
                    hasSession
                      ? "Open session"
                      : canonicalPath
                        ? "Open artifact"
                        : isPastUnstarted
                          ? "Run this stage"
                          : undefined
                  }
                >
                  {phase.label}
                </span>
                {changesCount > 0 && !isExpanded && (
                  <span
                    className="tpl-changes-badge"
                    title={`${changesCount} amendment${changesCount !== 1 ? "s" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPanel({ type: "history", phaseFilter: phase.key });
                    }}
                  >
                    Δ{changesCount}
                  </span>
                )}
                <span className="tpl-spacer" />
                {showRefine && (
                  <button
                    className="tpl-icon-btn tpl-icon-btn--refine"
                    title="Re-run this stage"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRun(phase.skill!);
                    }}
                  >
                    {"↻"}
                  </button>
                )}
                {showBack && (
                  <button
                    className="tpl-icon-btn tpl-icon-btn--back"
                    title="Un-skip this phase"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnskip(phase.key);
                    }}
                  >
                    {"⇺"}
                  </button>
                )}
                {showRun && (
                  <button
                    className="tpl-icon-btn tpl-icon-btn--cta"
                    title={hasSession ? "Continue" : "Run with AI"}
                    onClick={(e) => {
                      e.stopPropagation();
                      runHandler();
                    }}
                  >
                    {"▶"}
                  </button>
                )}
                {showMarkComplete && (
                  <button
                    className="tpl-icon-btn tpl-icon-btn--done"
                    title="Mark complete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarkComplete();
                    }}
                  >
                    {"✓"}
                  </button>
                )}
                {showSkip && (
                  <button
                    className="tpl-icon-btn"
                    title="Skip"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSkip(phase.key);
                    }}
                  >
                    {"✗"}
                  </button>
                )}
                {canExpand && (
                  <button
                    className="tpl-chevron"
                    title={isExpanded ? "Collapse" : "Expand"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(phase.key);
                    }}
                  >
                    {isExpanded ? "▾" : "▸"}
                  </button>
                )}
              </div>
              {isExpanded && (
                <div className="tpl-children">
                  {canonicalPath && phase.artifact && (
                    <ArtifactSubRow
                      path={canonicalPath}
                      label={LABELS_BY_ARTIFACT[phase.artifact]}
                      stale={canonicalStale}
                      onEdit={() => onSelectPanel({ type: "file", filePath: canonicalPath })}
                      onEditWithAI={
                        phase.skill
                          ? () => onStartSession(phase.skill!, { previewPath: canonicalPath })
                          : undefined
                      }
                    />
                  )}
                  {visibleSessionArts.map((a) => (
                    <ArtifactSubRow
                      key={a.path}
                      path={a.path}
                      label={a.label}
                      stale={false}
                      onEdit={() => onSelectPanel({ type: "file", filePath: a.path })}
                      onEditWithAI={
                        phase.skill
                          ? () => onStartSession(phase.skill!, { previewPath: a.path })
                          : undefined
                      }
                    />
                  ))}
                  {isImplPlan && stepRows.map((step) => (
                    <StepSubRow
                      key={step.number}
                      step={step}
                      onClick={() =>
                        step.sessionId
                          ? onSelectPanel({ type: "session", sessionId: step.sessionId })
                          : onSelectPanel({ type: "plan" })
                      }
                    />
                  ))}
                  {showAmendments && (
                    <div
                      className="tpl-sub-row tpl-sub-row--clickable"
                      onClick={() => onSelectPanel({ type: "history", phaseFilter: "amend-specs" })}
                    >
                      <span className="tpl-sub-arrow">{"└→"}</span>
                      <span className="tpl-sub-label">Amendments ({changesCount})</span>
                    </div>
                  )}
                  {showChangedSpecs && (
                    <>
                      <div
                        className="tpl-sub-row tpl-sub-row--clickable"
                        onClick={() => setChangedSpecsExpanded((v) => !v)}
                      >
                        <span className="tpl-sub-arrow">{"└→"}</span>
                        <span className="tpl-sub-label">Changed specs ({amendSpecsFiles.length})</span>
                        <span className="tpl-spacer" />
                        <span className="tpl-sub-chev">{changedSpecsExpanded ? "▾" : "▸"}</span>
                      </div>
                      {changedSpecsExpanded && (
                        <div className="tpl-task-list">
                          {amendSpecsFiles.map((path) => (
                            <div
                              key={path}
                              className="tpl-task-item"
                              title={path}
                              onClick={() => onSelectPanel({ type: "file", filePath: path })}
                            >
                              <FileText size={12} strokeWidth={1.5} className="tpl-task-glyph" />
                              <span className="tpl-task-text">{path.split("/").pop() ?? path}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {showChangesRow && (
                    <div
                      className="tpl-sub-row tpl-sub-row--clickable"
                      onClick={() => onSelectPanel({ type: "history", phaseFilter: phase.key })}
                    >
                      <span className="tpl-sub-arrow">{"└→"}</span>
                      <span className="tpl-sub-label">Changes ({changesCount})</span>
                    </div>
                  )}
                  {hasTodos && sid && todoSnapshot && (
                    <>
                      <div
                        className="tpl-sub-row tpl-sub-row--clickable"
                        onClick={() => toggleTasksExpanded(phase.key)}
                      >
                        <span className="tpl-sub-arrow">{"└→"}</span>
                        <span className="tpl-sub-label">Tasks ({todoDone}/{todoTotal})</span>
                        <span className="tpl-spacer" />
                        <span className="tpl-sub-chev">{tasksExpand ? "▾" : "▸"}</span>
                      </div>
                      {tasksExpand && (
                        <div className="tpl-task-list">
                          {todoSnapshot.todos.map((t, i) => {
                            const glyph =
                              t.status === "completed" ? "✓"
                              : t.status === "in_progress" ? "◉"
                              : "○";
                            const cls =
                              t.status === "completed" ? "tpl-task-item--done"
                              : t.status === "in_progress" ? "tpl-task-item--running"
                              : "tpl-task-item--pending";
                            const eventIdx = todoSnapshot.touchByKey.get(t.key);
                            return (
                              <div
                                key={t.key + i}
                                className={`tpl-task-item ${cls}`}
                                onClick={() => {
                                  if (eventIdx != null) {
                                    onScrollSessionToEvent(sid, eventIdx);
                                  } else {
                                    onSelectPanel({ type: "session", sessionId: sid });
                                  }
                                }}
                              >
                                <span className="tpl-task-glyph">{glyph}</span>
                                <span className="tpl-task-text">{t.content}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  {hasSession && sid && (
                    <div
                      className="tpl-sub-row tpl-sub-row--session"
                      onClick={() => onSelectPanel({ type: "session", sessionId: sid })}
                    >
                      <span className="tpl-sub-arrow">{"└→"}</span>
                      <span className="tpl-sub-label">session</span>
                    </div>
                  )}
                  {showPlanSteps && planSteps.map((step) => {
                    const glyph =
                      step.status === "done" ? "✓"
                      : step.status === "executing" ? "●"
                      : step.status === "failed" ? "✗"
                      : "○";
                    const cls =
                      step.status === "done" ? "tpl-task-item--done"
                      : step.status === "executing" ? "tpl-task-item--running"
                      : "tpl-task-item--pending";
                    const stepLabel = `Step ${step.number}: ${step.title}`;
                    // session_id (step-session mode) and event_index (subagent
                    // mode) are mutually exclusive; either or neither is set.
                    const orchestratorSid = ticket.orchestratorSessionId;
                    const navTarget: "session" | "event" | "none" =
                      step.sessionId ? "session"
                      : (step.eventIndex != null && orchestratorSid) ? "event"
                      : "none";
                    const titleSuffix = navTarget === "none" ? " (not started)" : "";
                    return (
                      <div
                        key={`step-${step.number}`}
                        className={`tpl-task-item ${cls}`}
                        title={stepLabel + titleSuffix}
                        onClick={() => {
                          if (navTarget === "session") {
                            onSelectPanel({ type: "session", sessionId: step.sessionId! });
                          } else if (navTarget === "event") {
                            onScrollSessionToEvent(orchestratorSid!, step.eventIndex!);
                          }
                        }}
                        style={navTarget === "none" ? { cursor: "default", opacity: 0.7 } : undefined}
                      >
                        <span className="tpl-task-glyph">{glyph}</span>
                        <span className="tpl-task-text">{stepLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ArtifactSubRowProps {
  path: string;
  label?: string;
  stale: boolean;
  onEdit: () => void;
  onEditWithAI?: () => void;
}

function ArtifactSubRow({ path, label, stale, onEdit, onEditWithAI }: ArtifactSubRowProps) {
  return (
    <div className="tpl-sub-row">
      <span className="tpl-sub-arrow">{"└→"}</span>
      <span
        className="tpl-sub-label tpl-sub-label--clickable"
        title={path}
        onClick={onEdit}
      >
        {label ?? path}
      </span>
      {stale && <span className="tpl-sub-stale">~ stale</span>}
      <span className="tpl-spacer" />
      {onEditWithAI && (
        <button className="tpl-sub-btn" onClick={onEditWithAI}>ai</button>
      )}
    </div>
  );
}

interface StepSubRowProps {
  step: PhasePlanStep;
  onClick: () => void;
}

function StepSubRow({ step, onClick }: StepSubRowProps) {
  return (
    <div className="tpl-sub-row tpl-sub-row--clickable" onClick={onClick}>
      <span className="tpl-sub-arrow">{"└→"}</span>
      <span className="tpl-sub-label">{step.number}. {step.title}</span>
      <span className="tpl-spacer" />
      <span className={`tpl-sub-status tpl-sub-status--${step.status}`}>{step.status}</span>
    </div>
  );
}
