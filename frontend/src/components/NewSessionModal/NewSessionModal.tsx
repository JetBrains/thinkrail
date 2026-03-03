import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { SkillGrid } from "./SkillGrid.tsx";
import { SpecSelector } from "./SpecSelector.tsx";
import "./NewSessionModal.css";

const MODELS = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];
const TURN_OPTIONS = [5, 10, 20, 50, 100];

export function NewSessionModal() {
  const open = useUiStore((s) => s.modalOpen);
  const prefill = useUiStore((s) => s.modalPrefill);
  const closeModal = useUiStore((s) => s.closeModal);
  const startSession = useSessionStore((s) => s.startSession);

  const [name, setName] = useState("");
  const [skillId, setSkillId] = useState<string | null>(null);
  const [specIds, setSpecIds] = useState<string[]>([]);
  const [model, setModel] = useState(MODELS[0]);
  const [maxTurns, setMaxTurns] = useState(20);
  const [permissionMode, setPermissionMode] = useState("default");
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
      setModel(MODELS[0]);
      setMaxTurns(20);
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
        },
        name: name || (skillId ?? "session"),
        skillId: skillId ?? undefined,
      });
      closeModal();
    } catch {
      setSubmitting(false);
    }
  }, [submitting, startSession, specIds, model, maxTurns, permissionMode, name, skillId, closeModal]);

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
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

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
