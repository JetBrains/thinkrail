import type { TicketState } from "@/types/rpc-methods.ts";

type Cfg = NonNullable<TicketState["orchestration"]>;

function Segment<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly [T, T];
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  const active = value ?? options[0];
  return (
    <div className="orch-segment">
      <span className="orch-segment-label">{label}</span>
      <div className="orch-segment-pills">
        {options.map((opt) => (
          <button
            key={opt}
            className={`orch-pill${active === opt ? " orch-pill--active" : ""}`}
            aria-label={`${label.toLowerCase()}: ${opt}`}
            aria-pressed={active === opt}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OrchestrationControls({ config, onChange }: {
  config: Cfg; onChange: (patch: Partial<Cfg>) => void;
}) {
  return (
    <div className="orchestration-controls">
      <Segment
        label="Stages"
        options={["approve", "autonomous"] as const}
        value={config.stageGate}
        onChange={(v) => onChange({ stageGate: v })}
      />
      <Segment
        label="Steps"
        options={["approve", "autonomous"] as const}
        value={config.stepGate}
        onChange={(v) => onChange({ stepGate: v })}
      />
      <Segment
        label="On failure"
        options={["fail-fast", "wait-all"] as const}
        value={config.failurePolicy}
        onChange={(v) => onChange({ failurePolicy: v })}
      />
      <Segment
        label="Steps run"
        options={["interactive", "subagent"] as const}
        value={config.stepExecution}
        onChange={(v) => onChange({ stepExecution: v })}
      />
    </div>
  );
}
