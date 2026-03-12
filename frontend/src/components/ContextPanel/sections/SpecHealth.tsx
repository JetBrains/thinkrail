import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useSelectedSpec } from "../useSelectedSpec.ts";
import { StatusBadge } from "../utils.tsx";
import "./SpecHealth.css";

export function SpecHealth() {
  const spec = useSelectedSpec();

  if (!spec) {
    return (
      <CollapsibleSection title="Spec Health">
        <div className="section-placeholder">Select a spec to see health</div>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection
      title="Spec Health"
      summary={<StatusBadge status={spec.status} />}
    >
      <div className="spec-health">
        <div className="spec-health__row">
          <span className="spec-health__label">Status</span>
          <StatusBadge status={spec.status} />
        </div>
        <div className="spec-health__row">
          <span className="spec-health__label">Created</span>
          <span>{spec.created || "—"}</span>
        </div>
        <div className="spec-health__row">
          <span className="spec-health__label">Updated</span>
          <span>{spec.updated || "—"}</span>
        </div>
        <div className="spec-health__row">
          <span className="spec-health__label">Covers</span>
          <span>{(spec.covers?.length ?? 0)} pattern{(spec.covers?.length ?? 0) !== 1 ? "s" : ""}</span>
        </div>
        <div className="spec-health__row">
          <span className="spec-health__label">Type</span>
          <span>{spec.type}</span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
