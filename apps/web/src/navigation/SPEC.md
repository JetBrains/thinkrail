---
id: submodule-web-navigation
type: submodule-design
status: active
title: navigation — client-local routes and restoration
parent: module-web
depends-on: [module-contracts]
tags: [v1, ui, navigation, multi-client]
references: [architecture, module-desktop]
---

## Responsibility

The client-local location layer: one backend-relative, serializable route for main/Project Home/workspace/chat, plus the browser fragment driver and the restore coordinator that validates an incoming route against host-owned state before changing the rendered store.

This module makes location portable without making it shared state. Browser tabs own independent fragments; later Electrobun/mobile shells persist the same route per backend profile and window/device. Cross-client continuation is an explicit link/bookmark action, never an automatic backend-owned active location.

## Boundary

- **Owns:** `NavigationLocation`; the versioned fragment codec; the `NavigationDriver` seam (`read`/`replace`/incoming-location subscription); the browser fragment driver; startup/direct-link restoration and canonical fallback; loop/idempotency guards between serialized intent and validated store state.
- **Public surface (barrel):** route types + codec and `initNavigation(driver?)`; the browser driver is the default. Native adapters may consume/produce the same backend-relative route without changing store or transport.
- **External deps:** `contracts` (project/workspace/session DTO types, type-only); browser History/Location APIs.
- **Forbidden:** server/shared/pi; owning project/workspace/session snapshots; persisting credentials or raw backend secrets; importing panels/chat/shell; writing a backend-owned “active location.”

Sibling dependency edges live only in `module-web`. `main.tsx` initializes the integration, while `shell/chatReconciliation` consumes the store's exact-chat target through its existing hydration integration.

## Route contract

The versioned browser fragment represents exactly one of:

- `#/v1` — main/Welcome;
- `#/v1/projects/<projectId>` — Project Home;
- `#/v1/projects/<projectId>/workspaces/<workspaceId>` — workspace;
- `#/v1/projects/<projectId>/workspaces/<workspaceId>/chats/<sessionId>` — exact chat.

Each id is one encoded path segment. Empty ids, extra segments, malformed encoding, and unknown versions are invalid and canonicalize to main. The route is backend-relative: same-origin web gets backend identity from its origin; independently hosted/native clients pair it with a selected backend profile. No credential belongs in it.

Store-driven navigation uses `history.replaceState` in the first slice: the fragment is a reload/shareable-location contract, not yet browser history for every chat click. Directly opened fragments and later incoming fragment changes still run through validation. The driver compares the derived location before writing, so non-navigation store churn — especially streaming Pi events — causes no History API calls.

## Restore contract

An incoming route is intent, never domain truth:

1. wait for the store's **`welcomeGeneration`**, advanced only by its atomic complete-welcome install — connection status, protocol version, and an empty project list are not readiness signals;
2. validate the project against that open-project snapshot;
3. fetch/install the project's authoritative `workspace.list({ includeDiffStats: false })` before validating/activating a workspace — membership/order stay complete while the synchronous per-workspace diff-stat fan-out stays off automatic startup;
4. re-check the route generation and open project after the read, then atomically activate a valid workspace, advance its center-navigation tick (so older deferred reads are superseded), and either install an exact-chat target stamped with the resulting tick or clear any older exact target for a workspace-level route; a workspace route carries no tab intent, so existing browser-local attention remains and ordinary store sync may canonicalize the fragment to an already-selected chat;
5. let `shell/chatReconciliation` validate/hydrate that session before its ordinary auto-open pass; an exact-target install advances a dedicated generation so this also runs when the workspace was already active, while target consumption does not cause a duplicate pass. While the exact target is unresolved, background hydration cannot activate a different chat or advance the target's navigation tick;
6. apply every resolved level, including main itself, then canonicalize ids only after **successful authoritative absence**: completed session list lacks chat → workspace, completed workspace list lacks workspace → Project Home, completed welcome lacks project → main. Falling back from a missing chat does not erase an existing shared placement or this browser's attention; after the exact target is consumed, the derived location truthfully reflects whatever remains selected. A timeout, disconnect, unreadable response, or ordinary server error says nothing about existence: navigation leaves route/target unchanged and the data loader performs its standard retry/reconnect or error UI.

Every incoming route advances one monotonic restore generation; every asynchronous continuation checks it. Any project/workspace scope move **or center-navigation tick** cancels a still-pending authoritative read, so a same-workspace file/chat click beats its late response too. The exact-chat target may focus only while its workspace and stamped navigation tick are still current. Store→driver writes pause while an incoming exact route is unresolved, so temporary workspace/no-tab/error state cannot erase the chat fragment. Duplicate initialization/welcome delivery and React Strict Mode are idempotent; reconnect retries unresolved intent but does not replay a completed startup route.

## Later platform adapters

Electrobun persists this route outside webview storage per `{ backendProfileId, windowId }`, then appends it to the actual origin after starting a dynamic-port local host or selecting a shared backend. Mobile persists it per backend profile/device and maps universal/custom links onto it. Those adapters and backend-profile UX are outside this module's V1 browser slice; the route contract is the seam they reuse.
