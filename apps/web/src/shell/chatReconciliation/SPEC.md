---
id: submodule-web-shell-chat-reconciliation
type: submodule-design
status: active
title: shell/chatReconciliation — local chat placement and host cache convergence
parent: submodule-web-shell
tags: [chat, layout, reconciliation]
---

## Responsibility

Converge host-owned chat/session existence and transcripts with this frontend surface's workspace-local placements, render cache, and history—without turning cache state into placement authority or opening a tab because another frontend used that session.

## Boundary

- **Owns:** generation-qualified hydration for locally placed chats; authoritative session-list reconciliation; exact-chat route-target validation and first-priority local placement/focus; failed catalog/transcript reporting and retryable history fallback; missing/tombstoned session pruning; chat-location/deep-link orchestration; and stale-read/local-placement rechecks before installation.
- **Public surface (`index.ts`):** mounted tombstone, catalog/cache, and chat-location reconciliation hooks plus locally placed-chat hydration/current-destination operations required by intent handling and retry UI.
- **External deps:** contracts chat/session types; chat transcript hydration; store session/cache/navigation APIs; transport session reads; shell-neutral `lib`; React.
- **Forbidden:** host session lifetime, terminal reconciliation, frame geometry/topology, generic placement policy, feature-panel rendering, server/shared/pi imports, current-layout transport, or selecting a tab merely because domain hydration arrived.

Every asynchronous path verifies connection generation, workspace/session tombstones, current request identity, and surviving semantic local placement before installing state. An exact-chat route target owns its session hydration while unresolved, preventing duplicate reads. Only successful authoritative absence consumes an unresolved target; catalog/transcript failure retains it for reconnect. Once its local placement, workspace attention, and runtime converge, the target clears and URL sync resumes.

Locally persisted chat references hydrate on workspace activation. Other host sessions enter history only; live/unfinished state on another frontend is not local tab intent. A failed placed transcript read is reported and leaves the session retryable in history; a failed catalog is reported instead of presenting unexplained emptiness. Cancelled, disconnected, or removed-workspace passes stay silent. Every accepted local transition is synchronous, so chat-location work needs no host-layout-write barrier; request-time navigation stamps alone prevent a stale jump from undoing a newer close or selection.
