# Implement Frontend Preferences Sync

> Move user preferences from browser localStorage to backend storage, making them consistent across all browsers and devices.

**Status:** Pending
**Priority:** High
**Depends on:** User API (USER_API.md), LoginScreen (feature_login_screen.md)
**Spec reference:** [Storage Architecture](../../docs/STORAGE_ARCHITECTURE.md)

## Summary

Replace localStorage as the source of truth for user preferences (theme, UI layout, notification sound, message history, recent projects) with backend API calls. localStorage becomes a cache for instant initial render.

## Plan

### 1. Modify ProjectPicker to fetch recents from backend
- `ProjectPicker.tsx`: call `GET /api/user/recent-projects?token=...` instead of reading `bonsai-recent-projects` from localStorage
- Remove `addRecent()` localStorage writes
- On project open: backend automatically tracks it (via WebSocket connect handler)

### 2. Modify uiStore to sync preferences
- On WebSocket connect: call `user/getPreferences` RPC, apply to store
- On preference change (panel collapse, active tab): call `user/updatePreferences` RPC (async, fire-and-forget)
- Keep localStorage as warm cache via Zustand `persist` middleware (for instant initial render)
- Backend data overwrites localStorage data when it arrives

### 3. Modify notificationStore
- Load `soundEnabled` from backend preferences on connect
- Sync changes back via `user/updatePreferences`

### 4. Modify theme utility
- `utils/theme.ts`: load theme from backend preferences on startup (REST call before WebSocket)
- On theme change: sync to backend

### 5. Modify messageHistoryStore
- Load/save message history via backend preferences
- Keep Zustand `persist` as cache

### 6. Add RPC method wrappers
- `frontend/src/api/methods/user.ts`: add RPC wrappers for `user/getPreferences`, `user/updatePreferences`
- Wire into store initialization in `App.tsx` or `wireEvents.ts`

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/components/ProjectPicker/ProjectPicker.tsx` | Fetch recents from backend REST, remove localStorage reads/writes |
| `frontend/src/store/uiStore.ts` | Load prefs from backend on connect, sync changes back |
| `frontend/src/store/notificationStore.ts` | Load soundEnabled from backend |
| `frontend/src/store/messageHistoryStore.ts` | Load/save via backend |
| `frontend/src/utils/theme.ts` | Load theme from backend on startup |
| `frontend/src/api/methods/user.ts` | Add RPC wrappers (may already exist from LoginScreen task) |
| `frontend/src/App.tsx` | Wire preference loading on connect |

## Definition of Done

- [ ] Recent projects loaded from backend, consistent across browsers
- [ ] Theme, panel state, sound preference persist across browsers for same user
- [ ] Message history synced to backend
- [ ] localStorage still provides instant initial values (cache)
- [ ] Changing a preference in one browser reflects in another after reload
- [ ] `npm run lint` passes
