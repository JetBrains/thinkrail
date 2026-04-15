import { useCallback, useState } from "react";
import { useServerInfoStore } from "@/store/serverInfoStore.ts";

interface ServerInfoDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ServerInfoDialog({ open, onClose }: ServerInfoDialogProps) {
  const info = useServerInfoStore((s) => s.info);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  if (!open) return null;

  return (
    <div className="token-dialog-overlay" onClick={onClose}>
      <div
        className="token-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        <h3>Server Info</h3>

        {!info ? (
          <p className="token-dialog-desc">Loading server info...</p>
        ) : (
          <>
            <div className="server-info-section">
              <div className="server-info-label">Hostname</div>
              <div className="server-info-value">{info.hostname}</div>
            </div>

            {info.lanIps.length > 0 && (
              <div className="server-info-section">
                <div className="server-info-label">LAN Address{info.lanIps.length > 1 ? "es" : ""}</div>
                {info.lanIps.map((ip) => (
                  <div key={ip} className="server-info-row">
                    <code className="server-info-value">{ip}:3000</code>
                    <button
                      className="server-info-copy-btn"
                      onClick={() => copyToClipboard(`${ip}:3000`)}
                    >
                      {copied === `${ip}:3000` ? "Copied" : "Copy"}
                    </button>
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
                    <button
                      className="server-info-copy-btn"
                      onClick={() => copyToClipboard(info.tailscale.hostname!)}
                    >
                      {copied === info.tailscale.hostname ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
                {info.tailscale.ip && (
                  <div className="server-info-row">
                    <code className="server-info-value">{info.tailscale.ip}:3000</code>
                    <button
                      className="server-info-copy-btn"
                      onClick={() => copyToClipboard(`${info.tailscale.ip}:3000`)}
                    >
                      {copied === `${info.tailscale.ip}:3000` ? "Copied" : "Copy"}
                    </button>
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
                  Not detected. Install <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">Tailscale</a> for encrypted remote access.
                </p>
              </div>
            )}
          </>
        )}

        <div className="token-dialog-actions">
          <div style={{ flex: 1 }} />
          <button className="token-dialog-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
