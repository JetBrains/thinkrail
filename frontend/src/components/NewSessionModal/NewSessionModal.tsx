import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { MODELS, DEFAULT_MODEL, BETA_1M, getModelDef } from "@/utils/models.ts";
import { SkillGrid } from "./SkillGrid.tsx";
import { SpecSelector } from "./SpecSelector.tsx";
import "./NewSessionModal.css";

const TURN_OPTIONS = [5, 10, 20, 50, 100];

export function NewSessionModal() {
  const open = useUiStore((s) => s.modalOpen);
  const prefill = useUiStore((s) => s.modalPrefill);
  const closeModal = useUiStore((s) => s.closeModal);
  const startSession = useSessionStore((s) => s.startSession);

  const [name, setName] = useState("");
  const [skillId, setSkillId] = useState<string | null>(null);
  const [specIds, setSpecIds] = useState<string[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [use1M, setUse1M] = useState(false);
  const [maxTurns, setMaxTurns] = useState(50);
  const [permissionMode, setPermissionMode] = useState("default");
  const [effort, setEffort] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Apply prefill on open
  useEffect(() => {
    if (open && prefill) {
      if (prefill.skillId) setSkillId(prefill.skillId);
      if (prefill.specIds) setSpecIds(prefill.specIds);
      if (prefill.name) setName(prefill.name);
    }
    if (!open) {
      setName("");
      setSkillId(null);
      setSpecIds([]);
      setModel(DEFAULT_MODEL);
      setUse1M(false);
      setMaxTurns(50);
      setEffort(null);
      setPermissionMode("default");
      setShowAdvanced(false);
      setSubmitting(false);
    }
  }, [open, prefill]);

  const handleToggleSpec = useCallback((id: string) => {
    setSpecIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await startSession({
        specIds,
        config: {
          model,
          maxTurns,
          permissionMode,
          streamText: true,
          betas: use1M ? [BETA_1M] : [],
          effort,
        },
        name: name || (skillId ?? "session"),
        skillId: skillId ?? undefined,
      });
      closeModal();
    } catch {
      setSubmitting(false);
    }
  }, [submitting, startSession, specIds, model, use1M, maxTurns, permissionMode, effort, name, skillId, closeModal]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">New Session</h2>
          <button className="modal-close" onClick={closeModal}>
            {"\u00D7"}
          </button>
        </div>

        <div className="modal-body">
          <label className="modal-label">Session Name</label>
          <input
            className="modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Module: session-manager"
            maxLength={60}
            autoFocus
          />

          <label className="modal-label">Skill</label>
          <SkillGrid selectedId={skillId} onSelect={setSkillId} />

          <label className="modal-label">Spec Context</label>
          <SpecSelector selectedIds={specIds} onToggle={handleToggleSpec} />

          <button
            className="modal-advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? "\u25BC" : "\u25B6"} Advanced
          </button>

          {showAdvanced && (
            <div className="modal-advanced">
              <label className="modal-label">Model</label>
              <select
                className="modal-select"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  if (!getModelDef(e.target.value)?.supports1M) setUse1M(false);
                }}
              >
                <optgroup label="Current">
                  {MODELS.filter((m) => m.group === "current").map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Legacy">
                  {MODELS.filter((m) => m.group === "legacy").map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
              </select>
              {getModelDef(model)?.supports1M && (
                <label className="modal-checkbox">
                  <input
                    type="checkbox"
                    checked={use1M}
                    onChange={(e) => setUse1M(e.target.checked)}
                  />
                  1M context window (beta)
                </label>
              )}

              <label className="modal-label">Max Turns</label>
              <div className="modal-pills">
                {TURN_OPTIONS.map((t) => (
                  <button
                    key={t}
                    className={`modal-pill ${maxTurns === t ? "modal-pill-active" : ""}`}
                    onClick={() => setMaxTurns(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <label className="modal-label">Permission Mode</label>
              <div className="modal-radio-group">
                {["default", "acceptEdits", "bypassPermissions", "plan"].map((m) => (
                  <label key={m} className="modal-radio">
                    <input
                      type="radio"
                      name="permissionMode"
                      value={m}
                      checked={permissionMode === m}
                      onChange={() => setPermissionMode(m)}
                    />
                    {m}
                  </label>
                ))}
              </div>

              <label className="modal-label">Effort</label>
              <div className="modal-pills">
                {([null, "low", "medium", "high", "max"] as const).map((e) => (
                  <button
                    key={e ?? "auto"}
                    className={`modal-pill ${effort === e ? "modal-pill-active" : ""}`}
                    onClick={() => setEffort(e)}
                  >
                    {e ?? "auto"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-cancel" onClick={closeModal}>
            Cancel
          </button>
          <button
            className="modal-submit"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Starting..." : "Start Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
