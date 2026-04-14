# Implement Mobile Preferences Sync

> Mobile app should fetch user preferences and recent projects from the backend, consistent with the web frontend.

**Status:** Pending
**Priority:** High
**Depends on:** Mobile login (feature_mobile_login.md), User API (USER_API.md)
**Spec reference:** [Storage Architecture](../../docs/STORAGE_ARCHITECTURE.md)

## Summary

Update the mobile app to fetch recent projects and user preferences from the backend REST/RPC API, replacing any local-only storage. ProjectPickerComponent shows the same recent projects as the web frontend.

## Plan

### 1. Modify ProjectPickerComponent
- Fetch recent projects from `GET /api/user/recent-projects?token=...`
- Display server-sourced list instead of local
- On project open: backend tracks it automatically via WebSocket connect

### 2. Add preference fetching
- On app launch (after login): call `GET /api/user/preferences?token=...`
- Apply relevant preferences to mobile UI (theme, if applicable)
- Store locally as cache for offline/instant access

### 3. Sync preference changes
- When user changes mobile-specific settings: call `PUT /api/user/preferences` (REST) or `user/updatePreferences` (RPC if WebSocket is connected)
- Use merge-patch semantics (send only changed keys)

### 4. Add RPC method support
- Wire `user/getPreferences` and `user/updatePreferences` in the mobile RPC client
- Use for in-session preference sync when WebSocket is connected

## Files to Modify

| File | Change |
|------|--------|
| `mobile/shared/.../component/ProjectPickerComponent.kt` | Fetch recents from backend |
| `mobile/shared/.../network/rest/BonsaiApi.kt` | Add preferences REST calls |
| `mobile/shared/.../network/rpc/RpcClient.kt` | Add user/* RPC methods |

## Definition of Done

- [ ] ProjectPicker shows same recent projects as web frontend
- [ ] Preferences fetched from backend on launch
- [ ] Preference changes synced to backend
- [ ] App works offline with cached preferences (graceful degradation)
- [ ] Opening a project on mobile shows up in web frontend's recent projects
