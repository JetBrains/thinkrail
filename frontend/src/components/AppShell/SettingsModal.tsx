import { useEffect, useState } from "react";
import { Modal, CopyButton } from "@/components/ui/index.ts";
import { useServerInfoStore } from "@/store/serverInfoStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { readFile } from "@/services/files.ts";
import {
  type ThemePreference,
  THEMES,
  getThemePreference,
  applyTheme,
} from "@/utils/theme.ts";
import "./SettingsModal.css";

const SETTINGS_PATH = ".bonsai/settings.json";

type Section = "themes" | "server" | "settings";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "themes", label: "Themes" },
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
