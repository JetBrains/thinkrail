---
id: feature-admin-system
type: architecture-design
status: active
title: Admin Role System
parent: storage-architecture
covers:
- backend/app/rpc/methods/admin.py
- frontend/src/components/AdminPanel/AdminPanel.tsx
- frontend/src/components/SetupScreen/SetupScreen.tsx
- frontend/src/api/methods/admin.ts
tags:
- backend
- frontend
- admin
- auth
---
# Admin Role System

> Parent: [Storage Architecture](STORAGE_ARCHITECTURE.md) | Status: **Active** | Created: 2026-04-14

## Overview

Adds admin roles to the Bonsai user model, enabling user management through the web UI without CLI access. Solves the bootstrap problem for portable single-executable distributions where users cannot run CLI commands.

## Goals & Constraints

**Goals:**
- First-user bootstrap via web UI (no CLI required)
- Admin users can create, delete, and manage other users
- At least one admin must always exist (invariant)
- Admin panel accessible from the main app header

**Non-Goals:**
- Multi-role RBAC (future — simple boolean `is_admin` for now)
- OAuth/SSO integration
- Password-based authentication (token-only)

## Schema

Added `is_admin` column to users table (schema version 2):

```sql
CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_admin     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
) WITHOUT ROWID;
```

Migration from v1: `ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0` (idempotent — checks `PRAGMA table_info` first). The earliest user (by `created_at`) is auto-promoted to admin during migration so that pre-admin installations have at least one admin.

## Bootstrap Flow

### Portable Executable (first run)

```
User launches executable
  → Browser opens automatically
  → Frontend calls GET /api/setup/status
  → { needsSetup: true } (zero users in DB)
  → SetupScreen shown (instead of LoginScreen)
  → User enters ID + display name
  → POST /api/setup → creates first admin + token
  → Token shown with copy button
  → User clicks Continue → ProjectPicker
```

### CLI (development / server deployment)

```bash
cd backend && uv run python -m app.cli create-user --id danya --name "Danya" --admin
# → Created user "danya" (Danya) [admin]
# → Token: bns_a8f3k2m9...
```

### Promoting existing users

```bash
cd backend && uv run python -m app.cli set-admin --id danya
# → Granted admin to "danya" (Danya)
```

### Existing installations (v1→v2 migration)

When the database migrates from schema v1 to v2, the earliest user (by `created_at`) is automatically promoted to admin. No manual action needed.

## REST Endpoints (no auth required)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/setup/status` | GET | None | `{ needsSetup: bool }` — true when zero users exist |
| `/api/setup` | POST | None | `{ userId, name }` → creates first admin + token. Returns 403 if any users already exist. |

## Admin RPC Methods (WebSocket, admin-only)

All methods require the caller to have `is_admin = true`. Non-admin callers receive error code `-32000 (FORBIDDEN)`.

| Method | Params | Response | Description |
|--------|--------|----------|-------------|
| `admin/listUsers` | — | `{ users: [{ id, name, isAdmin, createdAt, tokenCount }] }` | All users with admin status |
| `admin/createUser` | `{ userId, name?, isAdmin? }` | `{ userId, name, token, isAdmin }` | Create user + token |
| `admin/deleteUser` | `{ userId }` | `{ ok: true }` | Delete user + cascade (not last admin) |
| `admin/setAdmin` | `{ userId }` | `{ ok: true }` | Grant admin rights |
| `admin/removeAdmin` | `{ userId }` | `{ ok: true }` | Revoke admin (not last admin) |
| `admin/revokeToken` | `{ token }` | `{ ok: true }` | Revoke a specific token |

## Invariant: At Least One Admin

Enforced in two places:
- `admin/deleteUser` — checks `admin_count() <= 1` before deleting an admin user
- `admin/removeAdmin` — checks `admin_count() <= 1` before revoking admin

SQLite's single-writer serialization ensures these check-then-act patterns are safe.

## WebSocket Lifecycle on Project Switch

When the user switches projects, the `RpcProvider` in `main.tsx` is remounted via `key={projectPath}`. The old provider's `useEffect` cleanup calls `client.disconnect()`, which:
1. Closes the old WebSocket cleanly
2. Cancels pending reconnection timers
3. Rejects any pending RPC requests

The new provider then creates a fresh `RpcClient` with the new project URL (including the same server-wide token) and connects.

## Frontend Components

### SetupScreen (`frontend/src/components/SetupScreen/`)

Shown when `GET /api/setup/status` returns `needsSetup: true`. Two phases:
1. **Form** — User ID + Display Name inputs → `POST /api/setup`
2. **Token display** — Shows generated token with Copy button → Continue

### AdminPanel (`frontend/src/components/AdminPanel/`)

Modal dialog accessible from the Header (Admin button, visible only to admins):
- User list table: ID, Name, Admin badge, Token count, Actions
- Create user form: userId + name + isAdmin checkbox → shows generated token
- Toggle admin / Delete buttons (disabled on last admin)

### Auth Gate (`frontend/src/main.tsx`)

```
checking → needsSetup? → SetupScreen
                       → has token? → validate → LoginScreen / authenticated
                                                → ProjectPicker → App
```

## File Organization

| File | Responsibility |
|------|---------------|
| `backend/app/core/server_store.py` | `is_admin` on User, admin CRUD methods, schema v2 migration |
| `backend/app/rpc/methods/admin.py` | Admin RPC handlers with `_require_admin()` guard |
| `backend/app/rpc/auth.py` | `is_admin` in `UserIdentity` |
| `backend/app/main.py` | Setup REST endpoints, `isAdmin` in profile response |
| `backend/app/cli.py` | `--admin` flag on `create-user`, `set-admin` command |
| `frontend/src/components/SetupScreen/` | First-user bootstrap UI |
| `frontend/src/components/AdminPanel/` | User management UI |
| `frontend/src/api/methods/admin.ts` | Admin RPC wrappers |
| `frontend/src/store/tokenStore.ts` | `isAdmin` state |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Simple boolean `is_admin` | Not a roles table | Sufficient for current needs; one boolean is trivial to migrate to RBAC later |
| Setup endpoint is one-time | Returns 403 if users exist | Prevents unauthorized account creation after first admin |
| CLI retains `--admin` flag | Separate from UI bootstrap | Server deployments still need CLI bootstrapping |
| Token shown once on creation | Not stored in UI | Security: tokens should be saved by the user immediately |
| Admin button in Header | Not in settings | Visible and accessible, but only to admins |
| Auto-promote on migration | First user becomes admin | Pre-admin installations need an admin without manual intervention |
| Admin scope is server-wide | Not per-project | Simpler model; sufficient for current scale; extensible to per-project RBAC later |

## Related Specs

- [Storage Architecture](STORAGE_ARCHITECTURE.md) — parent spec, SQLite schema
- [Server Store](../../backend/app/core/SERVER_STORE.md) — ServerStore admin methods
- [Auth Migration](../../backend/app/rpc/AUTH_MIGRATION.md) — auth flow with `is_admin`
- [User API](../../backend/app/rpc/methods/USER_API.md) — user profile includes `isAdmin`
