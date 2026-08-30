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

This module makes location portable without making it shared state. Browser tabs own independent
fragments; the Electrobun shell persists the observed fragment per backend profile/window, and later
mobile shells persist it per profile/device. Cross-client continuation is an explicit link/bookmark
action, never an automatic backend-owned active location.

## Boundary

- **Owns:** `NavigationLocation`; the versioned fragment codec; the `NavigationDriver` seam (`read`/`replace`/`push`/incoming-location subscription); the browser fragment driver; startup/direct-link restoration and canonical fallback; the push-vs-replace history decision; loop/idempotency guards between serialized intent and validated store state.
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

Store-driven navigation writes the fragment through the history contract below: user-intent location changes push a browser history entry, passive ones replace in place. Directly opened fragments and later incoming fragment changes still run through validation. The driver compares the derived location before writing, so non-navigation store churn — especially streaming Pi events — causes no History API calls.

## History contract (browser Back/Forward, issue #152)

Back/Forward must step through the user's in-app navigation. Entries are **locations, not tab state**: every entry is a route the restore contract can validate and re-enter, so Back/Forward is just an incoming fragment — pushes change only the hash, and hash-only traversal fires `hashchange`, which the driver already reports as an incoming route. The new machinery only decides *when a navigation creates an entry*.

**Push vs replace.** The coordinator decides per store edge (`subscribe(state, previous)`):

- **User intent** on an edge = a project/workspace scope move, the active workspace's `navTickByWorkspace` advance, or an advance of any per-group navigation clock in the active workspace's layout attention (`navigationClockByGroup`) — unless the coordinator itself is applying an incoming route (see adoption). An intent edge **arms a push**. The coordinator arms at the **top** of its store subscription — before the stale exact-chat-target clearing whose nested re-entry runs the sync — so a click that cancels an unresolved chat target still records its own location as a push (pinned by the exact-chat-target unit test).
- The derived location often changes on a *later* edge than the click: `setActiveTab`/`openTab` bump `navTickByWorkspace` at click time, while `deriveLocation` reads layout **attention**, which the layout-intent processor updates in a subsequent local transition. The attention edge carries its own intent signal — `selectTab(..., countNavigation)` advances the destination group's navigation clock for user selects/opens/closes and leaves it untouched for passive local hydration or stamped-at-request consumption (`shouldAdvanceAcceptedNavigation` = false).
- A fragment write **consumes the arm**: armed → `push`, otherwise → `replace`. The arm **persists across unchanged-location syncs** until a write consumes it or an incoming fragment is adopted. This is load-bearing, not laxity: **deferred stamped opens** (the new-chat button, history reopen, cross-workspace jumps) count their navigation at the click via `beginCenterNavigation`/`requestChatLocation` and land the location change only after an async round trip, deliberately *without* re-counting (`shouldAdvanceAcceptedNavigation` = false) — clearing the arm earlier would demote every such flow to a replace. Accepted trade-off: a location-neutral intent (re-selecting the current tab) followed by a *passive* location change records one extra entry — rare (multi-client races) and self-healing. Passive location changes with no prior intent (local hydration or canonical fallback) replace—coalescing into the current entry: **one user click = one history entry**, whose fragment self-heals to the final location.
- **Adoption:** an incoming fragment (startup, Back/Forward, address-bar edit) already *is* the current entry — accepting it clears the arm, canonicalization and every write the coordinator makes while applying the route (`selectMain`/`selectProject`/`setWorkspaces`/`activateWorkspaceFromRoute`, which themselves advance ticks and clocks) are masked from the intent test and replace, never push. The coordinator's own masked edges also never cancel its pending route — resolution clears it explicitly. Post-resolution sync writes replace.
- **Adoption is user navigation, store-visibly and immediately:** accepting a fragment bumps the active workspace's `navTickByWorkspace` (masked) *before* the validation read starts. Deferred file/chat reads compare their request-time tick against that current value, so an in-flight Back/Forward beats an older completion.
- Unchanged fragment → no History API call (the existing `lastWritten` guard).

**Back/Forward semantics falling out of the rules:**

- A chat's history entry survives its tab being closed: Back re-opens/refocuses it through normal validated restore (user decision; no history scrubbing). The atomic local close removes the attention-selected tab and advances navigation once, so closing the active chat pushes the neighbor location; Back returns to the closed chat.
- Back to a since-deleted chat/workspace/project lands on the canonical fallback via the existing authoritative-absence rules; transient failures leave the URL untouched.
- Accepted coarseness (route contract unchanged): file/diff/doc tabs serialize as the workspace route, so Back cannot refocus an exact file tab; stepping back from a chat entry onto a same-workspace workspace-level entry may immediately canonicalize back to the selected chat (one "dead" Back press, self-healing via replace). A cross-workspace jump into a workspace whose layout attention is not yet hydrated may create two entries (workspace, then chat). A *passive* scope relocation (a remote project close, or workspace removal restoring this client's most-recent remaining workspace and falling back to Project Home only when none remains) reads as a scope move and records an entry — Back onto the dead location canonicalizes via the absence rules. Exact-file routes and a same-workspace fast path (skipping the authoritative `workspace.list` read on Back between sibling chats) are recorded follow-ups in the task-spec.

The driver seam carries `push(fragment)` (`history.pushState` in the browser driver); native adapters map it onto their own history model.

## Restore contract

An incoming route is intent, never domain truth:

1. wait for the store's **`welcomeGeneration`**, advanced only by its atomic complete-welcome install — connection status, protocol version, and an empty project list are not readiness signals;
2. validate the project against that open-project snapshot;
3. fetch/install the project's authoritative `workspace.list({ includeDiffStats: false })` before validating/activating a workspace — membership/order stay complete while the synchronous per-workspace diff-stat fan-out stays off automatic startup;
4. re-check the route generation and open project after the read, then atomically activate a valid workspace, advance its center-navigation tick (so older deferred reads are superseded), and either install an exact-chat target stamped with the resulting tick or clear any older exact target for a workspace-level route; a workspace route carries no tab intent, so existing browser-local attention remains and ordinary store sync may canonicalize the fragment to an already-selected chat;
5. let `shell/chatReconciliation` validate/hydrate that exact session; an exact-target install advances a dedicated generation so this also runs when the workspace was already active, while target consumption does not duplicate the pass. Ordinary domain hydration never auto-opens another frontend's chat, and while the exact target is unresolved no background work may activate a different chat or advance its navigation tick;
6. apply every resolved level, including main itself, then canonicalize ids only after **successful authoritative absence**: completed session list lacks chat → workspace, completed workspace list lacks workspace → Project Home, completed welcome lacks project → main. Falling back from a missing chat does not erase an existing local placement or this window's attention; after the exact target is consumed, the derived location truthfully reflects whatever remains selected. A timeout, disconnect, unreadable response, or ordinary server error says nothing about existence: navigation leaves route/target unchanged and the data loader performs its standard retry/reconnect or error UI.

Every incoming route advances one monotonic restore generation; every asynchronous continuation checks it. Any project/workspace scope move **or center-navigation tick** cancels a still-pending authoritative read, so a same-workspace file/chat click beats its late response too. The exact-chat target may focus only while its workspace and stamped navigation tick are still current. Store→driver writes pause while an incoming exact route is unresolved, so temporary workspace/no-tab/error state cannot erase the chat fragment. Duplicate initialization/welcome delivery and React Strict Mode are idempotent; reconnect retries unresolved intent but does not replay a completed startup route.

## Platform adapters

Electrobun persists a bounded fragment outside webview storage per `{ backendProfileId, windowId }`, then
appends it to the actual origin after starting the dynamic-port local host. Its preload observes the
browser driver's `history.replaceState`/`pushState` plus initial/hash/pop changes before app code; the web
codec remains authoritative and invalid restored intent canonicalizes through the ordinary restore path.
The native bridge never exposes host/domain capabilities. Shared backend selection remains deferred.

Mobile later persists the same route per backend profile/device and maps universal/custom links onto it.
Those platform adapters do not move the route into backend-owned state.
