---
id: submodule-desktop-updates
type: submodule-design
status: active
title: Native desktop updates
parent: module-desktop
tags: [desktop, updates]
---

## Responsibility

Own the native desktop updater as one controller: forward-only eligibility, background checks, explicit
full-package download, bounded check retry/scheduling, state snapshots, and the explicit install/restart handoff.
The controller is the sole owner of Electrobun's status callback and projects it into available, transfer,
preparation, ready, and installation phases. Electrobun single-flights each SDK operation, while the controller
keeps only the cross-operation sequencing needed to prevent overlaps.

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

Manual actions acknowledge immediately while work continues through state revisions. Automatic checks start
after desktop readiness, repeat on a jittered six-hour cadence, and retry transient check failures within a
bound; they never start or retry a download. A newer unprepared offer becomes `available`, **Download** owns
transfer and preparation, and only a matching newer `updateReady` result becomes `ready`. Transfer reaching
100% is not readiness: Electrobun's decompression/preparation phase remains visible separately. Errors retain
the failed phase so retry repeats the intended operation, while a prepared package survives unrelated check
failures. **Install & Restart** applies that package without re-fetching the feed; Electrobun's native helper
owns final payload validation during handoff.
