import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/index.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { PERMISSION_MODES } from "@/utils/sessionConfig.ts";
import type { SessionDefaults } from "@/api/methods/appSettings.ts";

interface UserSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const EFFORT_OPTIONS = [null, "low", "medium", "high", "max"] as const;
const TURN_OPTIONS = [5, 10, 20, 50, 100] as const;

/**
 * User-scope session defaults editor. Backed by ``appSettings/*`` RPCs,
 * persisted in the AppStore — these preferences travel with the user
 * across every project, unlike ``.bonsai/settings.json`` which is
 * checked into each project tree.
 */
export function UserSettingsDialog({ open, onClose }: UserSettingsDialogProps) {
  const sessionDefaults = useSettingsStore((s) => s.sessionDefaults);
  const fetchSessionDefaults = useSettingsStore((s) => s.fetchSessionDefaults);
  const updateSessionDefaults = useSettingsStore((s) => s.updateSessionDefaults);
  // Subscribe to the dynamic model list so the dropdown re-renders when
  // ``models/list`` lands after the dialog is already mounted.
  const models = useSettingsStore((s) => s.models) ?? [];

  const [draft, setDraft] = useState<SessionDefaults | null>(sessionDefaults);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wasOpenRef = useRef(false);

  // Seed local draft on open, then keep failed-save rollbacks from
  // overwriting the user's unsaved selections while the dialog stays open.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setSaveError(null);
      setDraft(sessionDefaults);
      if (sessionDefaults === null) {
        fetchSessionDefaults();
      }
      return;
    }

    if (draft === null && sessionDefaults !== null) {
      setDraft(sessionDefaults);
    }
  }, [open, sessionDefaults, draft, fetchSessionDefaults]);

  if (!draft && !sessionDefaults) {
    return (
      <Modal open={open} onClose={onClose}>
        <div className="token-dialog">
          <h3>User Settings</h3>
          <p className="token-dialog-desc">Loading…</p>
          <div className="token-dialog-actions">
            <div style={{ flex: 1 }} />
            <button className="token-dialog-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </Modal>
    );
  }

  const value = draft ?? sessionDefaults!;
  const dirty =
    sessionDefaults !== null &&
    (value.model !== sessionDefaults.model ||
      value.effort !== sessionDefaults.effort ||
      value.permissionMode !== sessionDefaults.permissionMode ||
      value.maxTurns !== sessionDefaults.maxTurns);

  const setDraftValue = (next: SessionDefaults) => {
    setSaveError(null);
    setDraft(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateSessionDefaults(value);
      onClose();
    } catch (err) {
      setSaveError(`Failed to save settings: ${getErrorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const current = models.filter((m) => m.group === "current");
  const legacy = models.filter((m) => m.group === "legacy");
  const selectedModel = models.find((m) => m.id === value.model);
  const saveDisabled = !dirty || saving;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="token-dialog user-settings-dialog">
        <h3>User Settings</h3>
        <p className="token-dialog-desc">
          Defaults applied to every new session you start, across all
          projects. Stored on this machine — does not affect teammates.
        </p>

        <div className="user-settings-row">
          <label className="user-settings-label">Model</label>
          <select
            className="draft-config-select draft-config-select--model"
            value={value.model}
            onChange={(e) => setDraftValue({ ...value, model: e.target.value })}
          >
            {!selectedModel && (
              <option value={value.model}>{value.model}</option>
            )}
            {current.length > 0 && (
              <optgroup label="Current">
                {current.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            )}
            {legacy.length > 0 && (
              <optgroup label="Legacy">
                {legacy.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div className="user-settings-row">
          <label className="user-settings-label">Permission mode</label>
          <select
            className="draft-config-select"
            value={value.permissionMode}
            onChange={(e) => setDraftValue({ ...value, permissionMode: e.target.value })}
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="user-settings-row">
          <label className="user-settings-label">Effort</label>
          <span className="draft-config-pills">
            {EFFORT_OPTIONS.map((e) => (
              <button
                key={e ?? "auto"}
                type="button"
                className={`draft-config-effort-pill ${value.effort === e ? "draft-config-effort-pill--active" : ""}`}
                onClick={() => setDraftValue({ ...value, effort: e })}
              >
                {e ?? "auto"}
              </button>
            ))}
          </span>
        </div>

        <div className="user-settings-row">
          <label className="user-settings-label">Max turns</label>
          <span className="draft-config-pills">
            {TURN_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                className={`draft-config-effort-pill ${value.maxTurns === t ? "draft-config-effort-pill--active" : ""}`}
                onClick={() => setDraftValue({ ...value, maxTurns: t })}
              >
                {t}
              </button>
            ))}
          </span>
        </div>

        {saveError && (
          <div className="token-dialog-error" role="alert">
            {saveError}
          </div>
        )}

        <div className="token-dialog-actions">
          <div style={{ flex: 1 }} />
          <button className="token-dialog-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="token-dialog-btn token-dialog-btn-primary"
            onClick={handleSave}
            disabled={saveDisabled}
            title={!dirty ? "No changes to save" : "Save settings"}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
