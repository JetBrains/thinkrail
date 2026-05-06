---
id: feature_login_screen
type: task-spec
status: done
title: Remove Authentication & Single-User Cleanup
depends-on:
- frontend-module
- storage-architecture
covers:
- frontend/src/components/LoginScreen/
- frontend/src/components/SetupScreen/
- frontend/src/components/AdminPanel/
- frontend/src/services/user.ts
- frontend/src/services/setup.ts
- frontend/src/api/methods/user.ts
- frontend/src/api/methods/admin.ts
- frontend/src/store/tokenStore.ts
- backend/app/rpc/auth.py
- backend/app/rpc/methods/admin.py
- backend/app/rpc/methods/user.py
- backend/app/api/routers/setup.py
- backend/app/api/routers/user.py
- backend/app/cli.py
- backend/app/core/server_store.py
tags:
- frontend
- backend
- auth
- removal
- critical
---
# Remove Authentication & Single-User Cleanup

> Bonsai is **single-user, localhost-only** by design (see `GOAL&REQUIREMENTS.md`). The auth/admin layer added in earlier tickets contradicts those constraints and is being removed. The app reverts to a tokenless WebSocket connection. App-wide settings and the known-projects registry remain in SQLite at `~/.bonsai/bonsai.db`, but with no concept of users.

**Status:** Active
**Priority:** Critical
**Replaces:** the original "Implement Frontend Auth & Login Screen" scope on this ticket.
**Spec reference:** [Storage Architecture](../../design_docs/STORAGE_ARCHITECTURE.md), [Frontend Module](../../../frontend/README.md), [Goal & Requirements](../../../GOAL&REQUIREMENTS.md)

## Why

`GOAL&REQUIREMENTS.md` lists three hard constraints that authentication directly violates:

| Constraint | Says |
|------------|------|
| Single-user only | "No multi-user collaboration or authentication; assumes one developer" |
| Localhost only | "No cloud hosting or remote deployment; runs on the developer's machine" |
| Security | "No authentication — relies on localhost-only access" |

The auth layer (LoginScreen, SetupScreen, AdminPanel, tokens, admin role, `/api/setup`, `admin/*` RPC, CLI `create-user`/`set-admin`) was added incrementally and accreted complexity that has no business value for a localhost dev tool. Removing it simplifies the model, deletes ~10 components/modules, and brings the codebase back in line with the original design.

## What Stays vs. What Goes

### Goes (removed)

**Frontend**
- `components/LoginScreen/` — entire directory
- `components/SetupScreen/` — entire directory
- `components/AdminPanel/` — entire directory
- `services/user.ts` — REST wrappers (profile / preferences / recent-projects via token)
- `services/setup.ts` — REST wrappers for `/api/setup*`
- `api/methods/user.ts` — RPC wrappers for `user/*` methods
- `api/methods/admin.ts` — RPC wrappers for `admin/*` methods
- `store/tokenStore.ts` — token + isAdmin state, the `bonsai_token` localStorage key
- `main.tsx` auth gate — the `checkingAuth` / `needsSetup` / `authenticated` state machine and the `?token=` query parameter on the WebSocket URL
- Any `Header` "Admin" button / admin-only UI surface

**Backend**
- `rpc/auth.py` — `authenticate()`, `authenticate_rest()`, `UserIdentity`
- `rpc/methods/admin.py` — entire `admin/*` namespace
- `rpc/methods/user.py` — `user/getProfile`, `user/getPreferences`, `user/updatePreferences`, `user/getRecentProjects` (per-user)
- `api/routers/setup.py` — `/api/setup/status`, `POST /api/setup`
- `api/routers/user.py` — `/api/user/profile`, `/api/user/preferences`, `/api/user/recent-projects`, `/api/projects/known` (token-gated variants)
- `cli.py` — `create-user`, `list-users`, `set-admin` commands
- `core/server_store.py` — drop `users`, `tokens`, `user_preferences`, `user_recent_projects` tables and all related methods (`create_user`, `resolve_token`, `register_token`, `revoke_token`, `get_preferences`, `update_preferences`, `get_recent_projects`, `add_recent_project`, `set_admin`, `remove_admin`, `delete_user`, `admin_count`)
- WebSocket handshake auth check in `rpc/server.py`
- REST auth dependency injection in routers

**Specs (deleted)**

The cleanup deletes — not deprecates — every spec that documents the removed system. Audit history lives in git; keeping deprecated specs around invites future readers to implement against them.

- `module-auth-migration` (`backend/app/rpc/AUTH_MIGRATION.md`) — **deleted**
- `feature-admin-system` (`.bonsai/design_docs/ADMIN_SYSTEM_DESIGN.md`) — **deleted**
- `module-user-api` (`backend/app/rpc/methods/USER_API.md`) — **deleted**
- `feature_mobile_login` (`.bonsai/implementation_tasks/mobile/feature_mobile_login.md`) — **deleted**
- `feature_preferences_sync` (`.bonsai/implementation_tasks/frontend/feature_preferences_sync.md`) — **deleted** (no per-user prefs to sync anymore)

Deletion goes through `spec_delete` so cross-file `depends-on` / `references` entries get cleaned up automatically.

**Tests**
- `backend/tests/rpc/test_auth.py` — **deleted**
- `backend/tests/rpc/test_admin.py` — **deleted**
- `backend/tests/core/test_server_store.py` — **renamed** to `test_app_store.py`; user/token/preferences/recent-project cases stripped; new cases added for the v2→v3 migration, the `settings` round-trip, and schema-version probing
- `backend/tests/rpc/test_server.py` — token-handshake setup stripped; tokenless connection asserted instead

**Project-level**
- `.claude/CLAUDE.md` "First-Time Setup" section
- Any `users.json` references in templates / docs / project bootstrap

### Stays (kept and renamed/restructured)

**Storage**
- `~/.bonsai/bonsai.db` — same path, same `aiosqlite`, same schema-version pattern
- `projects` table — keep as-is (`path`, `name`, `registered_at`, `last_opened_at`); no longer joined to a user
- `server_config` table — **renamed to `settings`** (the "server" prefix was a multi-user holdover); same key/value/JSON shape
- New schema bump v2 → v3: drops the four user-related tables, renames `server_config` → `settings`, no data migration of preferences (clean break — preferences come back from the project's existing `bonsai-*` localStorage keys, which the frontend already keeps as a cache)

**Code**
- `core/server_store.py` → **renamed to `core/app_store.py`**; class `ServerStore` → `AppStore`. Same lifecycle (open/close in app lifespan), same `aiosqlite` patterns. Public surface shrinks to: `list_projects`, `register_project`, `update_project_last_opened`, `remove_project`, `get_setting`, `set_setting`.
- `core/config.py` `get_data_dir()` — keep, still resolves `~/.bonsai/` (or `$BONSAI_DATA_DIR`)
- `ProjectPicker` — keeps recent-projects functionality, but reads/writes either through `AppStore` (via a new tokenless REST endpoint) or stays on `localStorage` if the frontend module spec prefers that. Decided in the planning phase.
- WebSocket: connection still carries `?project=<path>` but no `&token=...`

## Target State

### App entry flow (`main.tsx`)

```
load → ProjectPicker → /:slug/workspace
```

No setup screen. No login screen. No `checkingAuth` state. No token in the WS URL. The `Root` component shrinks to: render `ProjectPicker` if no project selected, otherwise mount `RpcProvider` + `App` with the project path.

### Settings storage

`AppStore` exposes a tiny key-value API over the `settings` table:

```
get_setting(key: str) -> dict | None
set_setting(key: str, value: dict) -> None
```

Per-project preferences (theme, panel collapse, font size, message history) continue to live in the existing `bonsai-*` localStorage keys on the frontend; nothing is server-synced because there's no user to sync against. The `settings` table is reserved for app-wide, machine-wide config (e.g. last opened project, future cross-project state) and is intentionally minimal at MVP.

### REST endpoints

| Endpoint | Method | Status |
|----------|--------|--------|
| `/api/setup/status` | GET | **Removed** |
| `/api/setup` | POST | **Removed** |
| `/api/user/profile` | GET | **Removed** |
| `/api/user/preferences` | GET/PUT | **Removed** |
| `/api/user/recent-projects` | GET | **Removed** |
| `/api/projects/known` | GET | Either removed or retained tokenless if `ProjectPicker` migrates from localStorage. Decided in planning. |
| `/api/files/*`, `/api/fs/*`, `/api/project/*`, `/api/server-info` | unchanged | tokenless |

### WebSocket RPC

| Method | Status |
|--------|--------|
| `user/*` | **Removed** |
| `admin/*` | **Removed** |
| All other namespaces (`spec/*`, `agent/*`, `session/*`, `board/*`, `trash/*`, `vis/*`, `settings/*`, `subsessions/*`) | unchanged |

### CLI

`backend/app/cli.py` keeps existing non-auth commands (`export-schema`, `export-ws-schema`). Drops `create-user`, `list-users`, `set-admin`.

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/components/LoginScreen/` | **DELETE** directory |
| `frontend/src/components/SetupScreen/` | **DELETE** directory |
| `frontend/src/components/AdminPanel/` | **DELETE** directory |
| `frontend/src/services/user.ts` | **DELETE** |
| `frontend/src/services/setup.ts` | **DELETE** |
| `frontend/src/api/methods/user.ts` | **DELETE** |
| `frontend/src/api/methods/admin.ts` | **DELETE** |
| `frontend/src/store/tokenStore.ts` | **DELETE** |
| `frontend/src/main.tsx` | Strip auth gate; `Root` renders `ProjectPicker` directly |
| `frontend/src/components/AppShell/Header.tsx` | Remove Admin button + any token-derived state |
| `backend/app/rpc/auth.py` | **DELETE** |
| `backend/app/rpc/methods/admin.py` | **DELETE** |
| `backend/app/rpc/methods/user.py` | **DELETE** |
| `backend/app/api/routers/setup.py` | **DELETE** |
| `backend/app/api/routers/user.py` | **DELETE** (or keep tokenless variant if planning decides) |
| `backend/app/rpc/server.py` | Remove auth check on WebSocket handshake |
| `backend/app/main.py` | Drop auth REST helpers, drop setup/user routers, drop CLI auth subcommands |
| `backend/app/cli.py` | Drop `create-user`, `list-users`, `set-admin` |
| `backend/app/core/server_store.py` → `app_store.py` | Rename file + class; drop user/token/preferences/recent-projects tables and methods; add `get_setting`/`set_setting`; bump schema v2 → v3 |
| `backend/app/core/SERVER_STORE.md` → `APP_STORE.md` | Rename + rewrite to describe the trimmed `AppStore` surface |
| `backend/tests/rpc/test_auth.py` | **DELETE** |
| `backend/tests/rpc/test_admin.py` | **DELETE** |
| `backend/tests/core/test_server_store.py` → `test_app_store.py` | Rename; strip user/token cases; add migration + settings tests |
| `backend/tests/rpc/test_server.py` | Strip token handshake; assert tokenless connection |
| `backend/app/rpc/AUTH_MIGRATION.md` | **DELETE** (via `spec_delete`) |
| `.bonsai/design_docs/ADMIN_SYSTEM_DESIGN.md` | **DELETE** (via `spec_delete`) |
| `backend/app/rpc/methods/USER_API.md` | **DELETE** (via `spec_delete`) |
| `.bonsai/implementation_tasks/mobile/feature_mobile_login.md` | **DELETE** (via `spec_delete`) |
| `.bonsai/implementation_tasks/frontend/feature_preferences_sync.md` | **DELETE** (via `spec_delete`) |
| `.claude/CLAUDE.md` | Remove "First-Time Setup" section |

## Definition of Done

- [ ] No file under `frontend/src/components/{LoginScreen,SetupScreen,AdminPanel}/` exists
- [ ] No `tokenStore`, `services/user.ts`, `services/setup.ts`, `api/methods/{user,admin}.ts` exist
- [ ] `bonsai_token` is no longer read or written anywhere in the frontend
- [ ] `frontend/src/main.tsx` has no `authenticated` / `needsSetup` / `checkingAuth` state and no `?token=` in the WS URL
- [ ] No file under `backend/app/{rpc/auth.py, rpc/methods/{admin,user}.py, api/routers/{setup,user}.py}` exists
- [ ] `backend/app/cli.py` has no `create-user` / `list-users` / `set-admin` subcommand
- [ ] `core/app_store.py` exists; `core/server_store.py` does not; `AppStore` is the single import point; the SQLite file at `~/.bonsai/bonsai.db` carries schema v3 with only `_schema_version`, `settings`, and `projects` tables
- [ ] WebSocket handshake accepts a `?project=<path>` query without any token check; project mismatch / nonexistent path still rejects as before
- [ ] `module-auth-migration`, `feature-admin-system`, `module-user-api`, `feature_mobile_login`, and `feature_preferences_sync` specs are **deleted** (not just deprecated); no spec in the repo carries those IDs
- [ ] No surviving spec's `depends-on:` / `references:` frontmatter points at a deleted ID
- [ ] `backend/tests/rpc/test_auth.py` and `test_admin.py` no longer exist; `tests/core/test_app_store.py` has cases for v2→v3 migration, `settings` round-trip, and project registry; `tests/rpc/test_server.py` no longer establishes connections with `?token=`
- [ ] `STORAGE_ARCHITECTURE.md` is rewritten to describe the single-user model with the two-table SQLite schema
- [ ] `frontend/README.md` File Organization no longer references `LoginScreen`, `SetupScreen`, `AdminPanel`, `tokenStore`, `services/{user,setup}.ts`
- [ ] `app-shell` and `webview` UI specs no longer mention auth gates
- [ ] `npm run lint` and `cd backend && uv run pytest` pass
- [ ] `./run.sh` boots the app and the developer lands on `ProjectPicker` immediately, no token entry

## Out of Scope

- Mobile app cleanup (`/mobile/`) — tracked separately. The `feature_mobile_login` task spec is **deleted** by this ticket, but the actual code removal in the Kotlin Multiplatform module is a follow-up. A new task spec will be created when that work is scheduled.
- Reintroducing any kind of remote-access story (Tailscale, etc.) — if that ever returns, it gets a fresh design.
- Per-project sharing across machines — explicitly not supported.
