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
full-package download, bounded check retry/scheduling, state snapshots, the explicit install/restart handoff,
and the durable report of how that handoff ended after the relaunch. The controller is the sole owner of
Electrobun's status callback. It projects the callback into available, transfer, preparation, ready, and
installation phases, plus install steps and the post-relaunch result. Electrobun single-flights each SDK
operation, while the controller keeps only the cross-operation sequencing needed to prevent overlaps.

## Boundary

- **Public surface:** Electrobun update-controller and quit-coordinator construction, plus
  `readPendingInstallVersion` for the startup splash, are exported only through `index.ts`. The pure
  controller, enablement policy, journal store, dependency shapes, and lifecycle implementation stay internal.
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
100% is not readiness: Electrobun's decompression/preparation phase remains visible separately. Electrobun
2.0.1 exposes no operation to cancel an in-flight download or discard a prepared package, so while the app
remains running, transfer and preparation continue to completion or error; closing Settings only defers
installation. The UI must not claim cancellation while native work continues. Errors retain the failed phase so retry repeats the intended
operation, while a prepared package survives unrelated check failures. **Install & Restart** applies that package
without re-fetching the feed; Electrobun's native helper owns final payload validation during handoff.

## Install attempt and result

One install attempt spans the whole coordinated handoff, not the first SDK call. The quit coordinator's
first `applyUpdate()` is always vetoed so the host can shut down. It resolves to whether shutdown
started, and that decides whether the attempt continues. Only the process exiting or a terminal error
ends a continuing attempt.

During the attempt, `installStep` follows the SDK statuses: `stopping` from acceptance, `handoff` at
`applying`, and `restarting` at `launching-new-version`. The bounded `log` records the steps and how
long host shutdown took. Any `error` status, including the second handoff's helper-start failure, ends
the attempt as an `install` failure. A handoff that never started shutdown fails with the SDK's error,
or else "couldn't start the installer". The final two transitions happen in one synchronous SDK block
before quit, so their pushes are best-effort.

Electrobun's native helper has no UI and writes only a final result, which the SDK reconciles once
after relaunch and immediately marks observed. ThinkRail therefore keeps one validated, bounded
`update-journal.json` in userData with two states:
- **pending.** From/to version, start time and log. Written synchronously at `launching-new-version`,
  the checkpoint after the helper is armed. A write failure stays local, outside the SDK's cleanup
  path.
- **resolved.** The `lastInstall` result. It is rehydrated on every launch until dismissed.

After a relaunch, reconciliation becomes `lastInstall`:
- `complete` → `installed`.
- "failed during <phase>" → `failed`, with the phase and the raw cause. This parses the SDK 2.0.1
  message, with a raw fallback.
- A pending journal contributes the from-version and the log. An upgrade from a build without the
  journal reports a null from-version and an empty log.
- A pending journal with no reconciliation within 5 s resolves as `installed` if the running version
  is its target, otherwise `unreported`.

Accepting a new attempt clears the previous result, and `dismissInstallResult` clears it on request. A
rollback can only be reported when the restored build has this journal; older builds relaunch
silently.
