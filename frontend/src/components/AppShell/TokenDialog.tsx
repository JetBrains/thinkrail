import { useCallback, useEffect, useState } from "react";
import { useTokenStore } from "@/store/tokenStore.ts";
import { Modal } from "@/components/ui/index.ts";

interface TokenDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TokenDialog({ open, onClose }: TokenDialogProps) {
  const token = useTokenStore((s) => s.token);
  const setToken = useTokenStore((s) => s.setToken);
  const [input, setInput] = useState(token ?? "");

  useEffect(() => {
    if (open) setInput(token ?? "");
  }, [open, token]);

  const handleSave = useCallback(() => {
    const trimmed = input.trim();
    setToken(trimmed || null);
    onClose();
    // Reconnect with new token
    window.location.reload();
  }, [input, setToken, onClose]);

  const handleClear = useCallback(() => {
    setToken(null);
    onClose();
    window.location.reload();
  }, [setToken, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSave();
      if (e.key === "Escape") onClose();
    },
    [handleSave, onClose],
  );

  return (
    <Modal open={open} onClose={onClose}>
      <div className="token-dialog" onKeyDown={handleKeyDown}>
        <h3>Authentication Token</h3>
        <p className="token-dialog-desc">
          Enter a token to authenticate with the Bonsai server. Leave empty for
          anonymous access.
        </p>
        <input
          autoFocus
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="bns_..."
          className="token-dialog-input"
        />
        <div className="token-dialog-actions">
          {token && (
            <button className="token-dialog-btn token-dialog-btn-danger" onClick={handleClear}>
              Clear
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="token-dialog-btn" onClick={onClose}>Cancel</button>
          <button className="token-dialog-btn token-dialog-btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
