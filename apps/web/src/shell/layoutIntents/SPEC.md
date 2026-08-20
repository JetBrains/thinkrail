---
id: submodule-web-shell-layout-intents
type: submodule-design
status: active
title: shell/layoutIntents — arrangement intent orchestration
parent: submodule-web-shell
tags: [layout, intents, orchestration]
---

## Responsibility

Consume arrangement-agnostic store intents for one mounted workspace and translate each into one pure layout
transaction plus the corresponding device-local attention/focus transition.

## Boundary

- **Owns:** stale document/attention identity guards; consume-once intent handling; destination and navigation
  arbitration; open/select/close/tool/terminal/toggle dispatch; accepted attention/focus calculation; and
  issuing at most one complete-document commit for the result.
- **Public surface (`index.ts`):** the workspace intent-processing hook and its narrow callback types.
- **External deps:** contracts layout types; store intent, attention, and navigation APIs; transport error
  normalization; React.
- **Forbidden:** direct WS calls; layout hydration/queue ownership; session or terminal catalogs/lifetime;
  panel rendering; server/shared/pi imports; or adding mutable topology logic outside the pure `layout`
  sibling.

An intent is consumed only after confirming that its captured store document and attention are still current.
Deferred chat/history work retains its request-time navigation stamp so a late completion cannot steal focus.
