---
id: submodule-desktop-updates
type: submodule-design
status: active
title: Native desktop updates
parent: module-desktop
tags: [desktop, updates]
---

## Responsibility

Own the native desktop updater as one controller: forward-only eligibility, background full-package download,
bounded retry/scheduling, state snapshots, and the explicit restart handoff. Explicit check and optional download
results own operation transitions; the controller is the sole owner of Electrobun's status callback and uses it
only for useful progress, errors, and completion. Electrobun single-flights each SDK operation, while the
controller keeps only the cross-operation sequencing needed to prevent an overlapping check and download.

## Boundary

- **Public surface:** Electrobun update-controller and quit-coordinator construction are exported only through
  `index.ts`; the pure controller, enablement policy, dependency shapes, and lifecycle implementation stay internal.
- **Allowed deps:** the type-only native update contract from `@thinkrail/contracts`, `electrobun/main` in the
  SDK adapter, and injected clocks/randomness/lifecycle callbacks in the pure controller.
- **Forbidden:** web or server imports; renderer-selected feed URLs; host wire methods; release publication,
  signing, or authentication; draft persistence; shutdown ownership; a second SDK subscription.

Only packaged supported stable/canary builds whose release metadata supplies a nonempty HTTPS updater base URL
enable the production adapter. Packaged metadata is the sole feed authority; renderer input and a duplicate
application feed constant are forbidden. Development and ordinary artifact seams remain disabled. Tests inject an
updater dependency into the controller rather than altering production feed selection.

Manual checks acknowledge immediately while work continues through state revisions. Checks and downloads are
coalesced; transient failed polls do not erase a prepared update, and an error discovered while revalidating that
prepared update stays visible while status remains ready. Electrobun's hash-based offer becomes eligible only when
its version is strictly newer than the packaged version. Automatic checks start after desktop readiness, repeat on
a jittered six-hour cadence, and retry transient failures within a bound. Downloaded packages are never applied
without the explicit restart action.
