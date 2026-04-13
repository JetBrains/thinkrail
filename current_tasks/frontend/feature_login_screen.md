# Implement Frontend Auth & Login Screen

> Users must authenticate before accessing Bonsai. The login screen is the first thing shown when no valid token exists.

**Status:** Pending
**Priority:** Critical
**Depends on:** Server-wide auth (AUTH_MIGRATION.md), User API (USER_API.md)
**Spec reference:** [Storage Architecture](../../docs/STORAGE_ARCHITECTURE.md)

## Summary

Add a LoginScreen component that gates access to the app. Users enter a token (provisioned by admin via CLI), which is validated against the backend. On success, the token is saved to localStorage and the user proceeds to ProjectPicker.

## Plan

### 1. Create LoginScreen component
- New file: `frontend/src/components/LoginScreen/LoginScreen.tsx`
- Token input field + "Login" button
- Calls `GET /api/user/profile?token=...` to validate
- On 200: save token to localStorage via `tokenStore`, call `onSuccess`
- On 401: show error message
- Style following existing Bonsai CSS variables and patterns (see ProjectPicker for reference)

### 2. Create LoginScreen styles
- New file: `frontend/src/components/LoginScreen/LoginScreen.css`
- Follow ProjectPicker styling patterns (centered card, input field, button)

### 3. Modify app entry flow
- `frontend/src/main.tsx`: check token on startup
  - Has token? → validate via REST → valid? proceed : show LoginScreen
  - No token? → show LoginScreen
- LoginScreen shown before ProjectPicker

### 4. Add token validation API call
- New file: `frontend/src/api/methods/user.ts`
- `validateToken(token: string)` — calls `GET /api/user/profile?token=...`
- `getPreferences(token: string)` — calls `GET /api/user/preferences?token=...`
- `getRecentProjects(token: string)` — calls `GET /api/user/recent-projects?token=...`

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/components/LoginScreen/LoginScreen.tsx` | **NEW** — login screen component |
| `frontend/src/components/LoginScreen/LoginScreen.css` | **NEW** — styles |
| `frontend/src/main.tsx` | Add auth check gate before ProjectPicker |
| `frontend/src/api/methods/user.ts` | **NEW** — REST API wrappers for user endpoints |
| `frontend/src/store/tokenStore.ts` | May need minor adjustments for validation flow |

## Definition of Done

- [ ] LoginScreen renders with token input and login button
- [ ] Valid token → saved to localStorage, proceeds to ProjectPicker
- [ ] Invalid token → error message shown, no navigation
- [ ] No token in localStorage → LoginScreen shown on app load
- [ ] Stale token (valid in localStorage but rejected by backend) → cleared, LoginScreen shown
- [ ] Styling matches existing Bonsai design patterns
- [ ] `npm run lint` passes
