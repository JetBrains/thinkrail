---
id: submodule-desktop-updates
type: submodule-design
status: active
title: Native desktop updates
parent: module-desktop
tags: [desktop, updates]
---

## Responsibility

Own the native desktop updater as one controller: SDK status reconciliation, forward-only eligibility,
background full-package download, bounded retry/scheduling, state snapshots, and the explicit restart handoff.
The controller is the sole owner of Electrobun's single updater status callback and serializes SDK work.

## Boundary

- **Public surface:** controller construction, its dependency and lifecycle types, the packaged-runtime enablement
  policy, and the Electrobun adapter are exported only through `index.ts`.
- **Allowed deps:** the type-only native update contract from `@thinkrail/contracts`, `electrobun/main` in the
  SDK adapter, and injected clocks/randomness/lifecycle callbacks in the pure controller.
- **Forbidden:** web or server imports; renderer-selected feed URLs; host wire methods; release publication,
  signing, or authentication; draft persistence; shutdown ownership; a second SDK subscription.

Only packaged supported stable/canary builds with the exact expected nonempty HTTPS release base URL enable
the production adapter. Development and ordinary artifact seams remain disabled. Tests inject an updater dependency into the
controller rather than altering production feed selection.

Manual checks acknowledge immediately while work continues through state revisions. Checks and downloads are
coalesced; transient failed polls do not erase a prepared update. Electrobun's hash-based offer becomes eligible
only when its version is strictly newer than the packaged version. Automatic checks start after desktop readiness,
repeat on a jittered six-hour cadence, and retry transient failures within a bound. Downloaded packages are never
applied without the explicit restart action.
