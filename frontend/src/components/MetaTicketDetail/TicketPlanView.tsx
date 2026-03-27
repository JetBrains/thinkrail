interface PlanStepView {
  number: number;
  title: string;
  status: string;
  skill: string;
  dependsOn: number[];
  inputSpecIds: string[];
  sessionId?: string | null;
  successCriteria: { text: string; checked: boolean }[];
}

interface TicketPlanViewProps {
  plan: Record<string, unknown>;
}

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

export function TicketPlanView({ plan }: TicketPlanViewProps) {
  const steps = (plan.steps as PlanStepView[]) ?? [];
  const verification = (plan.verification as { text: string; checked: boolean }[]) ?? [];
  const planStatus = (plan.status as string) ?? "draft";

  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Plan</span>
        <span className={`ticket-linked-status ticket-linked-status--${planStatus}`}>
          {planStatus}
        </span>
      </div>
      <div className="ticket-right-body ticket-plan-content">
        {steps.length === 0 ? (
          <div className="ticket-placeholder">No steps defined yet.</div>
        ) : (
          <>
            {steps.map((step) => (
              <div key={step.number} className="ticket-plan-step">
                <div className="ticket-plan-step-header">
                  <span className="ticket-plan-step-icon">{stepStatusIcon(step.status)}</span>
                  <span className="ticket-plan-step-title">
                    Step {step.number}: {step.title}
                  </span>
                  <span className={`ticket-linked-status ${stepStatusClass(step.status)}`}>
                    {step.status}
                  </span>
                </div>
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
    </div>
  );
}
