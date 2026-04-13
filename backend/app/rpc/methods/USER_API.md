# User Preferences API — Module Design

> Parent: [Storage Architecture](../../../../docs/STORAGE_ARCHITECTURE.md) | Status: **Active** | Created: 2026-04-13

## Purpose

REST and WebSocket RPC endpoints for user profile, preferences, and recent projects. Enables cross-browser preference sync by moving data from browser localStorage to server-side SQLite storage.

## Internal Architecture

```mermaid
graph TD
    subgraph REST["REST Endpoints (pre-WebSocket)"]
        R1["GET /api/user/profile"]
        R2["GET /api/user/preferences"]
        R3["PUT /api/user/preferences"]
        R4["GET /api/user/recent-projects"]
        R5["GET /api/projects/known"]
    end

    subgraph RPC["WebSocket RPC Methods"]
        W1["user/getProfile"]
        W2["user/getPreferences"]
        W3["user/updatePreferences"]
        W4["user/getRecentProjects"]
    end

    REST --> SS["ServerStore"]
    RPC --> SS
```

## REST Endpoints

Used by LoginScreen and ProjectPicker before any WebSocket connection exists.

| Endpoint | Method | Auth | Request | Response |
|----------|--------|------|---------|----------|
| `/api/user/profile` | GET | `?token=bns_xxx` | — | `{ userId, displayName, createdAt }` |
| `/api/user/preferences` | GET | `?token=bns_xxx` | — | `{ theme, soundEnabled, ... }` |
| `/api/user/preferences` | PUT | `?token=bns_xxx` | `{ theme?: "...", ... }` | Updated prefs |
| `/api/user/recent-projects` | GET | `?token=bns_xxx` | `?limit=10` | `[{ path, name, lastOpened }]` |
| `/api/projects/known` | GET | `?token=bns_xxx` | — | `[{ path, name, registeredAt, lastOpenedAt }]` |

All endpoints return 401 for missing/invalid tokens.

## WebSocket RPC Methods

Used during active project sessions for real-time preference sync.

| Method | Params | Response | Description |
|--------|--------|----------|-------------|
| `user/getProfile` | — | `{ userId, displayName, createdAt }` | Current user profile |
| `user/getPreferences` | — | `{ theme, soundEnabled, leftPanelCollapsed, ... }` | Full preference object |
| `user/updatePreferences` | `{ patch: { ... } }` | Updated prefs object | Merge patch into existing |
| `user/getRecentProjects` | `{ limit?: number }` | `[{ path, name, lastOpened }]` | User's recent projects |

## Preference Schema

Stored as JSON blob in `user_preferences.prefs`. Validated by Pydantic but schema is flexible (extra fields allowed).

```json
{
  "theme": "system",
  "soundEnabled": false,
  "fontSize": 13,
  "compactFontSize": 9,
  "leftPanelCollapsed": false,
  "rightPanelCollapsed": false,
  "leftActiveTab": "specs",
  "messageHistory": ["last message", "..."]
}
```

`updatePreferences` uses **merge semantics**: only provided keys are updated, others are preserved.

## File Organization

| File | Responsibility |
|------|---------------|
| `backend/app/rpc/methods/user.py` | **NEW** — RPC method handlers (`user/*`) |
| `backend/app/main.py` | REST endpoint handlers (added to existing routes) |
| `frontend/src/api/methods/user.ts` | **NEW** — Frontend RPC wrappers |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Both REST + RPC | Dual transport | REST needed before WebSocket (LoginScreen/ProjectPicker); RPC for in-session sync |
| Merge-patch semantics | Partial updates | Frontend sends only changed keys, avoids overwrite races |
| JSON blob for prefs | Single `prefs` column | Avoids schema migration per preference |
| No per-project prefs sync | Server-only | Project-level `settings.json` stays separate (model, effort, etc.) |
