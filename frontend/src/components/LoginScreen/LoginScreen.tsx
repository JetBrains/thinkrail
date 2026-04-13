import { useCallback, useRef, useState } from "react";
import { userRestApi } from "@/api/methods/user.ts";
import { useTokenStore } from "@/store/tokenStore.ts";
import "./LoginScreen.css";

interface LoginScreenProps {
  onSuccess: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const token = value.trim();
      if (!token) return;

      setError(null);
      setLoading(true);
      try {
        const profile = await userRestApi.getProfile(token);
        if (profile) {
          useTokenStore.getState().setToken(token);
          onSuccess();
        } else {
          setError("Invalid token");
          inputRef.current?.select();
        }
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    },
    [value, onSuccess]
  );

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">bonsai</div>
        <div className="login-subtitle">Enter your access token to continue</div>

        <input
          ref={inputRef}
          className="login-input"
          type="password"
          placeholder="bns_..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          disabled={loading}
        />

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" type="submit" disabled={loading || !value.trim()}>
          {loading ? "Validating..." : "Login"}
        </button>
      </form>
    </div>
  );
}
