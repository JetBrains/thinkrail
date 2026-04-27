---
id: feature_mobile_login
type: task-spec
status: active
title: Implement Mobile Auth & Login Screen
depends-on:
- module-auth-migration
- module-user-api
covers:
- mobile/shared/
tags:
- mobile
- auth
- critical
---
# Implement Mobile Auth & Login Screen

> Mobile app must authenticate before accessing Bonsai, matching the web frontend's auth requirement.

**Status:** Pending
**Priority:** Critical
**Depends on:** Server-wide auth (AUTH_MIGRATION.md), User API (USER_API.md)
**Spec reference:** [Storage Architecture](../../docs/STORAGE_ARCHITECTURE.md)

## Summary

Add a LoginScreen to the mobile app (Kotlin Multiplatform). Users enter a token, which is validated via REST API. On success, the token is stored in Android DataStore and the user proceeds to ProjectPicker. ConnectionManager requires a valid token for all connections.

## Plan

### 1. Create LoginScreen composable
- New file: `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/ui/screen/LoginScreen.kt`
- Material 3 text field for token entry + "Login" button
- Call `GET /api/user/profile?token=...` via existing REST client
- On 200: store token, navigate to ProjectPicker
- On 401: show error snackbar

### 2. Add token persistence
- Use Android DataStore (or shared `Settings` for KMM) to persist token
- Read token on app launch to determine if LoginScreen or ProjectPicker is shown

### 3. Modify ConnectionManager
- Token becomes a required parameter (not optional)
- Reject connection attempts without a valid token
- Pass token in WebSocket URL: `?project=...&token=...`

### 4. Modify RootComponent navigation
- Add LoginScreen as initial destination when no stored token exists
- Flow: LoginScreen → ProjectPicker → Main app

### 5. Add REST API calls for user endpoints
- `GET /api/user/profile?token=...` — validate token
- `GET /api/user/recent-projects?token=...` — for ProjectPicker

## Files to Modify

| File | Change |
|------|--------|
| `mobile/shared/.../ui/screen/LoginScreen.kt` | **NEW** — login screen composable |
| `mobile/shared/.../network/connection/ConnectionManager.kt` | Token required, passed in WS URL |
| `mobile/shared/.../component/RootComponent.kt` | Add LoginScreen to navigation |
| `mobile/shared/.../network/rest/BonsaiApi.kt` | Add user profile/preferences REST calls |
| `mobile/androidApp/.../MainActivity.kt` | May need DataStore setup |

## Definition of Done

- [ ] LoginScreen shown when no stored token
- [ ] Valid token → stored, navigate to ProjectPicker
- [ ] Invalid token → error shown
- [ ] Token persisted across app restarts
- [ ] ConnectionManager rejects connections without token
- [ ] Existing functionality works after login
