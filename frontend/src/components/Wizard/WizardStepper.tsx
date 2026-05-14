import type { WizardStep } from "./registry";
import "./WizardStepper.css";

interface WizardStepperProps {
  steps: WizardStep[];
}

export function WizardStepper({ steps }: WizardStepperProps) {
  return (
    <div className="wiz-stepper">
      {steps.map((s, idx) => (
        <div key={`${idx}-${s.label}`} className="wiz-step-row">
          <div
            className={`wiz-step${s.status === "active" ? " wiz-step-active" : ""}${s.status === "done" ? " wiz-step-done" : ""}`}
          >
            <span className="wiz-step-num">
              {s.status === "done" ? "✓" : idx + 1}
            </span>
            <span className="wiz-step-label">{s.label}</span>
          </div>
          {idx < steps.length - 1 && <span className="wiz-step-arrow">→</span>}
        </div>
      ))}
    </div>
  );
}
