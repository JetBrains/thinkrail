---
id: submodule-web-shell-legacy-selection
type: submodule-design
status: active
title: shell/legacySelection — temporary selection compatibility adapter
parent: submodule-web-shell
tags: [layout, legacy, adapter]
---

## Responsibility

Contain the temporary bridge from workbench-local attention to migration-era active editor, preview, and
terminal mirrors used by feature render caches.

## Boundary

- **Owns:** resolving the selected center placement to the matching editor cache or terminal catalog key;
  atomically clearing the incompatible legacy mirror; rerunning when a cache identity is repaired beneath a
  stable placement; and revealing the Review tool when the active tab becomes a reviewed file, deferred while
  `doubleClickPendingMs()` says a browse row's double-click could still arrive, so the row can keep its preview
  before Review replaces it. When Review already shows (the workbench-supplied reader), nothing can replace the
  row, so the reveal runs at once: a late reveal's focus request would close whatever the user opened meanwhile.
  A deferred reveal cancelled before it fires is forgotten, so a rerun with the same selection schedules it again.
- **Public surface (`index.ts`):** the mounted compatibility hook and the imperative attention-change adapter
  used by the workbench callback.
- **External deps:** web-local center-resource types; store selectors, the single legacy mirror action, and the
  reveal-tool layout intent; shell-neutral `lib` (`doubleClickPendingMs`); React.
- **Forbidden:** changing frame or workspace placement, incrementing navigation, transport calls, panel/session/terminal
  lifetime, server/shared/pi imports, or becoming a second attention authority.

All shell writes to `activeTabByWorkspace` / `activeTerminalByWorkspace` compatibility state pass through
this module. Removal of those mirrors remains a separate migration and is not part of this refactor.
