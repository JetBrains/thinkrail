import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@/api/hooks/useRpc.tsx";
import { createAdminApi } from "@/api/methods/admin.ts";
import type { AdminUser } from "@/api/methods/admin.ts";
import "./AdminPanel.css";

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AdminPanel({ open, onClose }: AdminPanelProps) {
  const client = useRpc();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create user form
  const [newUserId, setNewUserId] = useState("");
  const [newName, setNewName] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const api = createAdminApi(client);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listUsers();
      setUsers(result.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      fetchUsers();
      setCreatedToken(null);
      setNewUserId("");
      setNewName("");
      setNewIsAdmin(false);
    }
  }, [open, fetchUsers]);

  const handleCreateUser = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const uid = newUserId.trim();
      const name = newName.trim();
      if (!uid || !name) return;

      setCreating(true);
      setError(null);
      try {
        const result = await api.createUser(uid, name, newIsAdmin);
        setCreatedToken(result.token);
        setNewUserId("");
        setNewName("");
        setNewIsAdmin(false);
        await fetchUsers();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create user");
      } finally {
        setCreating(false);
      }
    },
    [newUserId, newName, newIsAdmin, client, fetchUsers], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleToggleAdmin = useCallback(
    async (userId: string, currentlyAdmin: boolean) => {
      setError(null);
      try {
        if (currentlyAdmin) {
          await api.removeAdmin(userId);
        } else {
          await api.setAdmin(userId);
        }
        await fetchUsers();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update admin status");
      }
    },
    [client, fetchUsers], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleDeleteUser = useCallback(
    async (userId: string) => {
      setError(null);
      try {
        await api.deleteUser(userId);
        await fetchUsers();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete user");
      }
    },
    [client, fetchUsers], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleCopyToken = useCallback(() => {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [createdToken]);

  const adminCount = users.filter((u) => u.isAdmin).length;

  if (!open) return null;

  return (
    <div className="token-dialog-overlay" onClick={onClose}>
      <div
        className="admin-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="admin-panel-header">
          <h3>User Management</h3>
          <button className="admin-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {error && <div className="admin-error">{error}</div>}

        {/* Create user form */}
        <form className="admin-create-form" onSubmit={handleCreateUser}>
          <div className="admin-create-row">
            <input
              className="admin-input"
              type="text"
              placeholder="User ID"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              disabled={creating}
            />
            <input
              className="admin-input"
              type="text"
              placeholder="Display name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
            />
            <label className="admin-checkbox-label">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={(e) => setNewIsAdmin(e.target.checked)}
                disabled={creating}
              />
              Admin
            </label>
            <button
              className="token-dialog-btn token-dialog-btn-primary"
              type="submit"
              disabled={creating || !newUserId.trim() || !newName.trim()}
            >
              {creating ? "..." : "Create"}
            </button>
          </div>
        </form>

        {/* Show created token */}
        {createdToken && (
          <div className="admin-token-banner">
            <span className="admin-token-value">{createdToken}</span>
            <button
              className="token-dialog-btn"
              onClick={handleCopyToken}
              type="button"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="token-dialog-btn"
              onClick={() => setCreatedToken(null)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* User list */}
        <div className="admin-user-list">
          {loading && <div className="admin-loading">Loading...</div>}
          {!loading && users.length === 0 && (
            <div className="admin-empty">No users</div>
          )}
          {users.map((u) => (
            <div key={u.id} className="admin-user-row">
              <div className="admin-user-info">
                <span className="admin-user-name">{u.name}</span>
                <span className="admin-user-id">{u.id}</span>
                {u.isAdmin && <span className="admin-badge">admin</span>}
                <span className="admin-token-count">
                  {u.tokenCount} token{u.tokenCount !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="admin-user-actions">
                <button
                  className="token-dialog-btn"
                  onClick={() => handleToggleAdmin(u.id, u.isAdmin)}
                  disabled={u.isAdmin && adminCount <= 1}
                  title={
                    u.isAdmin && adminCount <= 1
                      ? "Cannot remove the last admin"
                      : u.isAdmin
                        ? "Remove admin"
                        : "Make admin"
                  }
                >
                  {u.isAdmin ? "Remove admin" : "Make admin"}
                </button>
                <button
                  className="token-dialog-btn token-dialog-btn-danger"
                  onClick={() => handleDeleteUser(u.id)}
                  disabled={u.isAdmin && adminCount <= 1}
                  title={
                    u.isAdmin && adminCount <= 1
                      ? "Cannot delete the last admin"
                      : "Delete user"
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
