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
  atomically clearing the incompatible legacy mirror; and rerunning when a cache identity is repaired beneath
  a stable placement.
- **Public surface (`index.ts`):** the mounted compatibility hook and the imperative attention-change adapter
  used by the workbench callback.
- **External deps:** web-local center-resource types; store selectors and the single legacy mirror action; React.
- **Forbidden:** changing frame or workspace placement, incrementing navigation, transport calls, panel/session/terminal
  lifetime, server/shared/pi imports, or becoming a second attention authority.

All shell writes to `activeTabByWorkspace` / `activeTerminalByWorkspace` compatibility state pass through
this module. Removal of those mirrors remains a separate migration and is not part of this refactor.
