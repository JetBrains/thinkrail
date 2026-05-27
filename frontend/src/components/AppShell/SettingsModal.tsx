import { useEffect, useRef, useState } from "react";
import { Modal, CopyButton } from "@/components/ui/index.ts";
import { useServerInfoStore } from "@/store/serverInfoStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { readFile } from "@/services/files.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { PERMISSION_MODES } from "@/utils/sessionConfig.ts";
import type { SessionDefaults } from "@/api/methods/appSettings.ts";
import {
  type ThemePreference,
  THEMES,
  getThemePreference,
  applyTheme,
} from "@/utils/theme.ts";
import "./SettingsModal.css";

const SETTINGS_PATH = ".bonsai/settings.json";

type Section = "themes" | "defaults" | "server" | "settings";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "themes", label: "Themes" },
  { id: "defaults", label: "Session Defaults" },
  { id: "server", label: "Server Info" },
  { id: "settings", label: "Settings" },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<Section>("themes");

  return (
    <Modal open={open} onClose={onClose}>
      <div
        className="settings-modal"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        <nav className="settings-modal__nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-modal__nav-item${section === s.id ? " settings-modal__nav-item--active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-modal__content">
          {section === "themes" && <ThemesSection />}
          {section === "defaults" && <SessionDefaultsSection visible={section === "defaults"} />}
          {section === "server" && <ServerSection />}
          {section === "settings" && <SettingsSection />}
        </div>
      </div>
    </Modal>
  );
}

function ThemesSection() {
  const [current, setCurrent] = useState<ThemePreference>(getThemePreference);

  const handleSelect = (id: ThemePreference) => {
    applyTheme(id);
    setCurrent(id);
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Themes</h3>
      <div className="settings-themes">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`settings-theme-option${t.id === current ? " settings-theme-option--active" : ""}`}
            onClick={() => handleSelect(t.id)}
          >
            <span className="settings-theme-option__label">{t.label}</span>
            <span className="settings-theme-option__scheme">{t.colorScheme}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ServerSection() {
  const info = useServerInfoStore((s) => s.info);

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Server Info</h3>
      {!info ? (
        <p className="settings-section__hint">Loading server info...</p>
      ) : (
        <>
          <div className="server-info-section">
            <div className="server-info-label">Hostname</div>
            <div className="server-info-value">{info.hostname}</div>
          </div>

          {info.lanIps.length > 0 && (
            <div className="server-info-section">
              <div className="server-info-label">
                LAN Address{info.lanIps.length > 1 ? "es" : ""}
              </div>
              {info.lanIps.map((ip) => (
                <div key={ip} className="server-info-row">
                  <code className="server-info-value">{ip}:3000</code>
                  <CopyButton className="server-info-copy-btn" text={`${ip}:3000`} />
                </div>
              ))}
            </div>
          )}

          {info.tailscale.active ? (
            <div className="server-info-section server-info-tailscale">
              <div className="server-info-label">Tailscale</div>
              {info.tailscale.hostname && (
                <div className="server-info-row">
                  <code className="server-info-value">{info.tailscale.hostname}</code>
                  <CopyButton className="server-info-copy-btn" text={info.tailscale.hostname} />
                </div>
              )}
              {info.tailscale.ip && (
                <div className="server-info-row">
                  <code className="server-info-value">{info.tailscale.ip}:3000</code>
                  <CopyButton className="server-info-copy-btn" text={`${info.tailscale.ip}:3000`} />
                </div>
              )}
              <p className="server-info-hint">
                Use the Tailscale hostname to connect from the mobile app.
              </p>
            </div>
          ) : (
            <div className="server-info-section">
              <div className="server-info-label">Tailscale</div>
              <p className="server-info-hint">
                Not detected. Install{" "}
                <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">
                  Tailscale
                </a>{" "}
                for encrypted remote access.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const EFFORT_OPTIONS = [null, "low", "medium", "high", "max"] as const;

/**
 * User-scope session defaults — model, permission mode, effort.
 * Persisted via ``appSettings/*`` RPCs in the AppStore, so the values follow
 * the user across every project (unlike ``.bonsai/settings.json`` which is
 * project-scoped). Rendered inline as a `Settings` section instead of its
 * own dialog so the top-bar gear is a single entry point to everything.
 */
function SessionDefaultsSection({ visible }: { visible: boolean }) {
  const sessionDefaults = useSettingsStore((s) => s.sessionDefaults);
  const fetchSessionDefaults = useSettingsStore((s) => s.fetchSessionDefaults);
  const updateSessionDefaults = useSettingsStore((s) => s.updateSessionDefaults);
  const models = useSettingsStore((s) => s.models) ?? [];

  const [draft, setDraft] = useState<SessionDefaults | null>(sessionDefaults);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const wasVisibleRef = useRef(false);

  // Seed local draft when the user opens this section; mirror late-arriving
  // store values into the draft so the picker doesn't show stale fields if
  // the initial fetch hadn't landed when the modal was first mounted.
  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }
    if (!wasVisibleRef.current) {
      wasVisibleRef.current = true;
      setSaveError(null);
      setSavedAt(null);
      setDraft(sessionDefaults);
      if (sessionDefaults === null) {
        fetchSessionDefaults();
      }
      return;
    }
    if (draft === null && sessionDefaults !== null) {
      setDraft(sessionDefaults);
    }
  }, [visible, sessionDefaults, draft, fetchSessionDefaults]);

  if (!draft && !sessionDefaults) {
    return (
      <div className="settings-section">
        <h3 className="settings-section__title">Session Defaults</h3>
        <p className="settings-section__hint">Loading…</p>
      </div>
    );
  }

  const value = draft ?? sessionDefaults!;
  const dirty =
    sessionDefaults !== null &&
    (value.model !== sessionDefaults.model ||
      value.effort !== sessionDefaults.effort ||
      value.permissionMode !== sessionDefaults.permissionMode);

  const setDraftValue = (next: SessionDefaults) => {
    setSaveError(null);
    setSavedAt(null);
    setDraft(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateSessionDefaults(value);
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(`Failed to save settings: ${getErrorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedModel = models.find((m) => m.id === value.model);

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Session Defaults</h3>
      <p className="settings-section__hint">
        Applied to every new session you start, across all projects. Stored
        on this machine — does not affect teammates.
      </p>

      <div className="user-settings-row">
        <label className="user-settings-label">Model</label>
        <select
          className="draft-config-select draft-config-select--model"
          value={value.model}
          onChange={(e) => setDraftValue({ ...value, model: e.target.value })}
        >
          {!selectedModel && <option value={value.model}>{value.model}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
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

      {saveError && (
        <div className="token-dialog-error" role="alert">{saveError}</div>
      )}

      <div className="settings-section__actions">
        {savedAt && !dirty && (
          <span className="settings-section__saved">Saved ✓</span>
        )}
        <button
          className="token-dialog-btn token-dialog-btn-primary"
          onClick={handleSave}
          disabled={!dirty || saving}
          title={!dirty ? "No changes to save" : "Save settings"}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function SettingsSection() {
  const projectPath = useUiStore((s) => s.projectPath);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        await useSettingsStore.getState().ensureFile();
        if (!projectPath) {
          if (!cancelled) setContent(null);
          return;
        }
        const data = await readFile(projectPath, SETTINGS_PATH);
        if (!cancelled) setContent(data?.content ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectPath]);

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">{SETTINGS_PATH}</h3>
      {loading ? (
        <p className="settings-section__hint">Loading…</p>
      ) : content == null ? (
        <p className="settings-section__hint">Failed to load settings file.</p>
      ) : (
        <pre className="settings-section__code">{content}</pre>
      )}
    </div>
  );
}
