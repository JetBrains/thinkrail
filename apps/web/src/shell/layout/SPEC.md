---
id: submodule-web-shell-layout
type: submodule-design
status: active
title: shell/layout — synchronized workbench layout
parent: submodule-web-shell
depends-on: [module-contracts]
tags: [ui, layout, tabs, drag-and-drop]
---

## Responsibility

The shell-owned, headless workbench engine: legal layout mutations, recursive center/side rendering,
resize and drag geometry, keyboard arrangement commands, and focus recovery for the host-synchronized
`WorkspaceLayoutDocument`. It renders containers; feature views remain arrangement-agnostic.

## Boundary

- **Owns:** the pure topology/policy operations; semantic minimum and group-limit checks; one-result drag
  previews; center split and side-stack renderers; tab-strip overflow; ARIA tab/separator behavior; and the
  visibility gate that mounts a terminal body only while that terminal is selected in a visible group.
- **Public surface (`index.ts`):** the workbench renderer/controller, pure document mutations and invariant
  validator, built-in preset definitions + instantiate/refill operations, attention-fallback helpers, and
  their web-only types. Callers pass resource/tool render callbacks rather
  than importing feature views here.
- **External deps:** `@thinkrail/contracts` (layout/resource types), shell-neutral `lib` attention/id
  primitives, React, `react-resizable-panels`, `@dnd-kit/core`.
- **Forbidden:** server/shared/pi imports; owning domain-resource lifetime; direct persistence or WS calls;
  importing panel internals; a mutable third-party docking model; inline component styles or non-semantic
  colour values.

## State contract

The parent shell is the integration boundary: it supplies accepted store state, device-local attention,
commit/error callbacks, current layout settings, and feature renderers. Every structural operation is a pure
`WorkspaceLayoutDocument → result | unavailable-reason` transaction. A successful discrete command emits
one complete document; components never splice the store's group/tab arrays.

The shared document carries topology, stable group/split ids, tab membership/order, per-center-group preview
identity, side visibility/folds, restore targets, and normalized geometry. A click that may still become a
browser `dblclick` waits one shared 250 ms settle window; the upgraded gesture emits only its final keep while
retaining the leading preview-slot claim, whether content was already cached or required a host read. It never carries selected tabs,
focus, navigation clocks, pointer drafts, or viewport compression. The browser-local attention overlay keeps
selection per group plus last focus for center/each side and a zero-initialized clock for every center leaf;
structural replacement reconciles it to the nearest surviving identity and prunes removed-leaf clocks without
publishing.

## Layout grammar

- **Center:** a recursive horizontal/vertical binary tree, maximum four leaves. A split replaces one leaf
  with equal halves. User creation/resize requires each child to remain at least 320 px wide and 180 px high.
  Losing a leaf's final tab removes that leaf and promotes its sibling; one final empty leaf always remains.
- **Sides:** left/right are ordered vertical stacks. Projects, Specs, All files, Changes, and Review are
  singleton side-only tools; terminals alone may cross between center and sides. Dragging an outer side
  separator through its minimum hides that side through the same shared visibility transaction as its
  keyboard/menu command, retains the last expanded width, and exposes the hidden-side restore rail. During a
  compatible tab drag, every side group exposes broad upper/lower targets below its tab strip; they create a
  group immediately before/after that group, including at interior boundaries. Folded rows divide their
  compact height between the same two targets. Empty groups disappear, and an empty side auto-hides. Expanded bodies have a 120 px
  normal minimum; independently folded groups occupy 27 px and retain their normalized expanded weights.
  Closing a singleton keeps its local feature state and restore target; a View/deep-link reveal restores or
  unfolds it in place and focuses the requested item.
- **Limits:** the host setting defaults to six groups per side. Existing overages survive; creation is
  unavailable until the side falls below its limit. Reorder/join/reducing moves remain legal. Center and side
  domain eligibility, stable-id uniqueness, one canonical placement per resource, and the final-center-leaf
  invariant are enforced by every mutation.
- **Small viewports:** restoring onto less space may compress below operation minimums locally. Content
  scrolls/clips; the shared topology and ratios are never rewritten merely because this viewport is narrow.

Ordinary opens target this browser's last-focused surviving center group. Reopening a canonical resource
selects its existing placement instead of duplicating it and refreshes non-identity metadata such as a chat
label in place. Each center group has one preview slot: preview
replaces in place, keep promotes one-way, and navigation clocks are group-local. A passive automatic restore
may select its first result without incrementing that user-navigation clock. A user open advances its clock
at request time and carries that stamp through acceptance instead of counting again; explicitly clicking or
choosing the already-selected center tab also advances once, because that deliberate re-selection must beat
older deferred work. Incidental/programmatic DOM focus capture only updates last-focus routing and is
count-neutral, preventing a Group Header click or focus-restoration request from counting twice. An async completion
reroutes from a removed destination to current last focus (advancing that surviving destination once), unless
a newer shared snapshot already placed the resource. A user close advances attention and compatibility
navigation exactly once only after structural acceptance (or after an authoritative terminal close); a
rejected layout write leaves the resource, focus, and navigation clocks untouched. Delayed terminal close
settlement resolves the resource semantically against the latest document, so a move is followed while an
unrelated resource that reused the old opaque placement id is never closed. Any newer tab gesture or center
navigation suppresses delayed close-focus recovery; structural reconciliation that removes the closing group's
clock does not impersonate such navigation, so collapsing the final tab in a leaf still restores visible tab focus.

## Arrangement and accessibility

A tab drag paints exactly one result: strip insertion, whole-group join, legal center half-split, or a side
group's broad upper/lower before-or-after target. An expanded side tab strip remains the join/reorder target
while its content halves create groups; a folded row has no content, so its compact upper/lower halves become
the creation targets during a drag. The user never has to acquire a thin outer edge. A hidden side exposes
its full-height rail as a creation target only when the tab is side-compatible and the group limit permits it.
Illegal domains, limits, exact-position no-ops, or minimums paint no valid target and commit nothing. Escape,
pointer cancellation, outside drop, or a superseding remote revision restores the source. Drag moves one tab
only—never copies, crosses workspaces, or moves a whole group.

Pointer is never the sole arrangement path. Keyboard controls and the shadcn menu surface cover group/tab
focus, select/close/keep/reorder/move, directional splits, absolute and adjacent side-group creation, side
fold/show/hide/tool restore, and keyboard separator resize, always with an unavailable reason. A tab can
reproduce any interior pointer placement by moving into the destination group and invoking New group above
or New group below. Tab strips implement the WAI-ARIA tabs pattern and
visible roving focus; a folded side group retains its linked native-hidden tabpanel while unmounting the body,
and separators expose orientation and current/min/max values. One-row strips have bounded
readable tab widths, wheel/trackpad scrolling, previous/next controls, active reveal, and a searchable
keyboard overflow list.

## Presets and synchronization

Balanced, Focus, and Review are web-owned portable definitions; custom presets use the same resource-free
shape. Instantiation fills resources deterministically, prunes unused center leaves, and never imports a
foreign workspace identity. Selecting, applying, or first-seeding a preset raises the synchronized side-group
limit first when its topology requires more groups; an existing over-limit document otherwise remains
grandfathered. Applying a preset preserves resources by flattening center tabs in visual order,
seeding one per leaf, putting the remainder in the primary leaf, and relocating side terminals through the
same-side → opposite-side → primary-center fallback without overriding the preset's side visibility.
Existing singleton-tool placement ids survive relocation, and a newly materialized tool receives a fresh
placement-only id when its conventional id is already owned by another semantic resource. Singleton tools
omitted by a custom preset stay deliberately unplaced but receive default/prior-side restore
targets, so an empty portable preset can never strand the user without a Projects/tool recovery path.

Pointer drag/resize drafts remain local and emit one snapshot only on drop/pointer-up. A newer accepted
revision whose mutation id does not match this client's optimistic base cancels the draft, makes release
inert, and lets the parent explain the cancellation; the same projection epoch invalidates a pending
preview-click settle timer before it can publish from the replaced document. A matching acknowledgement
advances the accepted revision without cancelling a newer draft begun on that document. The parent
`layoutSync` module supplies exact-base optimistic concurrency: a stale replacement conflict installs host
current state and advances the same projection epoch, while this pure module remains unaware of transport,
persistence, and optimistic queues.

The terminal visibility gate mounts a body only for a terminal locally selected in an expanded visible group.
Several distinct terminal identities may mount concurrently; the same identity has one body per browser, and
inactive/folded/hidden terminal tabs never attach. Every center Group Header retains a New terminal command;
it captures that group in the placement intent, so closing the final terminal body cannot remove the creation
path and a vanished captured group reroutes to current center focus.
