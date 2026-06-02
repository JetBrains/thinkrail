import { useCallback, useEffect, useMemo, useState } from "react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { MarkdownEditor } from "@/components/MarkdownEditor/MarkdownEditor.tsx";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";

interface PlanStepView {
  number: number;
  title: string;
  status: string;
  skill: string;
  dependsOn: number[];
  inputSpecIds: string[];
  sessionId?: string | null;
  agentInstructions?: string;
  successCriteria: { text: string; checked: boolean }[];
}

interface MilestoneView {
  number: number;
  title: string;
  description?: string;
  steps: PlanStepView[];
}

interface TicketPlanViewProps {
  plan: Record<string, unknown> | null;
  ticketId: string;
  onPlanUpdated: (plan: Record<string, unknown>) => void;
}

type PlanTab = "status" | "steps" | "raw";

function stepStatusIcon(status: string): string {
  switch (status) {
    case "done": return "\u2713";
    case "executing": return "\u25CF";
    case "failed": return "\u2717";
    default: return "\u25CB";
  }
}

function stepStatusClass(status: string): string {
  switch (status) {
    case "done": return "ticket-linked-status--done";
    case "executing": return "ticket-linked-status--active";
    case "failed": return "ticket-linked-status--failed";
    default: return "";
  }
}

// ── View Tab (read-only) ──

function PlanStatusTab({ milestones, verification }: {
  milestones: MilestoneView[];
  verification: { text: string; checked: boolean }[];
}) {
  const ticket = useTicketRouteStore((s) => s.ticket);
  const orchestratorSid = ticket?.orchestratorSessionId ?? null;
  const setCenterSessionId = useTicketRouteStore((s) => s.setCenterSessionId);
  const liveSessions = useSessionStore((s) => s.sessions);

  const allSteps = useMemo(
    () => milestones.flatMap((m) => m.steps ?? []),
    [milestones],
  );
  const totalSteps = allSteps.length;
  const doneSteps = allSteps.filter((s) => s.status === "done").length;
  const failedSteps = allSteps.filter((s) => s.status === "failed");
  const runningSteps = allSteps.filter((s) => s.status === "executing");

  const orchestratorSession = orchestratorSid ? liveSessions.get(orchestratorSid) : null;

  return (
    <div className="ticket-plan-content">
      {failedSteps.length > 0 && (
        <div className="ticket-plan-attention">
          <span className="ticket-plan-attention-glyph">!</span>
          <span className="ticket-plan-attention-text">
            {failedSteps.length === 1
              ? `Step ${failedSteps[0].number} failed \u2014 needs attention.`
              : `${failedSteps.length} steps failed \u2014 needs attention.`}
          </span>
        </div>
      )}

      {orchestratorSid && (
        <div
          className="ticket-plan-orchestrator"
          onClick={() => setCenterSessionId(orchestratorSid)}
          title="Open orchestrator session"
        >
          <span className="ticket-plan-orchestrator-label">Orchestrator</span>
          <span className="ticket-plan-orchestrator-name">
            {orchestratorSession?.name ?? orchestratorSid.slice(0, 8)}
          </span>
          <span
            className={`ticket-linked-status ${stepStatusClass(
              orchestratorSession?.status === "running" ? "executing"
              : orchestratorSession?.status === "done" ? "done"
              : orchestratorSession?.status === "error" ? "failed" : "",
            )}`}
          >
            {orchestratorSession?.status ?? "idle"}
          </span>
        </div>
      )}

      {totalSteps > 0 && (
        <div className="ticket-plan-progress">
          {doneSteps}/{totalSteps} steps done
          {runningSteps.length > 0 && ` \u00b7 ${runningSteps.length} running`}
        </div>
      )}

      {allSteps.length === 0 ? (
        <div className="ticket-placeholder">No steps defined yet. Switch to Steps or Raw tab to add content.</div>
      ) : (
        <>
          {milestones.map((milestone) => (
            <div key={milestone.number}>
              {milestones.length > 1 && (
                <div className="ticket-plan-milestone-header">
                  Milestone {milestone.number}: {milestone.title}
                </div>
              )}
              {(milestone.steps ?? []).map((step) => {
                const stepSession = step.sessionId ? liveSessions.get(step.sessionId) : null;
                const isFailed = step.status === "failed";
                const isRunning = step.status === "executing";
                return (
                  <div
                    key={step.number}
                    className={`ticket-plan-step${isFailed ? " ticket-plan-step--failed" : ""}${isRunning ? " ticket-plan-step--running" : ""}`}
                  >
                    <div className="ticket-plan-step-header">
                      <span className="ticket-plan-step-icon">{stepStatusIcon(step.status)}</span>
                      <span className="ticket-plan-step-title">
                        Step {step.number}: {step.title}
                      </span>
                      <span className={`ticket-linked-status ${stepStatusClass(step.status)}`}>
                        {step.status}
                      </span>
                    </div>
                    {step.sessionId && stepSession && (
                      <div
                        className="ticket-plan-step-session"
                        onClick={() => setCenterSessionId(step.sessionId!)}
                        title="Open step session"
                      >
                        in session: {stepSession.name ?? step.sessionId.slice(0, 8)}
                      </div>
                    )}
                    {step.skill !== "default" && (
                      <div className="ticket-plan-step-meta">Skill: {step.skill}</div>
                    )}
                    {step.dependsOn.length > 0 && (
                      <div className="ticket-plan-step-meta">
                        Depends on: {step.dependsOn.map((d) => `Step ${d}`).join(", ")}
                      </div>
                    )}
                    {step.successCriteria.length > 0 && (
                      <div className="ticket-plan-criteria">
                        {step.successCriteria.map((c, i) => (
                          <div key={i} className="ticket-plan-criterion">
                            <span>{c.checked ? "\u2611" : "\u2610"}</span>
                            <span>{c.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {verification.length > 0 && (
            <div className="ticket-plan-verification">
              <div className="ticket-section-title" style={{ marginBottom: "var(--space-sm)" }}>
                Verification
              </div>
              {verification.map((c, i) => (
                <div key={i} className="ticket-plan-criterion">
                  <span>{c.checked ? "\u2611" : "\u2610"}</span>
                  <span>{c.text}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Steps Tab (structured editing) ──

function PlanStepsTab({ milestones, verification, ticketId, planTitle, planStatus, onSave }: {
  milestones: MilestoneView[];
  verification: { text: string; checked: boolean }[];
  ticketId: string;
  planTitle: string;
  planStatus: string;
  onSave: (plan: Record<string, unknown>) => void;
}) {
  const [editMilestones, setEditMilestones] = useState<MilestoneView[]>(milestones);
  const [editVerification, setEditVerification] = useState(verification);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setEditMilestones(milestones); }, [milestones]);
  useEffect(() => { setEditVerification(verification); }, [verification]);

  const updateStep = (mIdx: number, sIdx: number, updates: Partial<PlanStepView>) => {
    setEditMilestones((prev) => prev.map((m, mi) =>
      mi !== mIdx ? m : {
        ...m,
        steps: m.steps.map((s, si) => si !== sIdx ? s : { ...s, ...updates }),
      },
    ));
  };

  const addStep = (mIdx: number) => {
    setEditMilestones((prev) => {
      const allSteps = prev.flatMap((m) => m.steps);
      const maxNum = allSteps.reduce((max, s) => Math.max(max, s.number), 0);
      return prev.map((m, mi) =>
        mi !== mIdx ? m : {
          ...m,
          steps: [...m.steps, {
            number: maxNum + 1,
            title: "",
            status: "pending",
            skill: "default",
            dependsOn: [],
            inputSpecIds: [],
            successCriteria: [],
          }],
        },
      );
    });
  };

  const removeStep = (mIdx: number, sIdx: number) => {
    setEditMilestones((prev) => prev.map((m, mi) =>
      mi !== mIdx ? m : { ...m, steps: m.steps.filter((_, si) => si !== sIdx) },
    ));
  };

  const addMilestone = () => {
    const maxNum = editMilestones.reduce((max, m) => Math.max(max, m.number), 0);
    setEditMilestones((prev) => [...prev, { number: maxNum + 1, title: "", steps: [] }]);
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const api = createBoardApi(getClient());
      const result = await api.savePlan(ticketId, {
        title: planTitle,
        status: planStatus,
        milestones: editMilestones,
        verification: editVerification,
      });
      onSave(result);
    } finally {
      setSaving(false);
    }
  }, [ticketId, planTitle, planStatus, editMilestones, editVerification, onSave]);

  return (
    <div className="ticket-plan-content ticket-plan-form">
      {editMilestones.map((milestone, mIdx) => (
        <div key={milestone.number} className="ticket-plan-form-milestone">
          <div className="ticket-plan-milestone-header">
            <input
              type="text"
              className="ticket-plan-form-input"
              value={milestone.title}
              placeholder="Milestone title..."
              onChange={(e) => setEditMilestones((prev) =>
                prev.map((m, i) => i !== mIdx ? m : { ...m, title: e.target.value }),
              )}
            />
          </div>
          {milestone.steps.map((step, sIdx) => (
            <div key={step.number} className="ticket-plan-form-step">
              <div className="ticket-plan-form-step-header">
                <span className="ticket-plan-form-step-num">#{step.number}</span>
                <input
                  type="text"
                  className="ticket-plan-form-input"
                  value={step.title}
                  placeholder="Step title..."
                  onChange={(e) => updateStep(mIdx, sIdx, { title: e.target.value })}
                />
                <button className="ticket-plan-form-remove" onClick={() => removeStep(mIdx, sIdx)}>{"\u00D7"}</button>
              </div>
              <div className="ticket-plan-form-fields">
                <label>
                  <span>Skill</span>
                  <input
                    type="text"
                    className="ticket-plan-form-input-sm"
                    value={step.skill}
                    onChange={(e) => updateStep(mIdx, sIdx, { skill: e.target.value })}
                  />
                </label>
                <label>
                  <span>Depends on</span>
                  <input
                    type="text"
                    className="ticket-plan-form-input-sm"
                    value={step.dependsOn.join(", ")}
                    placeholder="e.g. 1, 2"
                    onChange={(e) => updateStep(mIdx, sIdx, {
                      dependsOn: e.target.value.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n)),
                    })}
                  />
                </label>
              </div>
              <div className="ticket-plan-form-fields">
                <label style={{ flex: 1 }}>
                  <span>Agent instructions</span>
                  <MarkdownEditor
                    value={step.agentInstructions ?? ""}
                    onChange={(v) => updateStep(mIdx, sIdx, { agentInstructions: v })}
                    height={80}
                    preview={false}
                    minimap={false}
                    lineNumbers="off"
                  />
                </label>
              </div>
            </div>
          ))}
          <button className="ticket-plan-add-btn" onClick={() => addStep(mIdx)}>+ Add Step</button>
        </div>
      ))}
      <button className="ticket-plan-add-btn" onClick={addMilestone}>+ Add Milestone</button>

      <div className="ticket-plan-form-actions">
        <button className="ticket-plan-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Plan"}
        </button>
      </div>
    </div>
  );
}

// ── Raw Tab (markdown editor) ──

function PlanRawTab({ ticketId, onSave }: {
  ticketId: string;
  onSave: (plan: Record<string, unknown>) => void;
}) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const api = createBoardApi(getClient());
    api.getPlanRaw(ticketId).then((r) => {
      setContent(r.content);
      setLoading(false);
    }).catch((e) => {
      console.error("[PlanRawTab] Failed to fetch raw plan:", e);
      setError((e as Error).message ?? "Failed to load plan");
      setLoading(false);
    });
  }, [ticketId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const api = createBoardApi(getClient());
      const result = await api.savePlanRaw(ticketId, content);
      onSave(result);
    } catch (e) {
      console.error("[PlanRawTab] Failed to save raw plan:", e);
      setError((e as Error).message ?? "Failed to save plan");
    } finally {
      setSaving(false);
    }
  }, [ticketId, content, onSave]);

  if (loading) return <div className="ticket-placeholder">Loading raw plan...</div>;

  return (
    <div className="ticket-plan-content ticket-plan-raw">
      {error && (
        <div style={{ color: "var(--red)", fontSize: "var(--font-lg)", padding: "var(--space-sm) 0" }}>
          {error}
        </div>
      )}
      <MarkdownEditor
        value={content}
        onChange={setContent}
        preview={true}
      />
      <div className="ticket-plan-form-actions">
        <button className="ticket-plan-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ──

export function TicketPlanView({ plan, ticketId, onPlanUpdated }: TicketPlanViewProps) {
  const [tab, setTab] = useState<PlanTab>("status");
  const milestones = (plan?.milestones as MilestoneView[]) ?? [];
  const verification = (plan?.verification as { text: string; checked: boolean }[]) ?? [];
  const planStatus = (plan?.status as string) ?? "draft";
  const planTitle = (plan?.title as string) ?? "";

  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Plan</span>
        <span className={`ticket-linked-status ticket-linked-status--${planStatus}`}>
          {planStatus}
        </span>
        <div className="ticket-plan-tabs">
          {(["status", "steps", "raw"] as const).map((t) => (
            <button
              key={t}
              className={`ticket-plan-tab ${tab === t ? "ticket-plan-tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "status" ? "Status" : t === "steps" ? "Steps" : "Raw"}
            </button>
          ))}
        </div>
      </div>
      <div className="ticket-right-body">
        {tab === "status" && (
          <PlanStatusTab milestones={milestones} verification={verification} />
        )}
        {tab === "steps" && (
          <PlanStepsTab
            milestones={milestones}
            verification={verification}
            ticketId={ticketId}
            planTitle={planTitle}
            planStatus={planStatus}
            onSave={onPlanUpdated}
          />
        )}
        {tab === "raw" && (
          <PlanRawTab ticketId={ticketId} onSave={onPlanUpdated} />
        )}
      </div>
    </div>
  );
}
