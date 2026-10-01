---
id: submodule-web-resources
type: submodule-design
status: draft
title: resources — renderer registry and review surface contracts
parent: module-web
depends-on: [module-contracts]
---

## Responsibility

Own the engine-neutral resource description, renderer registry, and review-surface contract used by file
and diff panes. Selection is metadata-driven: matching renderers are filtered by intent and phone support,
ranked, and followed by the required text or byte fallback. The resulting ordered list is both dispatch
policy and the pane's view-toggle grammar.

`ResourceContent` keeps text, retrievable bytes, and an absent diff side distinct. In particular, absence
is never represented by a byte payload without a URL. `SurfaceReview` carries authoritative anchors; a
renderer only projects selectors into geometry. `isPlaceable` answers whether at least one positioned
selector has a geometry the renderer advertises for the requested view or diff intent, while `anchorLabel`
is the shared compact reference. A diff renderer may report the thread ids it actually placed through
`ResourceDiffProps.onPlacedThreadIds`; the pane treats capability-matching ids omitted from that set as
unplaced too, covering renderer-local geometry such as collapsed context. A diff renderer with no diff-anchor
capability may ignore `ResourceDiffProps.review`; the pane keeps those threads in its unplaced strip instead.

`HunkActions` is the mutation boundary between a diff engine and its pane. A renderer reports only the
engine-neutral original/modified `LineSpan` pair it computed: `revert` applies that one block,
`revertFile` applies the file target, and `askAgent` returns the `AnchorDraft` plus initial composer text
that the renderer places on the modified side. `agentWorking` is presentation-only and never disables the
CAS-protected actions. The pane owns wire calls, scope and expectation hashes, undo receipts, stale-view
refresh, and error UI. An immutable scope omits `hunkActions`; renderers must then omit every mutation
control rather than emulate one.

## Boundary

- **Public surface:** `index.ts` exports `ResourceDescriptor`, `ResourceContent`, `AnchorDraft`,
  `ReviewThread`, `ReviewThreadActions`, `SurfaceReview`, `ResourceViewProps`, `ResourceDiffProps`
  (including its optional actual-placement callback), `HunkActions`, `ResourceRenderer` and its support
  types, plus `registerResourceRenderer`,
  `resolveRenderers`, `describeResource`, `anchorLabel`, and `isPlaceable`.
- **Allowed deps:** `@thinkrail/contracts` types, the `lib` barrel, and React types.
- **Forbidden:** store, transport, shell, panels, and renderer implementations. Bundled implementations
  live under `panels/resources` and register metadata plus lazy loaders from the workbench composition edge.

Registration owns no content or tab state. Panes own transport URLs, review integration, selected renderer,
and opaque per-tab view state. Active renderers remain a sandbox boundary; registration metadata may name
that capability but this module never mounts one.
