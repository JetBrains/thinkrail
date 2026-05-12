import "./NewProjectStepper.css";

interface NewProjectStepperProps {
  currentStep: 1 | 2 | 3;
}

const STEPS: { num: number; label: string }[] = [
  { num: 1, label: "Describe" },
  { num: 2, label: "Guided session" },
  { num: 3, label: "Goal & Requirements doc" },
];

export function NewProjectStepper({ currentStep }: NewProjectStepperProps) {
  return (
    <div className="nps-stepper">
      {STEPS.map((s, idx) => {
        const done = s.num < currentStep;
        const active = s.num === currentStep;
        return (
          <div key={s.num} className="nps-step-row">
            <div
              className={`nps-step${active ? " nps-step-active" : ""}${done ? " nps-step-done" : ""}`}
            >
              <span className="nps-step-num">{done ? "✓" : s.num}</span>
              <span className="nps-step-label">{s.label}</span>
            </div>
            {idx < STEPS.length - 1 && <span className="nps-step-arrow">→</span>}
          </div>
        );
      })}
    </div>
  );
}
