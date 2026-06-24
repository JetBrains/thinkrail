import { useEffect, useRef, useState } from "react";
import { Modal, CopyButton, Button } from "@/components/ui/index.ts";
import { useServerInfoStore } from "@/store/serverInfoStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { readFile } from "@/services/files.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { RuntimeFlags } from "@/components/shared/RuntimeFlags.tsx";
import { Dropdown } from "@/components/shared/Dropdown.tsx";
import { permissionModeTooltip } from "@/utils/permissionMode.ts";
import type { SessionDefaults } from "@/api/methods/appSettings.ts";
import "./SettingsModal.css";

const SETTINGS_PATH = ".tr/settings.json";

type Section = "defaults" | "privacy" | "server" | "settings";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "defaults", label: "Session Defaults" },
  { id: "privacy", label: "Privacy" },
  { id: "server", label: "Server Info" },
  { id: "settings", label: "Settings" },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<Section>("defaults");

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
          {section === "defaults" && <SessionDefaultsSection visible={section === "defaults"} />}
          {section === "privacy" && <PrivacySection visible={section === "privacy"} />}
          {section === "server" && <ServerSection />}
          {section === "settings" && <SettingsSection />}
        </div>
      </div>
    </Modal>
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

/**
 * User-scope session defaults — model, permission mode, effort.
 * Persisted via ``appSettings/*`` RPCs in the AppStore, so the values follow
 * the user across every project (unlike ``.tr/settings.json`` which is
 * project-scoped). Rendered inline as a `Settings` section instead of its
 * own dialog so the top-bar gear is a single entry point to everything.
 */
function SessionDefaultsSection({ visible }: { visible: boolean }) {
  const sessionDefaults = useSettingsStore((s) => s.sessionDefaults);
  const fetchSessionDefaults = useSettingsStore((s) => s.fetchSessionDefaults);
  const updateSessionDefaults = useSettingsStore((s) => s.updateSessionDefaults);
  const caps = useRuntimeCapsStore((s) => s.capsByRuntime["claude"]);
  const models = caps?.models ?? [];
  const permissionModes = caps?.permissionModes ?? [];
  const effortLevels = caps?.effortLevels ?? [];
  const flags = caps?.flags ?? [];

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
  const flagValue = (key: string, dflt: boolean): boolean => value.flags?.[key] ?? dflt;
  const dirty =
    sessionDefaults !== null &&
    (value.model !== sessionDefaults.model ||
      value.effort !== sessionDefaults.effort ||
      value.permissionMode !== sessionDefaults.permissionMode ||
      flags.some(
        (f) => flagValue(f.key, f.default) !== (sessionDefaults.flags?.[f.key] ?? f.default),
      ));

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

  const selectedModel = models.find((m) => m.value === value.model);

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Session Defaults</h3>
      <p className="settings-section__hint">
        Applied to every new session you start, across all projects. Stored
        on this machine — does not affect teammates.
      </p>

      <div className="user-settings-row">
        <label className="user-settings-label">Model</label>
        <Dropdown
          className="settings-dd"
          value={value.model}
          options={[
            ...(selectedModel ? [] : [{ value: value.model, label: value.model }]),
            ...models.map((m) => ({ value: m.value, label: m.label })),
          ]}
          onChange={(v) => setDraftValue({ ...value, model: v })}
        />
      </div>

      <div className="user-settings-row">
        <label className="user-settings-label">Permission mode</label>
        <Dropdown
          className="settings-dd"
          value={value.permissionMode}
          options={[
            ...(permissionModes.some((m) => m.value === value.permissionMode)
              ? []
              : [{ value: value.permissionMode, label: value.permissionMode }]),
            ...permissionModes.map((m) => ({
              value: m.value,
              label: m.label,
              title: permissionModeTooltip(m),
            })),
          ]}
          onChange={(v) => setDraftValue({ ...value, permissionMode: v })}
        />
      </div>

      <div className="user-settings-row">
        <label className="user-settings-label">Effort</label>
        <Dropdown
          className="settings-dd"
          value={value.effort}
          options={[
            ...(effortLevels.some((e) => e.value === value.effort)
              ? []
              : [{ value: value.effort, label: value.effort }]),
            ...effortLevels.map((e) => ({ value: e.value, label: e.label })),
          ]}
          onChange={(v) => setDraftValue({ ...value, effort: v })}
        />
      </div>

      {flags.some((f) => f.type === "boolean") && (
        <div className="user-settings-row">
          <label className="user-settings-label">Flags</label>
          <span className="runtime-flags">
            <RuntimeFlags
              flags={flags}
              value={value.flags ?? {}}
              idPrefix="flag"
              onChange={(key, checked) =>
                setDraftValue({ ...value, flags: { ...value.flags, [key]: checked } })
              }
            />
          </span>
        </div>
      )}

      {saveError && (
        <div className="token-dialog-error" role="alert">{saveError}</div>
      )}

      <div className="settings-section__actions">
        {savedAt && !dirty && (
          <span className="settings-section__saved">Saved ✓</span>
        )}
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || saving}
          title={!dirty ? "No changes to save" : "Save settings"}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Anonymous-analytics consent toggle, bound to the same AppStore consent
 * record as the `thinkrail analytics` CLI and the install flag. Toggling
 * applies immediately (opt-in mints a fresh installation id; opt-out clears
 * it). Analytics is on by default — see README "Analytics & Privacy".
 */
function PrivacySection({ visible }: { visible: boolean }) {
  const analyticsConsent = useSettingsStore((s) => s.analyticsConsent);
  const fetchAnalyticsConsent = useSettingsStore((s) => s.fetchAnalyticsConsent);
  const setAnalyticsEnabled = useSettingsStore((s) => s.setAnalyticsEnabled);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }
    if (!wasVisibleRef.current) {
      wasVisibleRef.current = true;
      if (analyticsConsent === null) fetchAnalyticsConsent();
    }
  }, [visible, analyticsConsent, fetchAnalyticsConsent]);

  const enabled = analyticsConsent?.enabled ?? true;

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Privacy</h3>
      <p className="settings-section__hint">
        ThinkRail collects anonymous usage analytics to understand which
        features get used and whether installs stay active. The only stable
        identifier is a random per-install id. Never collected: project paths,
        file/spec/ticket names, prompts, code, transcripts, or anything that
        identifies you. Stored on this machine and shared across all projects.
      </p>

      <div className="user-settings-row">
        <label className="user-settings-label">Usage analytics</label>
        <span className="runtime-flags">
          <label className="runtime-flag">
            <input
              type="checkbox"
              checked={enabled}
              disabled={analyticsConsent === null}
              onChange={(e) => setAnalyticsEnabled(e.target.checked)}
            />
            Send anonymous usage analytics
          </label>
        </span>
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
