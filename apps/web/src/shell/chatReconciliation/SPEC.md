---
id: submodule-web-shell-chat-reconciliation
type: submodule-design
status: active
title: shell/chatReconciliation — chat placement and cache convergence
parent: submodule-web-shell
tags: [chat, layout, reconciliation]
---

## Responsibility

Converge host-owned chat/session state with shared layout placements and this browser's render cache/history,
without turning cache state into placement authority or activating remote restorations.

## Boundary

- **Owns:** generation-qualified placed-chat hydration single-flights; session-list reconciliation and bounded
  passive auto-open; **exact-chat route-target validation and first-priority placement/focus**; failed
  catalog/transcript reporting and retryable history fallback; missing/tombstoned session pruning;
  restoration of cache/history for accepted remote placements; chat-location/deep-link orchestration; and
  stale-read/placement rechecks before installation.
- **Public surface (`index.ts`):** the mounted tombstone, catalog/cache, and chat-location reconciliation
  hooks plus the placed-chat hydration/current-destination operations required by intent handling and retry
  UI.
- **External deps:** contracts chat/layout types; chat transcript hydration; store session/cache/navigation
  APIs; transport session reads; shell-neutral `lib`; React.
- **Forbidden:** owning session lifetime on the host, terminal reconciliation, generic layout mutation policy,
  feature-panel rendering, server/shared/pi imports, or selecting a tab solely because a remote placement or
  hydration arrived.

Every asynchronous path verifies connection generation, workspace/session tombstones, current request
identity, and surviving semantic placement before installing state. An exact-chat route target owns its
session's hydration while unresolved: passive placed-chat hydration skips that session, preventing a failed
target read from racing an immediate duplicate. It also runs before passive auto-open: only a successful
catalog absence consumes it; a transcript/catalog failure retains it for
reconnect, and passive placements may hydrate but cannot take local focus meanwhile. Once its shared placement,
local attention, and runtime all converge, the target clears and URL sync resumes. A failed passive transcript
read is reported and retains its summary in local history; a failed session catalog is reported instead of
presenting an unexplained empty workspace. Cancelled, disconnected, or archived passes stay silent.
Chat-location work pauses behind pending layout writes so an accepted close cannot be undone by a stale jump.
