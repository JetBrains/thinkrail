import { useCallback, useState } from "react";
import { useTokenStore } from "@/store/tokenStore.ts";
import "./SetupScreen.css";

interface SetupScreenProps {
  onSuccess: () => void;
}

export function SetupScreen({ onSuccess }: SetupScreenProps) {
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const uid = userId.trim();
      const displayName = name.trim();
      if (!uid || !displayName) return;

      setError(null);
      setLoading(true);
      try {
        const res = await fetch("/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: uid, name: displayName }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Setup failed");
          return;
        }
        const data = await res.json();
        setCreatedToken(data.token);
        useTokenStore.getState().setToken(data.token);
        useTokenStore.getState().setIsAdmin(true);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    },
    [userId, name]
  );

  const handleCopy = useCallback(() => {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [createdToken]);

  if (createdToken) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">bonsai</div>
          <div className="login-subtitle">Admin account created</div>

          <div className="setup-token-section">
            <label className="setup-token-label">
              Your access token (save it now):
            </label>
            <div className="setup-token-display">
              <code className="setup-token-value">{createdToken}</code>
              <button
                className="setup-copy-btn"
                onClick={handleCopy}
                type="button"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <button className="login-btn" onClick={onSuccess} type="button">
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">bonsai</div>
        <div className="login-subtitle">Create the first admin account</div>

        <input
          className="login-input"
          type="text"
          placeholder="User ID (e.g. danya)"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          autoFocus
          disabled={loading}
        />

        <input
          className="login-input setup-input-spacing"
          type="text"
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
        />

        {error && <div className="login-error">{error}</div>}

        <button
          className="login-btn"
          type="submit"
          disabled={loading || !userId.trim() || !name.trim()}
        >
          {loading ? "Creating..." : "Create Admin"}
        </button>
      </form>
    </div>
  );
}
