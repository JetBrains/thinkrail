import * as Icons from "lucide-react";
import type { WizardStep } from "./registry";
import "./WizardStepper.css";

interface WizardStepperProps {
  steps: WizardStep[];
}

function getIconComponent(iconName?: string) {
  if (!iconName) return null;
  const pascalCase = iconName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  const IconComponent = Icons[pascalCase as keyof typeof Icons] as React.ComponentType<{ size?: number }>;
  return IconComponent || null;
}

export function WizardStepper({ steps }: WizardStepperProps) {
  return (
    <div className="wiz-stepper">
      {steps.map((s, idx) => {
        const IconComponent = getIconComponent(s.icon);
        return (
          <div key={`${idx}-${s.label}`} className="wiz-step-row">
            <div
              className={`wiz-step${s.status === "active" ? " wiz-step-active" : ""}${s.status === "done" ? " wiz-step-done" : ""}`}
            >
              <span className="wiz-step-icon">
                {IconComponent ? <IconComponent size={14} /> : null}
              </span>
              <span className="wiz-step-label">{s.label}</span>
            </div>
            {idx < steps.length - 1 && <span className="wiz-step-divider" />}
          </div>
        );
      })}
    </div>
  );
}
